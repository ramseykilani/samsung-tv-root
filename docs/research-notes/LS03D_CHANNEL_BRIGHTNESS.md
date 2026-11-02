# Channel Up/Down as a global brightness key — feasibility (LS03D)

Owner request: Channel Up/Down should adjust real panel brightness TV-wide —
inside framed's launcher/media screens and inside other apps (Moonlight,
Stremio, native TV). Art mode stays sensor-adaptive.

## What the remote layer can already do

`remote.py` + `payloads/common/SamsungTvRemoteInputAgent.cs` run in **filter
mode**: the agent exclusively grabs the configured evdev device and forwards
unmatched events through a `uinput` virtual device, withholding only keys named
by rules. Rules match by key name (from
`/usr/share/X11/xkb/tizen_key_layout.txt.tv` plus fallbacks) or by numeric
evdev `code`.

Channel Up/Down are standard evdev `KEY_CHANNELUP` (402) and
`KEY_CHANNELDOWN` (403) on the same Smart Control device, so the keys are
claimable today with config only:

```toml
rules = [
  { device = "Smart Control", code = 402, action = "display.brightness.up" },
  { device = "Smart Control", code = 403, action = "display.brightness.down" },
]
```

Confirm the emitted names/codes first with `remote events` in observe mode.
Caveats of a global claim:

- The grab withholds the keys from *every* app, including framed — whose media
  grid currently maps keyCode 403/404 (Channel keys in the web runtime) to
  Save/Watched shortcuts (`framed/js/screens/media.js`). A global claim removes
  those shortcuts; fine if the owner prefers brightness there.
- Rules are not foreground-app-conditional, so the same press fires the same
  action inside framed, Moonlight, and the TV source alike — exactly the
  requested coverage — and it lives only while the daemon + agent run (same
  blast radius as the existing Home/app.launch remaps).

## What a brightness action could drive

Checked for a writable panel-brightness interface reachable by the root agent:

- **framed's own slider** — a CSS `brightness()` filter on the art stage only.
  Cannot dim other apps; not a panel interface.
- **Tizen web APIs** — `systeminfo`/`power` brightness properties are
  read-only or absent on the TV profile; the only setter is the partner-level
  `systemcontrol` WebAPI (SamsungDForum SystemSettings sample), which needs
  partner-signed privileges framed can't hold.
- **`libdeviced`** — already P/Invoked by `Qn90fDisplayNative.cs`, but only for
  `device_power_*` / `device_*_screen_state` (panel on/off). Its
  `device_display_*_brightness` calls are mobile-profile plumbing; unvalidated
  on the TV profile.
- **`org.tizen.system.deviced` dbus** — the repo uses
  `display.GetScreenState` (QN90B). A `SetBrightness` member may exist on the
  TV deviced; needs on-device introspection
  (`dbus-send --system --print-reply --dest=org.tizen.system.deviced
  /Org/Tizen/System/DeviceD/Display org.freedesktop.DBus.Introspectable.Introspect`).
- **Firmware AV-output registers** — `docs/ls03d-adaptive-art.md`: read-only
  AV queries returned backlight 45 and colour tone mode 4; their setters exist
  in the firmware libraries but were deliberately not used — they mutate
  global TV picture state (the same value the Picture menu writes), so
  stepping it also changes what the menu shows.
- **sysfs `/sys/class/backlight`** — no evidence of a writable node on this
  platform; the Frame's panel brightness is owned by the AV pipeline.

## Verdict

The *claim* half is done — Channel Up/Down are claimable by `code` rules today,
system-wide, no code changes needed. The *actuation* half has no validated
writable interface on LS03D: none of the checked paths is proven to move real
backlight, and the strongest lead (the firmware AV-output setter) is the same
knob the Picture menu owns — worth one on-TV probe session before packaging a
`display.brightness.*` capability + rule pair.

When an interface lands, the intended model is: remote rules → a
`display.brightness.up`/`.down` host action that steps panel brightness within
bounds, holding its last value in the controller (same pattern as
`local_dimming`'s state store). No on-screen UI initially — the keypress is its
own feedback; `overlay.graphics` is QN90F-only.

## Layering with art-mode dimming

Requested decomposition once a panel interface exists: drive the panel down to
its floor first, then let the CSS filter carry only the remainder below the
floor (the filter exists solely to go darker than the panel can). In
`adaptive-core.js` terms: `panel = clamp(target, floor..1)`,
`filter = target < floor ? target/floor : 1` — applied to both the adaptive
pipeline and any manual brightness path. Until a writable interface is
validated, art mode keeps filter-only dimming.
