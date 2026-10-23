import asyncio

from samsung_tv_root.capabilities import (
    CapabilityError,
    CapabilityState,
    TelevisionCapabilities,
)
from samsung_tv_root.config import RemoteConfiguration, TelevisionConfiguration


def television(model: str) -> TelevisionConfiguration:
    return TelevisionConfiguration(
        name=model,
        model=model,
        host="192.0.2.1",
        device_id=None,
        root_on_presence=True,
        disable_native_execution_policy=False,
        remote=RemoteConfiguration(),
    )


def test_qn90b_inventory_distinguishes_implementation_gaps() -> None:
    inventory = TelevisionCapabilities(television("qn90b")).inventory()
    states = {item["name"]: item["state"] for item in inventory}
    assert states["source.select"] == "implemented"
    assert states["local_dimming.toggle"] == "implemented"
    assert states["hdmi_policy.enforce"] == "not_investigated"
    assert states["display.picture_off"] == "implemented"
    assert states["screenshot.hdmi_960x540"] == "not_investigated"
    assert states["volume.status"] == "implemented"
    assert all(state != "unavailable" for state in states.values())
    assert all(
        state in {capability_state.value for capability_state in CapabilityState}
        for state in states.values()
    )


def test_qn90f_inventory_reports_known_non_packaged_capabilities() -> None:
    inventory = TelevisionCapabilities(television("qn90f")).inventory()
    states = {item["name"]: item["state"] for item in inventory}
    assert states["hdmi_policy.enforce"] == "implemented"
    assert states["screenshot.hdmi_960x540"] == "implemented"
    assert states["overlay.graphics"] == "implemented"
    assert states["volume.status"] == "implemented"
    assert all(state != "unavailable" for state in states.values())


def test_inventory_includes_daemon_and_remote_capabilities() -> None:
    inventory = TelevisionCapabilities(television("qn90f")).inventory()
    states = {item["name"]: item["state"] for item in inventory}
    assert states["root.acquire"] == "implemented"
    assert states["uep.disable"] == "implemented"
    assert states["remote.observe"] == "implemented"
    assert states["remote.filter"] == "implemented"
    assert states["volume.events"] == "implemented"
    assert states["events.tv_state"] == "implemented"


def test_ls03d_inventory_implements_apps_and_marks_adapter_gaps() -> None:
    inventory = TelevisionCapabilities(television("ls03d")).inventory()
    states = {item["name"]: item["state"] for item in inventory}
    assert states["app.list"] == "implemented"
    assert states["app.launch"] == "implemented"
    assert states["volume.status"] == "implemented"
    assert states["remote.filter"] == "implemented"
    assert states["source.select"] == "not_investigated"
    assert states["local_dimming.toggle"] == "not_investigated"
    assert states["display.picture_off"] == "not_investigated"
    assert states["screenshot.hdmi_960x540"] == "not_investigated"
    assert all(state != "unavailable" for state in states.values())


class _StubResult:
    def __init__(self, exit_code: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.exit_code = exit_code
        self.timed_out = False
        self.stdout = stdout
        self.stderr = stderr


class _StubConnection:
    def __init__(self, results: list[_StubResult]) -> None:
        self.results = results
        self.commands: list[str] = []

    async def execute(self, command: str, timeout: float) -> _StubResult:
        self.commands.append(command)
        return self.results.pop(0)


def test_ls03d_app_list_and_launch() -> None:
    capabilities = TelevisionCapabilities(television("ls03d"))
    list_connection = _StubConnection(
        [_StubResult(stdout="pkgid=[org.stremio.one]\nNFLXOldModel\n")]
    )
    listed = asyncio.run(capabilities.handle(list_connection, "app.list", {}))
    assert [app["app_id"] for app in listed["apps"]] == [
        "org.stremio.one",
        "NFLXOldModel",
    ]
    launch_connection = _StubConnection([_StubResult(stdout="launched\n")])
    launched = asyncio.run(
        capabilities.handle(launch_connection, "app.launch", {"app": "org.stremio.one"})
    )
    assert launched["launch"]["app_id"] == "org.stremio.one"
    assert launched["launch"]["launcher"] == "app_launcher"
    assert "org.stremio.one" in launch_connection.commands[0]


def test_ls03d_adapter_bound_action_reports_gap() -> None:
    capabilities = TelevisionCapabilities(television("ls03d"))
    try:
        asyncio.run(capabilities.handle(_StubConnection([]), "source.list", {}))
    except CapabilityError as error:
        assert "not_investigated" in str(error)
    else:  # pragma: no cover - assertion guard
        raise AssertionError("expected CapabilityError")
