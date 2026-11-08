# framed — design-agnostic skeleton

This app supports launcher and Art customization on your own Samsung Frame TV
or one you have explicit permission to configure. TV integration may use the
repository’s root controller; see the [project documentation](../README.md) for
its exploit-based root acquisition and security limitations.

> **Design: Mhach** — see HANDBACK.md beside this folder. Visual decisions live in `css/theme.css`
> (tokens + fonts) and `css/frames.css` (art frames); `css/app.css` is layout. The notes below about
> `theme-placeholder.css` describe the pre-design scaffold.

A launcher + art-mode web app for a Samsung Frame TV (2024 · Tizen 8.0 · 4K panel), delivered as
a **mechanics-complete, unstyled scaffold**. Plain HTML/CSS/JS — no build step, no framework, no
CDN, no webfonts; runs offline in the TV web runtime and opens as-is in a desktop browser.

**The visual design is intentionally not done.** Everything that is a visual decision lives in one
file, `css/theme-placeholder.css`, and is marked `DESIGN SURFACE: replace these tokens`. The
future design pass should treat that file as its replace-file and do a fresh design on top of the
mechanics described here — not redesign an existing look.

```
framed/
├── config.xml                 Tizen web-app manifest (wgt)
├── index.html                 single page, six screens, hash routing, plain <script> tags
├── css/
│   ├── theme-placeholder.css  ★ DESIGN SURFACE — every colour / font / radius / motion token
│   └── app.css                layout + mechanics only; consumes the tokens, holds no literals
├── js/
│   ├── bridge.js              window.__tvBridge STUB (the TV seam)
│   ├── library.js             ★ IMAGE SOURCE SEAM — returns the picture list (swap this file to change the source)
│   ├── slideshow.js           slideshow sequencer: cadence, order, position, daily/elapsed catch-up (no DOM)
│   ├── store.js               namespaced localStorage ("framed.*") with memory fallback
│   ├── toast.js               one-line status toast (tones: info | ok | error)
│   ├── controls.js            declarative TV controls (range / choice / swatch / action rows)
│   ├── nav.js                 d-pad focus engine (geometric nearest-in-direction)
│   ├── router.js              #/launcher · #/art · #/settings
│   ├── media.js               ★ MEDIA SOURCE SEAM — Stremio addon protocol client (catalog/meta/stream) + addon config block
│   ├── screens/launcher.js · art.js · settings.js · media.js · media-item.js · media-play.js
│   └── app.js                 boot
├── addons/
│   └── demo/                  bundled offline Stremio addon (manifest + catalog/meta/stream JSON)
└── assets/
    ├── icon.png
    ├── art/                   bundled picture library (6 placeholder test cards, landscape + portrait + square)
    └── media/                 bundled demo clip (demo.mp4, served by the demo addon)
```

## What is mechanical-complete vs. left for the designer

| Area | Done (mechanics) | Left for the design pass |
|---|---|---|
| Routing | Hash routes, default = launcher, Back semantics (home = no-op; panel closes first) | — |
| D-pad | Geometric focus engine, focus never lost, `Left/Right` adjust rows, pointer-remote hover, Tizen RETURN (10009) | Focus **look** (ring colour/width/scale are tokens) |
| Launcher | app list (Watch, YouTube, PC, Art, Settings; Mhach vertical list + art miniature), external → `__tvBridge.launch` via `EXTERNAL_APP_IDS`, clock+date | shipped: Mhach design |
| Art | 16:9 pictures only, whole, inside a thin frame that hugs them (no mat, no crop, no caption); 9 flat frame styles with colour choices, picture grid in the panel, per-picture look memory, persistence, panel focus-trap, `s` key, corner affordance reveal | Panel chrome, any motion |
| Slideshow | Library seam (`js/library.js`), sequencer (`js/slideshow.js`): off / every N hours / every N days, sequential / seeded shuffle, elapsed-period catch-up on open, Left/Right manual step, `p`/MediaPlayPause toggle, two-layer cross-fade on `--fr-motion`, picture grid in the panel (the one on the wall is marked), persistence | Cross-fade feel (duration/easing via `--fr-motion`), indicator typography, real picture content |
| Settings | Framed-level only: home-art bezel style, theme chooser with disabled "coming soon" slots, About. All art-level settings live in the Art panel | Real theme list and token blocks, all visuals |
| Theme | `html[data-theme]` hook, single token file, `--fr-motion` switch (0ms now) | **Everything in `theme-placeholder.css`** |
| Assets | Placeholder test cards + icon | Real imagery and icon |

