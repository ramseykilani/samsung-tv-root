"""Read the LS03D colour sensor through the verified 32-byte VE ABI."""
from __future__ import annotations

import json
from typing import Any

SENSOR_COMMAND = "/usr/bin/dotnet /home/owner/share/framed-sensor/SamsungFrameSensor.dll"


class AmbientSensorError(RuntimeError):
    pass


def parse_ambient_result(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("timed_out") or result.get("exit_code") != 0:
        raise AmbientSensorError("Ambient sensor helper unavailable or failed")
    # Samsung's native library emits diagnostics on stdout, including at exit.
    records = []
    for line in result.get("stdout", "").splitlines():
        try:
            value = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict) and value.get("schema") == 1:
            records.append(value)
    if len(records) != 1:
        raise AmbientSensorError("Invalid ambient sensor response")
    value = records[0]
    for key in ("detected_status", "color_status"):
        if type(value.get(key)) is not int or value[key] != 0:
            raise AmbientSensorError("Sensor read failed")
    if type(value.get("detected")) is not int or value["detected"] != 1:
        raise AmbientSensorError("Colour sensor not detected")
    for key, lower, upper in (("lux", 0, 1000), ("cct", 2700, 6500), ("ic", 1, 255)):
        if type(value.get(key)) is not int or not lower <= value[key] <= upper:
            raise AmbientSensorError("Invalid sensor " + key)
    raw = value.get("raw")
    if not isinstance(raw, list) or len(raw) != 5 or any(type(n) is not int or n < 0 for n in raw):
        raise AmbientSensorError("Invalid raw sensor channels")
    return {"lux": value["lux"], "cct_kelvin": value["cct"],
            "color_reliable": value["lux"] >= 5, "sensor_ic": value["ic"],
            "raw_channels": raw, "lux_saturated": value["lux"] == 1000,
            "source": "ls03d.ve_get_colorsensor_info"}


async def read_ambient(connection: Any) -> dict[str, Any]:
    result = await connection.execute(SENSOR_COMMAND, 5.0)
    return parse_ambient_result({"stdout": result.stdout, "exit_code": result.exit_code,
                                 "timed_out": result.timed_out})
