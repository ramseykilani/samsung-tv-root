# Samsung Frame (2024, LS03D / Tizen 8.0) setup runbook

This runbook turns a retail Frame TV into a rooted, remote-remapped,
hardened TV using the **generic archive root route** (`model = "ls03d"`).
It works the same on macOS and Windows — the only differences are install
paths, called out where they appear.

Root on Tizen is **volatile by design**: it disappears when the TV loses
power. The daemon running on your always-on desktop reacquires it
automatically every time the TV appears on the network. Once set up, you
never repeat these steps unless Samsung ships a firmware update that
breaks the exploit.

## What you end up with

- Netflix/Prime (and other branded remote buttons) launch **your** apps —
  Stremio, YouTube, the `framed` launcher, Art mode.
- Ads, ACR tracking, telemetry, and always-on voice services disabled.
- A custom Mhach-dark launcher/art app (`framed.wgt`) installed as a
  first-class TV app.

## Part 1 — one-time desktop install (15 min)

1. **Install Tizen Studio** from
   https://developer.tizen.dev/ko/development/tizen-studio/download —
   during setup pick the **TV Extension** package (Package Manager →
   Extension SDK → TV Extensions). This gives you `sdb`, the Samsung
   Debug Bridge tool.
   - macOS: `sdb` lands in `~/tizen-studio/tools/sdb`
   - Windows: `C:\tizen-studio\tools\sdb.exe`
2. **Install the samsung-tv-root release** on the same desktop: download
   the latest release archive for your OS, extract it, and put
   `samsung-tv-root` (Windows: `samsung-tv-root.exe`) somewhere on your
   PATH. Verify: `samsung-tv-root doctor`.
3. **Find your TV's IP address** — on the TV: Settings → General →
   Network → Network Status → IP Settings. Write it down.

## Part 2 — enable Developer mode on the TV (2 min)

1. On the TV home screen, open **Apps** (the app panel, not an app).
2. Using the remote's number keys, type `1` `2` `3` `4` `5`. The
   **Developer mode** dialog appears.
3. Set **Developer mode** to **On**.
4. In the **Host PC IP** field, enter your desktop's IP address (the
   machine that will run the daemon — same network).
5. Reboot the TV when prompted (Settings → Support → Self Diagnosis →
   Reset isn't needed; just power off/on from the dialog's prompt).

Verify the link from the desktop:

```console
sdb connect <TV-IP>
sdb devices
```

`List of devices` should show `<TV-IP>:26101` with a device name.

## Part 3 — probe the TV (1 min)

From the desktop:

```console
samsung-tv-root archive-root probe <TV-IP>
```

This performs a full root acquisition and cleanup — the actual exploit
chain run once — and reports whether the four preconditions hold
(dotnet capability bits, tarlauncher capability, `tar --to-command`,
.NET runtime ≥ 3.1) plus the authenticated root identity. If any check
fails, the probe says exactly which one — stop there and report the
output.

## Part 4 — configure the daemon

Run `samsung-tv-root config init`, then edit the file it prints:

```toml
version = 1

[televisions.frame]
model = "ls03d"
host = "<TV-IP>"
root_on_presence = true
disable_native_execution_policy = false

[televisions.frame.remote]
enabled = true
devices = [
  { name = "Smart Control", transport = "bluetooth" },
]
rules = [
  { device = "Smart Control", key = "XF86Netflix", action = "app.launch", app = "org.stremio.one" },
  { device = "Smart Control", key = "XF86Amazon", action = "app.launch", app = "<youtube-pkgid>" },
  { device = "Smart Control", key = "XF86Home", action = "app.launch", app = "cmfrmdlnch" },
]

[televisions.frame.events]
enabled = false
hdmi_receiver = false
```

Notes:

- **Remote device name**: run `samsung-tv-root remote devices frame`
  *after* the daemon is up to see the exact `name`/`transport`/`model` of
  your remote, then fill `devices` to match. `samsung-tv-root remote
  events frame` (observe mode) shows the real key names each branded
  button emits — Samsung has used several names across remotes
  (`XF86Netflix`, `Netflix`, `KEY_NETFLIX`, …), so confirm before
  writing rules.
- **App ids**: run `samsung-tv-root apps list frame` after rooting and
  pick the real package ids for Stremio/YouTube on your firmware —
  they vary by region. `app.launch` takes the **package id** from that
  list: for `framed` it is `cmfrmdlnch` (not the widget id
  `com.framed.launcher`, and not the Tizen app id `cmfrmdlnch.framed`).
- **Home button → framed**: the last rule above is that mapping. A web
  app cannot claim the Home key itself — Samsung takes it to Smart Hub
  before any app sees it — so this only works host-side: with a rule
  present the remote agent grabs the remote, withholds the matched
  `XF86Home` keypress from the TV, and the daemon launches `framed`
  instead. Confirm the key name first with `remote events` in observe
  mode (most Samsung remotes emit `XF86Home`, evdev code 63; a few emit
  `Home` — match `key` to what you see, or match `code = 63`). It is
  live only while the daemon is running and the TV is rooted; if the
  desktop is off, Home falls back to stock Smart Hub. Pressing Home
  while `framed` is already in front simply re-launches it.