## Screens

| Route | What | Keys |
|---|---|---|
| `#/launcher` (default, home) | App list: Watch · YouTube · PC · Art · Settings (+ art miniature) | ▴ ▾ move · OK open · Back does nothing |
| `#/art` | Fullscreen picture in a frame, filling the screen; no chrome | ◂ ▸ previous/next picture · `p` / MediaPlayPause slideshow on/off · ▴ ▾ reveal the corner affordance; OK on it (or `s`) opens the settings panel · Back closes the panel, Back again → home |
| `#/settings` | Home art · Theme · About | ▴ ▾ row · ◂ ▸ adjust · Back → home |
| `#/media` | Watch home, modelled on Stremio: **Board** (Continue + My List rows, then a row per catalog), Browse (one catalog, paged, with its genre filter), My List (sortable, type-filtered), Continue, Addons; Search over all of it | ▴ ▾ browse · ◂ ▸ switch catalog/shelf/filter · OK open · red (`s`) save · green (`w`) mark watched · Back clears search, then → home |
| `#/media-item` | Detail: backdrop, poster, title, year/genres/rating/cert/country, cast & director, description, Save/Resume/Mark watched/Dismiss actions, episodes (series), stream list with quality tags | ▴ ▾ move · OK act / play (or quiet refusal for unplayable sources) · Back → browse |
| `#/media-play` | Playback on the native HTML5 `<video>`, resuming at the saved position; next-episode popup + autoplay for series | OK play/pause · ◂ −10 s · ▸ +30 s · ▴ ▾ ∓60 s · green (`c`) playback panel (speed · subtitles · audio · autoplay) · media keys · Back → detail (position kept) |

Art options are persisted **per picture** in `localStorage["framed.artPer"]`; the most
recent look in `localStorage["framed.art"]` is the default for pictures without their own
memory. **Style** offers None, Set in, Shadow gap, Thin frame, Gallery metal, Shadowbox,
Paper edge, Linen and Wood. **Colour** appears only when that style has multiple colours.
The default is Thin frame / Black. There is no directional “Light from” setting; texture
and even contact shadows provide depth without directional lighting. The last colour
chosen for each style is remembered in `localStorage["framed.artTones"]`.

**Pixel shift** retains saved per-picture choices (on by default). Once per hour it moves
up to six actual 4K pixels from centre on each axis. A matching six-pixel inset keeps the
whole picture and frame on-screen, including at the extreme offsets; the small exposed
margin is bezel black. At Tizen's 1920×1080 CSS resolution, six 4K pixels become three CSS
pixels. Off removes the margin and movement. Both modes use contain sizing to preserve
pictures within the library's 1% tolerance of 16:9. None draws no frame, line or shadow; an exact 16:9
picture fills an exact 16:9 screen with Pixel shift off. The sides around other styles use
`--fr-bezel-black` (sRGB level 5). Changing colour never changes frame geometry.

Old global and per-picture settings migrate on read: Black → Thin frame / Black,
Black and gold → Thin frame / Gold line, Floating → Shadow gap / Black, and None → None.
Reset retains its existing scope: it resets the current picture and default look plus the
slideshow choices, preserving other pictures' settings. No uninstall or data reset is required.

The flat frame CSS and strip textures come from the 2026-11-07 design handoff. Its
`flat_frames.py` generator was not supplied; the checked-in assets are the source for this
integration. `tools/gen_frames.py` is the older directional-light renderer, not the generator
for these styles. The handoff was integrated into the current app, preserving playback,
adaptive brightness/tone, remote library refresh, and slideshow intervals. About identifies
this design as `framed 0.2.0 · Build 2026-11-07-a`.

