# LS03D sensor-driven Art

Validated on QN55LS03DAFXZC in November 2026. Implemented on top of PR 7.
The user confirmed that covering the sensor visibly dims the installed Art app.

## Firmware evidence

The ARM32 `libvideoenhance.so.0` exports `ve_get_sensor_detected(int*)` and
`ve_get_colorsensor_info(VEPPIColorSensorInfo_t*)`. Inspection of `libave.so`
and `libecs-tv.so.0` established a 32-byte structure of eight consecutive
32-bit integers: five raw channels, lux at byte 20, CCT at byte 24, IC at byte 28.
The tested sensor reports IC 23 and successful status 0. The helper only reads.
No vendor binaries are included in this repository.

Covered readings ranged from 1 to 24 lux; uncovering returned to 1000 lux.
The getter saturates at 1000 lux on this platform; CCT is limited to 2700–6500 K.
Warm-room readings also varied around 39–49 lux and 2700 K. Readings remain live
outside Samsung's native Art Mode. These are firmware-reported values, not
measurements independently calibrated against a lux meter or spectrometer.

`screen_manager_subscribe_frame_lux_changed` and Frame picture handling exist
in the firmware. Read-only AV output queries returned backlight 45 and colour
tone mode 4. Their setters were not used; they affect global TV picture state.

## Implementation and limits

The native helper emits one schema-1 JSON record, tolerating Samsung diagnostics
around it. The Python adapter rejects failed, missing, or out-of-range samples.
The bridge exposes GET `/sensor/ambient`, authenticated by a separate read-only
token. This token cannot call `/intent`. The server caches samples for two seconds.

Art polls every three seconds while visible. Samples expire after 12 seconds,
then output smoothly returns to manual brightness and neutral tone. Independent
adaptive toggles persist. The Art settings panel displays live lux and kelvin.

Brightness uses `(clamp((lux - 2) / 498, 0, 1)) ** 0.6` between Art floor and
the manual brightness ceiling, with a three-second exponential transition.
Art floor 0 permits a 2% image gain. Tone reduces green and blue relative to red
as CCT falls, with a capped strength of 0.7. Below 5 lux, CCT is treated as
unreliable and tone returns to neutral. The SVG matrix affects the art only.

This is an intentionally tunable application response, not a reconstruction of
Samsung's proprietary calibration. Image dimming does not reduce the LCD's
physical backlight or black floor. Matching stock Art Mode precisely would need
controlled illumination and independent display/light measurements.

## Deployment

1. Build `payloads/ls03d/SamsungFrameSensor.csproj` with `dotnet build -c Release
   -o payloads/ls03d/out`. Transfer its DLL and runtimeconfig JSON through the
   authenticated root connection to `/home/owner/share/framed-sensor/`.
   Keep these outside the root daemon's temporary staging directory, which is
   removed during cleanup. The runtime command is `/usr/bin/dotnet
   /home/owner/share/framed-sensor/SamsungFrameSensor.dll`.
2. With the existing root daemon connected, run `samsung-tv-root --config CONFIG
   --control-file CONTROLLER sensor ambient frame` to validate the reading.
3. Generate a separate random read-only token (at least 32 characters) in a local
   file. Start `samsung-tv-root --config CONFIG --control-file CONTROLLER bridge
   --art-dir ART_DIRECTORY --television frame --sensor-token-file TOKEN_FILE`.
4. Copy `framed/bridge.example.json` to ignored `framed/bridge.local.json`, setting
   the reachable desktop bridge URL and the read-only token. Never embed the
   privileged bridge/controller credential. Sign and install the Tizen package.
   Treat that package as private because it embeds the read-only credential.
5. Enable either adaptive toggle in Art. Adjust Art floor for the desired darkest
   result. The desktop bridge and existing root connection must remain available.

The installed Windows deployment runs the ambient bridge at user login through
the task `Samsung TV Ambient - Frame`. Restarting that task was verified to
recover live readings; a full TV reboot was not tested. Root service recovery is
still the responsibility of the existing root installation.

## Validation

176 Python tests passed; four were skipped. `node tests/test_adaptive.js` passed
darkness, CCT, manual limits, stale data, and smoothing checks. The native helper
built without warnings. Browser verification covered live readings, dimming,
tone, and saved toggles after reload. The installed TV package passed the user's
physical cover/uncover test. Tone calibration remains an approximation.
