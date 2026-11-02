# framed vs Samsung Stremio — under-the-hood parity audit

Scope: `framed/js/media.js`, `js/screens/media*.js`, `js/nav.js`, `src/samsung_tv_root/remote.py`, `docs/user/{FRAME_LS03D,REMOTE_POLICY}.md`. Research + planning only; no playback-path changes in this PR.

Each gap: what Stremio does → what framed does → why it matters → fix sketch + effort.

---

## P0 — Playback engine: `<video>` vs `webapis.avplay`

**Stremio** uses Samsung's native `webapis.avplay` pipeline (the same player its own Tizen app ships). AVPlay is Samsung's privileged media interface: hardware decode paths, its own buffering parameters, dedicated track/subtitle APIs.

**framed** plays through a plain HTML `<video>` element (`media-play.js#mp-video`).

Why playback feels worse, point by point:

- **Codec/decode.** Tizen's `<video>` demuxes AAC/MP3/PCM and Dolby (AC3/E-AC3) but returns silent picture for **DTS / DTS-HD / TrueHD / Atmos** — the dominant audio codecs in debrid-served remuxes. framed already detects this (title-codec `DTS_RE` flag on rows, `webkitAudioDecodedByteCount` runtime check in `media-play.js`), but detection only *explains* the silence. AVPlay routes audio through the platform decoder, which handles a wider set — though DTS is still licensed-absent on many Samsung panels, so **AVPlay is not guaranteed to fix DTS silence**; it fixes codec coverage for HEVC variants and gives real track-level info instead of guesswork.
- **Buffering.** `<video>` on Tizen has shallow, opaque buffers — long pauses before play, stalls on high-bitrate remux files over Wi-Fi. AVPlay exposes `setBufferingParam` (time/bytes) and real buffering events, so we could pre-buffer aggressively and show honest "buffered 40 s" instead of the current guessing veil.
- **Seek latency.** Every `video.currentTime` commit re-hunts the HTTP range and re-buffers; our scrub UI (10/30/60/120 s steps + 800 ms settle) hides it partly, but on big files seeks are still slow. AVPlay `seekTo` is pipelined better.
- **Subtitles.** `<video>` only renders `textTracks` — so framed must fetch `.srt` itself and convert to VTT (`srtToVtt` in `media-play.js`), which works but: no charset handling (OpenSubtitles often serves Latin-1 → mojibake), and **no embedded subtitle streams** (in-file subs inside the mp4/mkv are invisible to textTracks). AVPlay's subtitle API (`setSubtitleStream`, `setSelectTrack(TRACK_TYPE_TEXT)`) can render embedded text tracks for supported containers and accepts SRT directly.
- **Audio track selection.** `video.audioTracks` is `undefined` on Tizen web, so the Sound row is always gated ("This TV can't switch sound tracks in this file"). AVPlay has `getAudioStreamInfo`/`setSelectTrack(TRACK_TYPE_AUDIO)` — real multi-audio switching.
- **Adaptive streaming.** Torrentio/debrid links are plain HTTP files, so HLS/DASH matters little today — but AVPlay supports them if an addon ever serves HLS (some do, e.g. certain YouTube-external streams). `<video>` cannot play HLS on Tizen at all.

**Sibling-session note:** a parallel session is already investigating the AVPlay switch. Feasibility verdict from this audit:

- Requires adding `$WEBAPIS/webapis/webapis.js` script include and the AVPlay privilege in `config.xml`; **completely unverifiable in desktop Chrome** — gate behind `window.webapis && webapis.avplay` feature detection with `<video>` as fallback, or testing becomes impossible on the local harness (`/tmp/framed_server.py`).
- Integration risk: `media-play.js` owns ~15 `<video>` event listeners and the whole `data-state` machine maps to them (`play/playing/pause/waiting/ended/error/timeupdate`). AVPlay's event model is different (callback registration on `listener.onbufferingstart/onsubtitlechange/onstreamcompleted`, `setDisplayRect`, manual `play/pause/stop`). The refactor should keep the **same `data-state` contract** and swap only the transport — wrap in a `player.js` seam (same seam pattern as `library.js`/`media.js`) rather than touching the state machine.
- Do **not** make AVPlay unconditional: the local Chrome harness and any non-Samsung environment must keep `<video>`.

Effort: medium-large (transport seam + transport-specific polish). Highest-value fix in the whole audit.

---

## P1 — Stream list loses quality signals Stremio surfaces

**Stremio** shows the addon's source name, quality, size, **seeder counts**, and audio/video codec marks parsed from titles, and orders playable results sensibly.