Slideshow (persisted in `localStorage["framed.slideshow"]`, editable from the art panel): **Rotate** off · hours · days, with an **Every** interval row (1–48 hours or
1–30 days); **Order** sequential · shuffle (shuffle order is a seeded permutation, so it survives
reload and the position stays meaningful); **Pictures**: the panel opens on a grid of the library's
pictures, cropped as the screen shows them, with the cursor on the one on the wall (marked by the
seal bar). Arrows move, OK hangs the picture. Nothing about position is ever drawn on the stage.

- **Timed rotation:** a timer runs only while the Art screen is shown. On entry the sequencer
  advances by however many whole periods elapsed since `lastAdvance` (so an every-2-hours show
  that was closed for 5 h comes back 2 pictures on), then ticks on the remainder. Manual steps
  restart the period; changing the cadence or interval restarts it too.
- **Cross-fade:** two stacked `.art-layer`s; the next picture is preloaded and painted on the
  inactive layer, then `data-active` flips. The opacity transition is `var(--fr-motion)` — 0 ms in
  the scaffold, so the designer sets the feel from the token file alone.

Settings (persisted in `localStorage["framed.settings"]`): theme, home-art style, plus the
art-level values the Art panel edits — brightness 0–100, the **art floor** 0–100 (the darkest
level adaptive dimming may reach), adaptive brightness/tone toggles, and **Start in**
(Launcher · Art) — with Art, a fresh launch opens on the piece of art itself, so a remote key
mapped to the app via the daemon becomes a dedicated show-art button.

**Brightness is software dimming today.** The `__tvBridge` hardware path is still a stub, so the
slider (in the art panel, shown only when Adaptive brightness is Off) drives a CSS `brightness()` filter on the art stage
instead: 100 = undimmed, 0 = near-black (≈2 %) — deliberately far below Samsung's Art Mode
minimum, which never gets dark enough in a dim room. Tone warms (a sepia ramp) as the art dims,
standing in for adaptive tone until a light-sensor path exists. The filter covers only the stage;
panel and chrome stay at full brightness.

## The media seam (`js/media.js`)

The Media section is "our own Stremio": it speaks the public **Stremio addon protocol** to any
HTTP addon base. Each addon is just a base URL — the same string that precedes
`/manifest.json`:

| Request | Response used |
|---|---|
| `GET <base>/manifest.json` | `resources[]` (which of `catalog`/`meta`/`stream` it serves), `catalogs[]` |
| `GET <base>/catalog/<type>/<id>.json` | `metas[]` → poster grid items (`id`, `name`, `poster`, `releaseInfo`) |
| `GET <base>/meta/<type>/<id>.json` | `meta{}` → detail fields (`description`, `runtime`, `genres`, `imdbRating`) |
| `GET <base>/stream/<type>/<id>.json` | `streams[]` → normalized rows (`url` playable; `infoHash`/`externalUrl`/`ytId` not) |

Configure addons in the **marked config block at the top of `js/media.js`** (same convention
as `REMOTE_ART_BASE` in `js/library.js`):

```js
var MEDIA_ADDONS = [
  { name: 'Cinemeta',   base: 'https://v3-cinemeta.strem.io' },  // official movie/series catalog + meta
  { name: 'OpenSubtitles v3', base: 'https://opensubtitles-v3.strem.io' }, // external subtitles
  { name: 'Torrentio',  base: 'https://torrentio.strem.fun' },   // stream results (torrents → unplayable)
  { name: 'Local demo', base: 'addons/demo' }                    // bundled offline catalog
];
```

- `addons/demo/` is a **bundled addon** served from the app itself — same protocol, relative
  URLs — so Media works with zero network. Its one playable stream is `assets/media/demo.mp4`;
  it also advertises a torrent row to exercise the unplayable-source path.
- Streams are normalized to `{ name, label, sub, url, playable, kind }`. Anything that isn't a
  direct `http(s)` URL (`infoHash` torrent, `externalUrl`, `ytId`) comes back `playable:false`
  and the detail screen refuses it with a toast — the TV has no torrent engine.