- **A dedicated "show art" button**: map any spare key to the framed
  package the same way Home is mapped, then set **Start in →
  Art** in framed's Art settings panel (art screen → `s`). A fresh launch then opens on the piece of art
  itself (Back still reaches the launcher), so the key behaves like
  Samsung's Art-mode toggle. Example:
  `{ device = "Smart Control", key = "XF86Red", action = "app.launch", app = "cmfrmdlnch" }`.
- **Power button → art ("tri-state")**: the same trick works for the
  power key — `{ key = "XF86PowerOff", action = "app.launch", app = "cmfrmdlnch" }`
  makes a short press show art instead of standing by. Confirm the
  emitted key name with `remote events` in observe mode first (Samsung
  remotes have used several names), and note two caveats: the rule
  withholds *every* press from the TV, so long-press standby from the
  remote stops working while it is active (use the TV's own button or
  `display.picture_off` for a real screen-off); and there is no
  "press again to return to TV" toggle yet — that needs a
  foreground-app-conditional rule, which the rule engine does not
  currently support.
- `disable_native_execution_policy = false` leaves UEP alone — the
  archive route doesn't need it disabled.

## Part 5 — run the daemon and make it permanent

```console
samsung-tv-root daemon run
```

Watch the log until you see `rooted` for `frame`. Then:

```console
samsung-tv-root service install --enable --now
```

This registers the daemon with launchd (macOS) or as a Windows service
so it starts with the desktop. From now on: TV reboots → daemon sees it
via network presence → re-roots → remote remap live again, typically
within seconds of the TV finishing boot.

## Part 6 — hardening pass (voice, telemetry, ads)

Once rooted:

```console
samsung-tv-root execute frame "$(cat tools/harden-tv.sh)" --timeout 60
```

(Windows PowerShell: `samsung-tv-root execute frame (Get-Content -Raw tools/harden-tv.sh) --timeout 60`)

The script is idempotent — rerun it any time the TV reboots and re-roots.
It installs an `/etc/hosts` sinkhole for Samsung ad/ACR/telemetry
domains, stops voice-stack processes, disables voice packages where the
package manager allows, and prints an audit of what's left.

## Part 7 — install the framed app

```console
sdb push framed.wgt /home/owner/share/tmp/framed.wgt
samsung-tv-root execute frame "pkgcmd -i -t wgt -p /home/owner/share/tmp/framed.wgt" --timeout 60
```

The launcher appears in the app list (`apps list` shows its package id
as `cmfrmdlnch` — confirm it is there). The `XF86Home` rule from Part 4
already points Home at it; a spare remote button can carry the same
`app.launch` rule with `app = "cmfrmdlnch"`.

## Part 8 — LAN bridge: art share + voice intents

Two LAN-facing jobs live behind one small server that runs next to the
daemon on the always-on desktop:

1. **Art share** — the framed web app can't read an SMB share, so the
   bridge serves a folder of your images over plain LAN HTTP, with an
   auto-generated `index.json` manifest the slideshow reads. Drop files
   in the folder; they appear on the TV.
2. **Voice intents** — a `POST /intent` endpoint authenticated by a
   bearer token that forwards a small allowlist of actions
   (`app.list`, `app.launch`, `volume.*`, `display.*`, `source.*`,
   `execute`) to the running daemon's control socket. This is what an
   Alexa skill or any LAN client talks to — privileged actions like
   `root.acquire` and `remote.inject` are not exposed.

```console
samsung-tv-root bridge --art-dir ~/Pictures/tv-art --television frame
```

The startup output prints the listening URL, the art manifest URL
(`http://<desktop-ip>:8765/art/index.json` — point the app's
`REMOTE_ART_BASE` at it), the intent endpoint, and the generated
bearer token (persisted in `bridge-token` beside the control file,
mode 600).

For a permanent install, run it under launchd/systemd/Task Scheduler
the same way as the daemon (`service install` covers the daemon; add a
second unit for the bridge, or run both under one supervisor).

**Alexa on/off**: no bridge needed — link the TV through the SmartThings
skill in the Alexa app and it joins routines like a smart light.

**Alexa deep voice ("play this movie")**: a custom Alexa skill hits
`/intent` with `{ "action": "app.launch", "app": "<pkgid>" }`. Since
Amazon's cloud can't reach the LAN directly, front the endpoint with a
small tunnel (e.g. `cloudflared`) — the token plus the action allowlist
keeps the exposed surface narrow. Stremio deep-link arguments remain an
on-device probe item; until confirmed, the skill can fall back to
launching the `framed` launcher itself.

## Troubleshooting

- **`sdb devices` is empty**: TV and desktop on different networks, or
  Developer mode got switched off (a factory reset or some firmware
  updates turn it off — redo Part 2).
- **Probe fails a precondition**: firmware too new/old for this route —
  report the probe output; the QN90F-style kernel route is a separate
  port.
- **Buttons revert to stock**: daemon isn't running (check
  `samsung-tv-root status`), or the remote device name in config doesn't
  match `remote devices` output.
- **An app won't launch**: wrong package id — recheck `apps list`.