**framed** (`normalizeStream`, `media.js:263-302`) parses only `q` (resolution), `size`, first-line filename, debrid/DTS/HDR flags. What we lose:

- **Seeders** — Torrentio titles carry `👤 n` / `⚙️ n` seeder counts; we parse `💾` size but drop the peer count entirely. Dead or slow sources rank identical to hot ones.
- **Audio codec preference** — we detect DTS for a warning flag but never *sort by* it; a user on a no-DTS-decode panel should see AAC/Dolby streams first.
- **No quality cap/preference** — a weak-Wi-Fi set gets 18 GB 4K remuxes offered equal-first; nothing lets the viewer prefer 1080p.
- **Ranking is addon order** — `streams()` returns per-addon buckets flattened in addon order (`flatten()`); the only intelligence is `bestReady` promoting a `[TB+]` ready stream for the Play button. The visible list itself is unsorted.

Fix sketch: extend `normalizeStream` to parse seeder count and audio codec token (`aac|eac3|ac3|dd5|dts|truehd` regex over `title`); add a small `rank()` — playable > ready > !dts > quality(pref) > seeders — applied in `renderSources` (keep addon order as tiebreak). Add a `prefs.qualityCap` in the series/options drawer ("Prefer: Any/1080p/720p"). ~half day including drawer plumbing.

---

## P1 — Continue-watching / episode flow: mostly wired, two real gaps

**Stremio** syncs per-item progress to the account, shows a Continue Watching row, marks episodes watched, and its series resume means *"the next episode you haven't watched"*.

**framed** already has the local equivalents: `recordProgress` (5 s throttle + on `visibilitychange`/back), `progressFor` (title-level "latest entry" lookup), `continueItems` shelf on Board + a dedicated shelf, per-episode progress bars and `Watched` marks, `resumeEp` season jump, Play/Resume labels with "S1 · E2 · from 12:34", and dismiss ("Forget my place"). This is genuinely close to parity.

Gaps:

1. **Series resume ignores `watched`.** `resumeEp()` only looks at the in-progress map; `setWatched` clears progress but nothing derives "next unwatched episode". If you mark S1E3 watched manually and have no progress, Play opens E1, not E4. Fix: `resumeEp` falls back to the first unwatched episode. Small.
2. **`ensureSaved` is dead code.** Stremio adds anything you actually play to the library; `ensureSaved()` exists (`media.js:446`) but **nothing calls it** — auto-add-on-play is declared in a comment and never wired. Fix: one call in `playStream` (`media-item.js:166`). Trivial — the only "trivial fix" in this audit; bundled separately or left as a one-liner the implementer adds.
3. **No cross-device sync.** Stremio syncs progress to its account; ours is localStorage per TV. Out of protocol scope — note only.
4. **Finished-series cleanup edge:** `recordProgress` treats >92% as finished even when the viewer scrub-skipped to credits; the entry silently deletes instead of offering "Mark watched" — matches Stremio's behavior closely enough; leave.

Effort: half a day for (1)+(2).

---

## P1 — Subtitles: protocol wired, but no default subtitle addon and no embedded tracks

**Stremio** ships OpenSubtitles integration; external subs are one click per language.

**framed** already implements the `subtitles` addon resource end-to-end: `F.media.subtitles()` queries every addon declaring it, the player groups by language, fetches `.srt` and converts to VTT via blob (`srtToVtt`), applies per-lang+file selection, size pref, and cue-lift under the chrome band. Solid plumbing.

Gaps:

- **Nothing declares `subtitles` by default.** Cinemeta/Torrentio don't offer it; the feature only activates if the viewer installs a subtitle addon (e.g. OpenSubtitles v3) by URL on the Addons shelf. Docs should name a recommended addon; nothing in-app prompts for one when a stream has no subs. Fix: documentation + maybe a discoverable hint in the subtitle drawer ("No subtitles arrived — install a subtitle addon"). Small.
- **Charset bug**: `srtToVtt` assumes UTF-8; OpenSubtitles `.srt` files are frequently ISO-8859-1/Windows-1250 → garbage accents. Fix: `xhr.responseType='arraybuffer'` + `TextDecoder` with charset sniffing. Small, real.
- **No embedded subtitle tracks** — `<video>` textTracks can't reach subs inside the container; an "in-file" language row never appears. This is P0-dependent: AVPlay's text-track API addresses it.
- **No subtitle offset/sync control** — Stremio lets you nudge ±ms; add a `prefs.subOffset` adjust row that re-times cue `startTime/endTime`. Small.

Effort: small each; charset fix is the cheap win.

---

## P2 — Remote keys: playback keys covered; Home already documented & feasible; a few unused keys left