- **Secret-bearing addon URLs** (debrid-configured addons like
  `https://torrentio.strem.fun/torbox=<key>` produced by
  [torrentio.strem.fun/configure](https://torrentio.strem.fun/configure), or a TorBox
  manifest URL `https://stremio.torbox.app/<api_key>/manifest.json`) contain API keys —
  keep them out of git. Two local-only installs:

  1. **Watch → Addons → “Install addon from URL”** — paste the URL on the on-screen
     keyboard; it persists in `localStorage`, never in git. Easiest TorBox hook-up:
     paste `https://stremio.torbox.app/<api_key>/manifest.json` (the key stays on the TV).
  2. A gitignored `addons.local.json` next to `index.html`:

     ```json
     {"addons": [{"name": "TorBox", "base": "https://stremio.torbox.app/<api_key>"}]}
     ```

     On the first `catalogs()` call the file is fetched once; entries whose `name` matches a
     default entry replace its `base`, unknown names are prepended. Absent file → quiet no-op.

  Either way the addon is a normal `<base>` — `<base>/manifest.json` declares its
  resources, `<base>/stream/<type>/<id>.json` answers stream requests. With a
  debrid-backed base, `stream/` responses become HTTPS `…/resolve/…` URLs the TV's
  `<video>` can play directly, so they land in the detail screen's “plays on this TV”
  group instead of the dead-source fold.
- Persisted state: `localStorage["framed.media"]` = `{ catalog, view }` (last catalog and
  shelf), and `localStorage["framed.watch"]` = the viewer's own data — `saved[]` (My List
  snapshots: item + a revivable catalog reference, newest first, cap 200) and `progress{}`
  (resume points keyed `type:id`, cap 40; a title past 92 % / the final 10 s counts as
  finished and drops off). Addon data itself is fetched fresh per visit.
- **Board / Discover:** Watch opens on the Board — Continue Watching and My List rows
  first, then one horizontal row per catalog (four catalogs at a time under More). The
  Browse shelf is the Discover view: one catalog as a paged grid plus the filters the
  catalog itself declares (`extra` options such as genre, sent back as protocol extras).
  Catalog results are de-duplicated by `type:id`.
- **My List:** Save from the detail screen, or the remote's red button (`s` on a desktop
  keyboard) on a focused poster. Like Stremio's library, anything you actually play is
  added automatically. Saved titles open again without their catalog being browsed — the
  snapshot revives its addon reference for meta/streams. The shelf sorts by recently
  added / name / last watched and filters by movie vs series.
- **Watched state:** green button (`w`) on a poster, or Mark watched on the detail screen
  (per episode for series), sets the ✓ Watched indicator; finishing a title (>92 %) marks
  it automatically, and "Remove from Continue Watching" dismisses a resume point without
  un-saving the title.
- **Addons shelf:** Stremio's Addons page, TV edition — installed addons with manifest
  version/resources, install by manifest URL (typed on the same on-screen keyboard),
  remove customs, disable/restore built-ins. The installed set persists in
  `framed.media { customAddons, disabledAddons }`; `addons.local.json` still works for
  secret-bearing URLs and is applied on top.
- **Player menus:** Subtitles, Speed, and Sound each open a dedicated popup. Left/Right
  adjust the focused setting; Back closes the popup and restores its button. Options
  (also green / `c`) selects what happens at the end: play the next episode, ask, return
  to Art, or return to details. The choice persists in `framed.watch.prefs.endBehavior`;
  existing autoplay preferences migrate automatically. Autoplay waits for the video
  to finish; without a next episode, the finished screen remains.
- **External subtitles:** OpenSubtitles v3 is included by default through its Stremio
  addon. Movie and episode subtitles appear in the player's Subtitles menu even
  when the video has no embedded captions. Choose a language once to reuse it on
  later videos; Off remains Off. Lookup uses the movie or episode ID, so some
  releases may need a different file or a timing adjustment. The provider can be
  disabled/restored from Addons. Provider outages or missing matches leave playback
  working without external captions. No separate OpenSubtitles API key is needed
  for this public addon.
- **Subtitle timing:** the Subtitles menu shifts captions up to 10 seconds earlier or
  later in 0.5-second steps, with Reset timing. Corrections apply to HTML5 text cues and
  the AVPlay subtitle overlay, reset for each video, and remain when switching subtitle
  files within that video. Subtitle language, size, and playback speed still persist.
