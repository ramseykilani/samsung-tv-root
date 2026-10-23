"""Local bridge server: LAN HTTP face for the root daemon.

Two jobs on the always-on host machine:

- ``/art`` serves a folder of artwork images plus a generated ``index.json``
  manifest, so a TV web app (``framed``) can pull the owner's image library
  over plain HTTP. SMB shares are not readable from the Tizen web runtime.
- ``/intent`` is a bearer-authenticated passthrough to the daemon's control
  API, restricted to a small allowlist of actions. An Alexa skill (or any
  voice agent) reaches it through a tunnel such as ``cloudflared``.

Only stdlib is used so the bridge runs wherever the package is installed.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import re
import secrets
import stat
import urllib.parse
from pathlib import Path
from typing import Any

from .controller import ControllerError, default_control_file, send_control_request


IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MANIFEST_NAME = "index.json"
INTENT_ACTION_ALLOWLIST = frozenset(
    {
        "app.list",
        "app.launch",
        "execute",
        "display.picture_off",
        "display.wake",
        "volume.set",
        "volume.status",
        "source.list",
        "source.current",
    }
)
MAX_BODY_BYTES = 64 * 1024
MAX_LISTEN_QUEUE = 64


class BridgeError(RuntimeError):
    pass


def bridge_token_path(control_file: Path | None = None) -> Path:
    base = control_file if control_file is not None else default_control_file()
    return base.parent / "bridge-token"


def load_or_create_token(control_file: Path | None = None) -> str:
    path = bridge_token_path(control_file)
    try:
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    value = secrets.token_urlsafe(32)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    temporary.write_text(value + "\n", encoding="utf-8")
    temporary.chmod(stat.S_IRUSR | stat.S_IWUSR)
    temporary.replace(path)
    return value


def _status_line(status: int) -> bytes:
    reason = {
        200: "OK",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        413: "Payload Too Large",
        500: "Internal Server Error",
        502: "Bad Gateway",
    }[status]
    return f"HTTP/1.1 {status} {reason}\r\n".encode()


def _json_response(status: int, payload: dict[str, Any]) -> tuple[int, bytes, str]:
    return (
        status,
        json.dumps(payload, separators=(",", ":")).encode(),
        "application/json",
    )


def _scan_art(directory: Path) -> dict[str, Any]:
    images = []
    if directory.is_dir():
        for entry in sorted(directory.iterdir(), key=lambda e: e.name):
            if entry.is_file() and entry.suffix.lower() in IMAGE_SUFFIXES:
                images.append(
                    {
                        "file": entry.name,
                        "title": entry.stem.replace("_", " ").replace("-", " "),
                    }
                )
    return {"images": images}


SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,255}$")


class BridgeServer:
    def __init__(
        self,
        *,
        art_directory: Path,
        control_file: Path,
        token: str,
        television: str | None = None,
        timeout: float = 20.0,
    ) -> None:
        self.art_directory = art_directory
        self.control_file = control_file
        self.token = token
        self.television = television
        self.timeout = timeout
        self.server: asyncio.AbstractServer | None = None

    async def start(self, host: str, port: int) -> None:
        self.server = await asyncio.start_server(
            self._handle_client,
            host,
            port,
            backlog=MAX_LISTEN_QUEUE,
        )

    async def serve_forever(self) -> None:
        assert self.server is not None
        async with self.server:
            await self.server.serve_forever()

    async def _handle_client(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            status, body, content_type = await self._dispatch(reader)
        except (asyncio.IncompleteReadError, ConnectionError):
            writer.close()
            return
        except Exception as error:  # noqa: BLE001 - report, never crash the server
            status, body, content_type = _json_response(
                500, {"error": f"internal: {error}"}
            )
        headers = (
            _status_line(status)
            + f"Content-Type: {content_type}\r\n".encode()
            + f"Content-Length: {len(body)}\r\n".encode()
            + b"Connection: close\r\n\r\n"
        )
        try:
            writer.write(headers + body)
            await writer.drain()
        finally:
            writer.close()

    async def _read_request(
        self, reader: asyncio.StreamReader
    ) -> tuple[str, str, dict[str, str], bytes]:
        head = await reader.readuntil(b"\r\n\r\n")
        if len(head) > MAX_BODY_BYTES:
            raise BridgeError("request head too large")
        lines = head.decode("latin-1").split("\r\n")
        method, target, _version = lines[0].split(" ", 2)
        headers = {}
        for line in lines[1:]:
            if not line:
                continue
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        length = int(headers.get("content-length", "0") or "0")
        if length > MAX_BODY_BYTES:
            raise BridgeError("request body too large")
        body = await reader.readexactly(length) if length else b""
        return method.upper(), urllib.parse.unquote(target), headers, body

    async def _dispatch(self, reader: asyncio.StreamReader) -> tuple[int, bytes, str]:
        method, target, headers, body = await self._read_request(reader)
        path, _, _query = target.partition("?")
        if path == "/" or path == "/health":
            return _json_response(
                200, {"ok": True, "service": "samsung-tv-root bridge"}
            )
        if path == "/art" or path == f"/art/{MANIFEST_NAME}":
            if method != "GET":
                return _json_response(405, {"error": "GET required"})
            return _json_response(200, _scan_art(self.art_directory))
        if path.startswith("/art/"):
            if method != "GET":
                return _json_response(405, {"error": "GET required"})
            return self._serve_image(path[len("/art/") :])
        if path == "/intent":
            if method != "POST":
                return _json_response(405, {"error": "POST required"})
            return await self._intent(headers, body)
        return _json_response(404, {"error": "not found"})

    def _serve_image(self, name: str) -> tuple[int, bytes, str]:
        if SAFE_NAME.fullmatch(name) is None or ".." in name:
            return _json_response(403, {"error": "invalid name"})
        path = self.art_directory / name
        try:
            if path.parent.resolve() != self.art_directory.resolve():
                return _json_response(403, {"error": "invalid path"})
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                return _json_response(404, {"error": "not found"})
            data = path.read_bytes()
        except OSError:
            return _json_response(404, {"error": "not found"})
        content_types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
        }
        return (
            200,
            data,
            content_types.get(path.suffix.lower(), "application/octet-stream"),
        )

    async def _intent(
        self, headers: dict[str, str], body: bytes
    ) -> tuple[int, bytes, str]:
        auth = headers.get("authorization", "")
        expected = f"Bearer {self.token}"
        if not hmac.compare_digest(auth, expected):
            return _json_response(401, {"error": "unauthorized"})
        try:
            request = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _json_response(400, {"error": "invalid JSON"})
        if not isinstance(request, dict):
            return _json_response(400, {"error": "object required"})
        action = request.get("action")
        if action not in INTENT_ACTION_ALLOWLIST:
            return _json_response(
                403,
                {
                    "error": "action not allowed",
                    "allowed": sorted(INTENT_ACTION_ALLOWLIST),
                },
            )
        television = request.get("television", self.television)
        if not isinstance(television, str) or not television:
            return _json_response(400, {"error": "television required"})
        forward = {key: value for key, value in request.items() if key != "television"}
        forward["television"] = television
        try:
            response = await send_control_request(
                self.control_file, forward, timeout=self.timeout
            )
        except ControllerError as error:
            return _json_response(502, {"error": str(error)})
        return _json_response(200, response)


async def run_bridge(
    *,
    host: str,
    port: int,
    art_directory: Path,
    control_file: Path,
    television: str | None,
    timeout: float,
) -> tuple[BridgeServer, str]:
    token = load_or_create_token(control_file)
    server = BridgeServer(
        art_directory=art_directory,
        control_file=control_file,
        token=token,
        television=television,
        timeout=timeout,
    )
    await server.start(host, port)
    return server, token
