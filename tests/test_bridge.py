from __future__ import annotations

import asyncio
import json

import pytest

from samsung_tv_root.bridge import (
    INTENT_ACTION_ALLOWLIST,
    BridgeServer,
    _scan_art,
    load_or_create_token,
)


def test_scan_art_lists_images_and_titles(tmp_path):
    (tmp_path / "Sunset_Lake.png").write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("not an image")
    (tmp_path / "deep-web.jpg").write_bytes(b"x")
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "hidden.png").write_bytes(b"x")

    manifest = _scan_art(tmp_path)

    versions = {im["file"]: im.pop("version") for im in manifest["images"]}
    assert all(versions.values())
    assert manifest == {
        "images": [
            {"file": "Sunset_Lake.png", "title": "Sunset Lake"},
            {"file": "deep-web.jpg", "title": "deep web"},
        ]
    }


def test_scan_art_version_changes_when_file_is_replaced(tmp_path):
    image = tmp_path / "art.png"
    image.write_bytes(b"first")
    first = _scan_art(tmp_path)["images"][0]["version"]
    assert _scan_art(tmp_path)["images"][0]["version"] == first
    image.write_bytes(b"replacement")
    assert _scan_art(tmp_path)["images"][0]["version"] != first


def test_scan_art_missing_directory(tmp_path):
    assert _scan_art(tmp_path / "absent") == {"images": []}


def test_load_or_create_token_persists(tmp_path):
    control_file = tmp_path / "controller.json"
    first = load_or_create_token(control_file)
    second = load_or_create_token(control_file)
    assert first == second
    assert len(first) >= 32
    stored = tmp_path / "bridge-token"
    assert stored.exists()
    assert stored.read_text().strip() == first


def _start_server(tmp_path):
    server = BridgeServer(
        art_directory=tmp_path,
        control_file=tmp_path / "controller.json",
        token="a" * 43,
        television="frame",
    )
    return server


def _make_req(port, method, path, body=b"", headers=None):
    head = f"{method} {path} HTTP/1.1\r\nHost: x\r\nContent-Length: {len(body)}\r\n"
    for name, value in (headers or {}).items():
        head += f"{name}: {value}\r\n"
    return head.encode() + b"\r\n" + body


def test_bridge_health_and_art(tmp_path):
    (tmp_path / "a.png").write_bytes(b"PNGDATA")
    server = _start_server(tmp_path)

    async def main():
        await server.start("127.0.0.1", 0)
        port = server.server.sockets[0].getsockname()[1]
        task = asyncio.ensure_future(server.serve_forever())
        try:
            await asyncio.sleep(0.05)
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(_make_req(port, "GET", "/art/index.json"))
            await writer.drain()
            writer.write_eof()
            raw = await reader.read()
            writer.close()
            assert raw.startswith(b"HTTP/1.1 200")
            assert b"Cache-Control: no-store" in raw
            payload = json.loads(raw.split(b"\r\n\r\n", 1)[1])
            assert payload["images"][0]["file"] == "a.png"
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(_make_req(port, "GET", "/art/a.png?v=1"))
            await writer.drain()
            writer.write_eof()
            raw = await reader.read()
            writer.close()
            assert b"Cache-Control: private, max-age=60" in raw
            assert raw.endswith(b"PNGDATA")

        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(main())


def test_bridge_art_path_traversal_rejected(tmp_path):
    server = _start_server(tmp_path)

    async def main():
        await server.start("127.0.0.1", 0)
        port = server.server.sockets[0].getsockname()[1]
        task = asyncio.ensure_future(server.serve_forever())
        try:
            await asyncio.sleep(0.05)
            for path in ("/art/../secret", "/art/..%2fsecret", "/art/sub/x.png"):
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                writer.write(_make_req(port, "GET", path))
                await writer.drain()
                writer.write_eof()
                raw = await reader.read()
                writer.close()
                assert raw.startswith(b"HTTP/1.1 403"), path
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(main())


def test_intent_auth_and_allowlist(tmp_path):
    server = _start_server(tmp_path)
    token = server.token

    async def main():
        await server.start("127.0.0.1", 0)
        port = server.server.sockets[0].getsockname()[1]
        task = asyncio.ensure_future(server.serve_forever())
        try:
            await asyncio.sleep(0.05)
            # no auth -> 401
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(_make_req(port, "POST", "/intent", b'{"action":"app.list"}'))
            await writer.drain()
            writer.write_eof()
            assert (await reader.read()).startswith(b"HTTP/1.1 401")
            writer.close()
            # bad auth -> 401
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(
                _make_req(
                    port,
                    "POST",
                    "/intent",
                    b'{"action":"app.list"}',
                    {"Authorization": "Bearer nope"},
                )
            )
            await writer.drain()
            writer.write_eof()
            assert (await reader.read()).startswith(b"HTTP/1.1 401")
            writer.close()
            # good auth, disallowed action -> 400 allowlist
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(
                _make_req(
                    port,
                    "POST",
                    "/intent",
                    b'{"action":"remote.inject"}',
                    {"Authorization": f"Bearer {token}"},
                )
            )
            await writer.drain()
            writer.write_eof()
            raw = await reader.read()
            writer.close()
            assert raw.startswith(b"HTTP/1.1 403")
            assert b"action not allowed" in raw
            # good auth, allowed action, daemon down -> 502
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(
                _make_req(
                    port,
                    "POST",
                    "/intent",
                    b'{"action":"app.list"}',
                    {"Authorization": f"Bearer {token}"},
                )
            )
            await writer.drain()
            writer.write_eof()
            raw = await reader.read()
            writer.close()
            assert raw.startswith(b"HTTP/1.1 502"), raw
        finally:
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

    asyncio.run(main())


def test_allowlist_excludes_privileged_actions():
    for action in ("root.acquire", "remote.inject", "config.update", "uep.disable"):
        assert action not in INTENT_ACTION_ALLOWLIST