- **Search history:** the last eight searches sit under the keyboard as one-click chips.
- **Continue Watching:** the player writes its position (throttled, and on pause/Back) and
  seeks back to it on entry; the shelf lists in-progress titles newest first, cards and
  episode rows show % watched, and series reopen on the episode holding the resume point.
  Series detail lists `meta.videos` as episodes in season/episode order and loads streams
  per episode id.
- **Search:** the Search button opens an on-screen keyboard (typed by d-pad; a physical
  keyboard works too). `F.media.search()` asks one `search`-capable catalog per addon+type
  via the protocol extra (`/catalog/<type>/<id>/search=<q>.json`) and fetches + title-filters
  the rest locally — including the bundled demo — so search works offline. Back clears it.
- **Degraded path is identical to `library.js`:** every request is XHR with a timeout
  (`MEDIA_TIMEOUT_MS`); unreachable hosts, non-2xx, malformed JSON → one `console.info` line
  and a quiet status line / empty grid. No error UI, never blocks the rest of the app.
- **Grid size is bounded on purpose:** posters paint 24 at a time (More titles, which also
  follows the protocol `skip` extra on catalogs that declare it). The d-pad engine measures
  every focusable on every keypress, so an unbounded wall of posters reads as remote lag;
  `nav.js` likewise only calls `scrollIntoView` when the target is actually off-screen.

### Tizen playback constraints

- Playback is the TV's native HTML5 `<video>` — no external player, no MSE/EME libraries. On
  Tizen 8 that means **H.264/H.265 in MP4/MKV-like containers and HLS where the firmware
  exposes it**; anything else (`infoHash` torrents, `externalUrl` embeds, `ytId`) is refused
  before it reaches the player.
- A codec/container the engine rejects surfaces as a `MediaError` on `<video>` → the screen
  shows a "Can't play this format on this TV" status line instead of crashing.
- Remote `stremio`/`external` addon hosts must be reachable over HTTP(S); `config.xml` already
  carries `<access origin="*"/>`. Manifest/catalog/stream JSON are read with XHR — addon
  servers must send `Access-Control-Allow-Origin: *` (Cinemeta/Torrentio do; the bundled
  `addons/demo` is same-origin anyway).

## The `__tvBridge` seam

The app never touches Tizen APIs directly. Every TV-side effect goes through `window.__tvBridge`:

```ts
interface TvBridge {
  launch(appId: string): Promise<{ ok: boolean }>;   // "stremio" | "youtube" | …
  setBrightness(level: number): void;                // 0..100 panel brightness
  setArtFloor(level: number): void;                  // 0..100 lowest ambient-dimming level in Art mode
  getState(): {
    platform: string;        // "stub" | "tizen" | …
    brightness: number;
    artFloor: number;
    lastLaunch: string | null;
    isStub: boolean;
  };
}
```

`js/bridge.js` installs a **stub** that logs every call and toasts `would launch {appId}`. It steps
aside if `window.__tvBridge` already exists, so the real bridge is wired with one script tag
*above* `js/bridge.js` in `index.html`:

```html
<script src="js/bridge.tizen.js"></script>   <!-- defines window.__tvBridge via tizen.* / webapis.* -->
<script src="js/bridge.js"></script>         <!-- stub: no-op when a bridge is already present -->
```

Implementation notes for the real bridge:

- `launch(appId)` → `tizen.application.launch(tizenAppId)` / `launchAppControl`; needs the
  `application.launch` privilege (declared in `config.xml`). Map short ids to installed Tizen app ids
  (`tizen.application.getAppsInfo()`).
- `setBrightness` / `setArtFloor` have no public Tizen web API; the parent decides the path
  (Samsung `webapis` display extensions, companion service, SmartThings). `settings.js` pushes the
  persisted values into the bridge at boot so the TV re-applies them.
- Values are owned by the app; the bridge is the only side-effect.

## The picture-library seam (`js/library.js`)

`F.library.list()` returns `[{ id, src, title, meta }]`; `F.library.get(id)` looks one up;
`F.library.source()` says which source the list reflects. Nothing else in the app knows where
pictures live. Two sources are built in, with graceful fallback:

