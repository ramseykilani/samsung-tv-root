# LS03D sensor-driven Art

This feature supports sensor-driven Art customization on your own Frame TV
or one you have explicit permission to configure.

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

The app polls every three seconds while visible, including on the launcher and
other screens, so Art's brightness and tone are prepared before entry. Off Art,
new readings apply immediately to its hidden stage; while viewing Art, changes
retain smooth transitions. Samples expire after 12 seconds,
then automatic brightness smoothly returns to a fixed 15% fallback and neutral tone.
Hiding the app pauses polling but retains the last reading and displayed
brightness/tone for the current app session. Resuming starts at that same output
and resumes adjustment without resetting to the fallback. Retained readings keep
their original expiry time. A cold launch still needs its first sensor response.
Manual brightness is used only when adaptive brightness is off. Independent
adaptive toggles persist. The Art settings panel displays live lux and kelvin.

Brightness uses a smooth shifted power curve, with slider percentage
`5 * ((lux - 1.18) / 0.82) ** 0.336` above 2 lux and a fixed 5% at 0–2 lux.
This is a weighted least-squares fit to (4.5, 8), (12.5, 13), (27.5, 15),
(213, 33), (586, 45), anchored at (2, 5). Fit weights are 3, 3, 3, 1, 0.5:
low-light observations take precedence; 213 lux used normal room lighting;
586 lux used a direct lamp and remains provisional. Rounded fit parameters
produce about 8%, 12%, 16%, 32%, and 45% at those readings, and about 54%
at the sensor's 1000-lux limit. Above the floor the curve is smooth, increasing,
and concave, with no interpolation corners. The region above 586 lux is an
unvalidated extrapolation. Transitions retain three-second exponential smoothing.
Auto ignores saved manual brightness and legacy Art floor values; Art floor is
no longer a setting.
Percentages use the manual slider's gain mapping (2% + 98% × slider/100), so
5% auto matches 5% manual visually. Tone reduces green and blue relative to red
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
5. Enable either adaptive toggle in Art. Automatic brightness has a fixed 5%
   minimum; switch it off to expose the independent manual brightness slider. The desktop bridge and existing root connection must remain available.

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

### Calibration reference

Samsung's [Art Mode guide](https://www.samsung.com/us/support/answer/ANS10005239/)
describes ambient brightness/color adjustment, but does not publish numerical
lux-to-brightness calibration. Our percentages are software image gain, not a
Samsung panel-brightness scale. The user measurements above define this curve.

Art menu value rows apply changes with Left/Right or explicit pointer selection.
OK leaves their current values unchanged; action rows such as Reset still execute.
