import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from samsung_tv_root.ambient import AmbientSensorError, SENSOR_COMMAND, parse_ambient_result
from samsung_tv_root.bridge import BridgeServer


def reading(**changes):
    value = dict(schema=1, detected_status=0, color_status=0, detected=1,
                 raw=[1, 5, 1, 4, 0], lux=1, cct=2700, ic=23)
    value.update(changes)
    return dict(exit_code=0, timed_out=False,
                stdout='ave_ppi_init start\n' + json.dumps(value) + '\nget_colorsensor_info diagnostic\n')


def test_darkness_is_valid_but_colour_unreliable():
    result = parse_ambient_result(reading(lux=0))
    assert result['lux'] == 0
    assert result['color_reliable'] is False
    assert parse_ambient_result(reading(lux=20, cct=4500))['color_reliable'] is True


@pytest.mark.parametrize('changes', [dict(lux=-1), dict(lux=True), dict(cct=0),
    dict(color_status=-1), dict(detected=0), dict(raw=[]), dict(ic=0)])
def test_invalid_sensor_data_never_becomes_a_light_reading(changes):
    with pytest.raises(AmbientSensorError):
        parse_ambient_result(reading(**changes))


def test_read_only_token_cannot_execute_and_reads_are_cached(tmp_path):
    server = BridgeServer(art_directory=tmp_path, control_file=tmp_path/'controller.json',
                          token='privileged', television='frame', sensor_token='read-only')
    async def main():
        with patch('samsung_tv_root.bridge.send_control_request', new_callable=AsyncMock) as send:
            send.return_value = reading(lux=20)
            assert (await server._ambient({'authorization':'Bearer privileged'}))[0] == 401
            assert (await server._intent({'authorization':'Bearer read-only'}, b'{"action":"execute","command":"id"}'))[0] == 401
            headers = {'authorization':'Bearer read-only'}
            assert (await server._ambient(headers))[0] == 200
            assert (await server._ambient(headers))[0] == 200
            assert send.await_count == 1
            assert send.call_args.args[1]['command'] == SENSOR_COMMAND
            server._sensor_cache = None
            send.return_value = reading(color_status=-1)
            assert (await server._ambient(headers))[0] == 502
            assert server._sensor_cache is None
    asyncio.run(main())