### 1. `remote` — a LAN HTTP folder on the desktop (the intended real source)

The TV cannot read SMB, so the desktop runs a small static HTTP server that exposes the art
folder **and** a tiny manifest, `index.json`, regenerated whenever the folder changes (we will
auto-generate it server-side; nothing is hand-maintained):

```json
{ "images": [
  { "file": "harbor.png",   "title": "Harbor at dusk", "orientation": "landscape" },
  { "file": "doorway.jpg",  "title": "Doorway",        "orientation": "portrait" }
] }
```

- `file` is required (relative to the base URL, URL-encoded by the app). `title` and
  `orientation` (`landscape | portrait`) are optional; `title` falls back to the file name.
- Configure the base in **one constant at the top of `js/library.js`**:
  `REMOTE_ART_BASE = 'http://<desktop-ip>:8080/art/'` (`''` = remote disabled, default).
  At boot the app GETs `<base>index.json` (cache-busted, 4 s timeout) and loads every image
  from `<base><file>`.
- The server must send `Access-Control-Allow-Origin: *` on `index.json` (the manifest is read
  with XHR; the images themselves need no CORS). `config.xml` already carries
  `<access origin="*"/>` so the Tizen runtime allows the LAN origin.
- **Pre-size remote images to ≤ 4K (3840×2160, or 2160×3840 portrait)** and keep them as
  PNG/JPEG. The TV's WebKit decodes into limited memory; larger files risk eviction/blank
  frames. 1080p-class images are plenty for the 10-foot view.
- Order in the manifest = sequential order. Ids are `remote:<file>`, so a regenerated manifest
  with the same files keeps the slideshow position stable.

### 2. `bundled` — `assets/art/` (always present)

Six placeholder test cards (the two original demo cards plus four generated ones). This is
what shows at boot, and what stays if `REMOTE_ART_BASE` is empty, the desktop is off, the
fetch fails or times out, or the manifest is malformed. There is deliberately **no error UI**
— one `console.info` line is logged and the bundled set is used. When the manifest arrives
later, `F.library.set(items, 'remote')` swaps the list and fires `framed:library`; the
slideshow re-wraps its position and the Art screen repaints. The Settings About line
shows the active source and count.

### Swapping again later

Replace **this one file** — keep the item shape and the `list / get / set / source`
functions — to point at a USB mount (`tizen.filesystem`), a TV photo API, or anything else.

## Stream from PC (Moonlight + Sunshine)

The **PC** launcher item launches the Moonlight game-streaming client installed on the TV.

- **Tile → launch:** `data-app="moonlight"` resolves through the `EXTERNAL_APP_IDS` map — a
  marked `CONFIG — edit here` block at the top of `js/screens/launcher.js` — to
  `MoonLightS.MoonlightWasm` and calls
  `__tvBridge.launch(...)`. The real bridge maps that to
  `tizen.application.launch('MoonLightS.MoonlightWasm')` (the `application.launch`
  privilege is already declared in `config.xml`).
