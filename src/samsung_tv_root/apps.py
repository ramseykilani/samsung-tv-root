"""Generic Tizen application control.

These adapters use on-device Tizen tools that are not model specific:
``pkginfo``/``ail`` for enumeration and ``app_launcher``/``wrt-launcher`` for
launch. Samsung ships all of them on retail Tizen TVs.
"""

from __future__ import annotations

import re
import shlex
from dataclasses import asdict, dataclass
from typing import Protocol


DEFAULT_APP_COMMAND_TIMEOUT = 10.0
APP_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
PKG_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

LIST_APPS_COMMAND = (
    "{ pkginfo --listpkg 2>/dev/null; } ; "
    "for d in /opt/usr/apps /home/apps; do "
    "if test -d $d; then ls -1 $d; fi; done"
)

LAUNCH_CANDIDATES = (
    ("app_launcher", "/usr/bin/app_launcher -s {app}"),
    ("wrt-launcher", "/usr/bin/wrt-launcher -s {app}"),
    ("ail", "/usr/bin/ail launch {app}"),
)


class AppControlError(RuntimeError):
    pass


class RootCommandResult(Protocol):
    exit_code: int
    timed_out: bool
    stdout: str
    stderr: str


class RootCommandConnection(Protocol):
    async def execute(self, command: str, timeout: float) -> RootCommandResult: ...


@dataclass(frozen=True)
class TizenApp:
    app_id: str
    label: str | None

    def to_dict(self) -> dict[str, str | None]:
        return asdict(self)


@dataclass(frozen=True)
class TizenAppLaunch:
    app_id: str
    launcher: str
    stdout: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


class TizenAppControl:
    async def list_apps(
        self,
        connection: RootCommandConnection,
        timeout: float = DEFAULT_APP_COMMAND_TIMEOUT,
    ) -> tuple[TizenApp, ...]:
        result = await connection.execute(LIST_APPS_COMMAND, timeout)
        if result.timed_out:
            raise AppControlError("application enumeration timed out")
        seen: set[str] = set()
        apps: list[TizenApp] = []
        for line in result.stdout.splitlines():
            value = line.strip()
            # pkginfo emits "pkgid=[<id>]" records or bare package ids.
            match = re.fullmatch(r"pkgid=\[(.+)\]", value)
            if match is not None:
                value = match.group(1)
            if PKG_ID_PATTERN.fullmatch(value) is None or value in seen:
                continue
            seen.add(value)
            apps.append(TizenApp(app_id=value, label=None))
        return tuple(apps)

    async def launch_app(
        self,
        connection: RootCommandConnection,
        app_id: str,
        timeout: float = DEFAULT_APP_COMMAND_TIMEOUT,
    ) -> TizenAppLaunch:
        if APP_ID_PATTERN.fullmatch(app_id) is None:
            raise AppControlError(f"invalid application id: {app_id!r}")
        failures = []
        for launcher, template in LAUNCH_CANDIDATES:
            command = template.format(app=shlex.quote(app_id))
            result = await connection.execute(command, timeout)
            if result.timed_out:
                raise AppControlError(f"{launcher} launch timed out")
            output = result.stdout.strip()
            if result.exit_code == 0:
                return TizenAppLaunch(
                    app_id=app_id,
                    launcher=launcher,
                    stdout=output,
                )
            detail = result.stderr.strip() or output or "no output"
            failures.append(f"{launcher}: exit {result.exit_code}: {detail}")
        raise AppControlError(
            "all application launchers failed; " + "; ".join(failures)
        )