**Stremio's Tizen app** gets every media key (the platform delivers them to registered apps).

**framed** (`nav.js` + `media-play.js onKey`) handles: arrows/OK/Back(10009), MediaPlayPause 10252, MediaPlay 415, MediaPause 19, MediaStop 413, MediaRewind 412, MediaFastForward 417, Green 404 (options drawer), Red 403/Green 404 shortcuts on posters. `tizen.tvinputdevice.registerKey` is already called for the six media keys + Red/Green.

Gaps:

- **Yellow/Blue not registered** — Stremio maps color keys to subtitle/audio quick toggles. Add `ColorF2Yellow` (subtitles drawer straight to language) and `ColorF3Blue` (audio track) to the register list + handlers. Trivial.
- **0–9 seek** — Stremio jumps to n·10% position; could map digits to `scrubTarget = dur()*n/10`. Trivial.
- **Info key (457)** — could open a "stats" overlay (codec hint, buffered s, source name). Nice-to-have.
- **HOME interception — feasible and already the documented design.** `REMOTE_POLICY.md` + `FRAME_LS03D.md` confirm the agent's *filter* mode exclusively grabs the evdev device, forwards unmatched keys through a virtual input device, and withholds configured keys — `XF86Home` (evdev code 63) is visible to the agent and already has a documented `app.launch → cmfrmdlnch` rule. Caveats worth restating in any UX work: the rule withholds *every* Home press while the daemon is connected (long-press behaviors die); if the desktop/daemon is down Home falls back to stock Smart Hub; no foreground-app-conditional rules exist (can't "press Home in framed → back to TV").

Effort: trivial for Yellow/Blue/digits; Home already works as designed.

---

## P2 — Search: implemented, two gaps vs Stremio

**framed** has the full loop already: on-screen keyboard (the remote has no text entry), catalog `search` extra where declared + local filtering fallback (so the bundled demo addon searches too), cross-addon dedupe, recent-searches chips, Back-clears.

Gaps:

- **No search for people/cast** — Cinemeta's catalog extras only cover title search; Stremio searches cast too. Minor; would need a cast-indexed local pass or a different addon.
- **Keyboard lacks case/diacritics** — all-lowercase ASCII; most catalogs don't care, some return better hits with accents. Minor.
- **`extra` passthrough is greedy on failure** — on a catalog that declares `search` but returns an empty `metas`, we refetch the whole catalog and filter locally (fine, one extra request).

Effort: small; lowest priority — the feature exists and works.

---

## P3 — Other parity gaps found

- **Trailer** — Cinemeta meta carries `trailers`/`links` (ytId); not rendered. Stremio plays YouTube trailers; ours could at minimum offer a "Trailer" act that marks it external-only (can't play ytId anyway — `kind:'ytId'` reason exists). Low value.
- **Metadata richness** — cast/director/genre/imdbRating already painted (`paintMeta`); `meta.logo`/`backdrops`/`behaviourHints.defaultVideoId` unused. The last one is interesting: Stremio skips the meta step with `defaultVideoId` — could jump straight to episode N. Small.
- **`bingeGroup` captured, unused** — streams sharing a `behaviorHints.bingeGroup` are files of the same release; could group or prefer them. Small.
- **Error recovery on network blips** — stall veil + "keep waiting"/"back to sources" exists, but there's **no retry**: on transient drop `<video>` errors once → `refused`. A bounded auto-retry (recreate `video.src` at saved position, max ~2) would fix most blip deaths. Small-medium.
- **No preloading of next-episode streams** — `playNext` fetches `F.media.streams` at end-time; could prefetch the stream list when upnext is offered. Small, big feel win.
- **`visibilitychange` → save only** — no suspend/resume of playback; Tizen may kill the app on background anyway (`background-support="disable"` in config.xml). Note only.

---

## Priority summary

| Pri | Gap | Effort |
|---|---|---|
| P0 | AVPlay transport behind feature-detect seam (codecs, buffering, seek, embedded subs, multi-audio) | M-L — sibling session owns |
| P1 | Stream ranking: seeders/audio-codec/quality cap | S |
| P1 | Series resume → next-unwatched; wire `ensureSaved` | S |
| P1 | Subtitle charset fix; recommend OpenSubtitles addon in docs/UI hint | S |
| P2 | Yellow/Blue/digit keys; Home already handled by daemon rules | T-S |
| P2 | Search polish (people/case) | S |
| P3 | Trailer act, defaultVideoId shortcut, bingeGroup, auto-retry, next-ep prefetch | S-M |

The one honestly-trivial fix: call `F.media.ensureSaved` from `playStream` — everything else deserves its own change.