- **Client app:** [Moonlight Tizen](https://github.com/brightcraft/moonlight-tizen) —
  package id `MoonLightS`, Tizen app id `MoonLightS.MoonlightWasm`.
- **Host app:** [Sunshine](https://app.lizardbyte.dev/Sunshine) on the gaming PC
  (NVIDIA's own GameStream service is discontinued; Sunshine is the host).

### The .wgt artifact

Use `Moonlight-Frame.wgt` — upstream **v1.19.0** repackaged with defaults tuned for the
LS03D setup (1440p host display, 120 Hz PC + 120 Hz panel, Wi-Fi 5 GHz to the TV):

- **2560×1440** stream resolution (native match to the PC's display; the TV upscales to 4K)
- **120 FPS** (both the PC display and the Frame's panel are 120 Hz; `Unlock all FPS`
  defaults to ON so the option is selectable)
- **HEVC** video codec (~40% less bitrate than the stock H.264 default at equal quality;
  the Frame's decoder and Sunshine/NVENC both prefer it)
- **50 Mbps** bitrate (vs stock 10 Mbps — far below Wi-Fi 5 GHz capacity)
- **Game Mode** (Ultra-Low Latency) already defaults to ON on Tizen 8 in upstream code —
  unchanged.

Stock upstream defaults (720p / 60 fps / H.264 / 10 Mbps) are very conservative for this
hardware. To rebuild the tuned package: unpack `Moonlight.wgt`, patch the
`data-value`/`value` attributes in `index.html` and the `defaultResolution` /
`defaultFramerate` / `defaultBitrate` / `defaultVideoCodec` / `defaultUnlockAllFps`
constants in `platform/index.js`, drop the stale `signature1.xml`/`author-signature.xml`,
re-zip. Alternatively download the standard `Moonlight.wgt` from
[brightcraft/moonlight-tizen releases](https://github.com/brightcraft/moonlight-tizen/releases)
and set the same values in the app's Settings — use the standard `Moonlight.wgt`, **not**
`Moonlight-ForceGM.wgt` (that variant only exists for a Tizen 9.0 Game Mode regression).

- **Tizen 8.0 caveat — signature, not code:** 2024-model TVs reject the prebuilt
  signature with `[118, -12] Invalid certificate chain`. The package must be **re-signed
  during install**; this is automatic with Apps2Samsung (below) and asks you to sign in
  with a Samsung account once. The older Docker installer does *not* work on Tizen 8 —
  it ships bundled certificates the TV rejects.

### Install Moonlight on the TV (easiest path — Apps2Samsung)

1. TV: **Apps → App Settings**, type `1 2 3 4 5` on the remote (use the `123` on-screen
   keypad if the remote has no number pad) → **Developer mode = ON** → enter the PC's LAN
   IP in `Host PC IP` → hold the power button ~5 s to fully reboot.
2. PC: install [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung/releases) and
   open it — it finds the TV on the LAN automatically.
3. Settings (gear icon): keep the default **Jelly2Sams** certificate and pick your active
   network connection. Back on the main window choose **Moonlight-Tizen** →
   **Download & Install**. On Tizen 7+/8 it will ask for your Samsung account sign-in to
   generate the certificate — that is the re-signing step doing its job.
4. "Moonlight has been successfully installed!" → the app appears under **Recent Apps**.
   The PC tile can now launch it.

Alternative for advanced users: Tizen Studio (deprecated but working) — create a Samsung
certificate profile (author + distributor cert that includes the TV's DUID) and install
the `.wgt` with `tizen install`. Same signing requirement, more manual steps.

### Sunshine on the gaming PC (Windows, NVIDIA)

1. Download the Windows installer from
   [Sunshine releases](https://github.com/LizardByte/Sunshine/releases)
   (`sunshine-windows-installer.exe`) and run it — accept the defaults, including the
   firewall prompts.
2. Open the Sunshine web UI at `https://localhost:47990` (the browser warns about a
   self-signed certificate — proceed). Create a username/password on first launch.
3. On the TV, open Moonlight → your PC should appear automatically; if not, choose
   **Add PC manually** and type the PC's LAN IP (e.g. `<pc-ip>`).
4. Moonlight shows a **4-digit PIN** on the TV. In the Sunshine web UI go to
   **PIN** (top nav), enter it, submit — the TV is paired. Pick an app/desktop tile in
   Moonlight to start streaming.

### Input & performance notes

- **Gamepad:** connect to the TV (Bluetooth/USB). Moonlight reads it through the Tizen
  Gamepad API and forwards input to the host over its control stream; pairing/menu
  navigation is d-pad driven. Rumble requires the gamepad to be attached to the TV.
- **Remote/d-pad:** navigates the Moonlight UI; a click on the remote's touch surface
  acts as pointer input.
- **Network:** the Frame's built-in Ethernet port is only 100 Mbps and can drop bursts at
  high bitrates. Keep the Moonlight bitrate ≤ ~50 Mbps on wired, or use 5 GHz Wi-Fi for
  4K/60. On the host, wired gigabit is strongly recommended.
- **Game Mode:** Tizen 8 has no Game Mode regression (that is Tizen 9+); the tuned build
  defaults Game Mode (Ultra-Low Latency) to ON — turn it off in Settings if the image
  looks different than expected.
- Not verified on real hardware in this repo — the tuned build only changes settings
  defaults on top of upstream v1.19.0; report functional issues upstream on their
  Discord/issue tracker.

## Home button → framed

A Tizen web app cannot claim the remote's Home key (Samsung routes it to Smart Hub before
any app sees it), so this is a host-side mapping, not an app setting: with the daemon from
the LS03D runbook running, a remote rule
`{ key = "XF86Home", action = "app.launch", app = "cmfrmdlnch" }` grabs the remote,
withholds Home from the TV, and launches framed instead. See
`docs/user/FRAME_LS03D.md` Part 4 for the full config and caveats (it is only live while
the TV is rooted and the daemon is up; `apps list` confirms the `cmfrmdlnch` package id).

## Preview on a desktop

Open `index.html` directly (file://) or serve the folder:

```sh
cd framed && python3 -m http.server 8765   # http://localhost:8765/
```

Arrow keys = d-pad, Enter = OK, Backspace/Escape = Back, `s` toggles the art panel; on the art
screen with the panel closed, ◂ ▸ step pictures and `p` toggles the slideshow. The authoring
canvas is 1920×1080 logical — `1rem = 100vw / 192` (10 px at 1920), so the UI scales with the
window; tiles are 36 rem (360 px logical), all text ≥ 2.8 rem (28 px logical).

## Replacing the theme (for the design session)

1. Replace `css/theme-placeholder.css`. Keep the variable names (or rename them and update
   `app.css`). Add `html[data-theme="<name>"] { … }` blocks for each theme; `settings.js` sets
   `data-theme` from the Theme control — edit its option list there.
2. `--fr-motion` is `0ms` in the scaffold; `app.css` already applies it to focus, selection and
   panel changes, so motion is switched on from the token file.
3. The frames are the four `FRAMES` in `js/screens/art.js` (each a moulding × liner pair); their
   strips are rendered by `tools/gen_frames.py` into `assets/frames/` and placed by `css/frames.css`.
4. Fonts must be bundled under `assets/` and referenced with `@font-face` — no remote fetches.

## Packaging as .wgt

```sh
tizen package -t wgt -s <certificate-profile> -- ./framed
tizen install -n framed.wgt -t <tv-device-id>
```

(or Tizen Studio → Import → Tizen Web Project → Build Signed Package → Run As → Tizen Web
Application, with the TV in Developer Mode and the host IP whitelisted.) `config.xml` declares the
`tv-samsung` profile, `required_version="8.0"`, landscape, and `hwkey-event="enable"` so the
remote's RETURN key (keyCode `10009`) reaches the page instead of closing the app. The widget id is
`com.framed.launcher`; Tizen's 10-char package id is `cmfrmdlnch` (app id `cmfrmdlnch.framed`).

## Runtime notes (Tizen 8 web engine)

- Art mode disables Samsung's idle screensaver through `webapis.appcommon`, renews
  the request once a minute, and reapplies it when the app returns to the foreground.
  Leaving Art, hiding the app, or unloading the page restores the screensaver.
  This also applies with slideshow rotation off. The packaged app requires the
  `appcommon` privilege; reinstall the updated widget to apply manifest changes.
  This does not override TV sleep timers or power-saving shutdown settings.
- Tizen TV web apps render at **1920×1080 logical**; the panel upscales to 4K. Sizes are authored in
  logical px via `rem`; `<meta name="viewport" content="width=1920">` pins this.
- Plain scripts (no ES modules) so `file://` and the wgt load without CORS. ES2015-level syntax —
  no optional chaining, nullish coalescing, `:has()` or `color-mix()`.
- Focus is managed on `[data-focusable]` elements with `tabindex="-1"`; styling uses `:focus` plus an
  `.is-focused` class (no reliance on `:focus-visible`).
- `localStorage` persistence with an in-memory fallback if the runtime denies it.
- Slideshow timers are plain `setTimeout`s and are cleared whenever the Art screen is left; the
  TV may suspend timers when the app is backgrounded — catch-up on entry covers that case.
- `cursor: none` by default; a real pointer movement (`body.has-pointer`) shows it and lets hover move focus.
