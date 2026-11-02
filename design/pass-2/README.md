# framed · design pass 2: player overlay and media surfaces

This pass delivers design artifacts for Devin to merge. It is not a PR. It has the same shape as pass 1: the theme and layout CSS, annotated markup, and component sheets.

| File | What it is | Merge action |
|---|---|---|
| `css/theme.css` | Pass-1 theme plus a marked **PASS 2** block of new role tokens. One pass-1 value changed: `--fr-border-width` 1px → 0.1rem. | Replace |
| `css/app.css` | Pass-1 layout, unchanged above "PASS 2 — shared parts"; the media and playback sections are rebuilt below it. Still no colour, font or motion literals. | Replace |
| `markup/media-play.html` | The new `#screen-media-play` section with the state contract in comments | Replace that section of `index.html` |
| `markup/media-item.html` | Detail actions, episode rows, source rows and the browse card, annotated | Apply in `index.html` + the builders in `media-item.js` / `media.js` |
| `COMPONENT-SHEETS.md` | Per surface: states, focus order, key bindings, copy, and one row per act | Build to it |
| `specimen/index.html` | Every state drawn from the two CSS files on fixture data, at 1920×1080 | Reference; don't ship |
| `shots/`, `shots-4k/` | The specimen boards rendered at 1920 and 3840 wide | Reference |

## 4K
The Frame is a 4K panel. Nothing in the layout assumes 1080: `1rem = 100vw / 192`, so the canvas is 192 × 108 rem whether Tizen lays the page out at 1920 or 3840. The same specimen renders identically at 3840 (`shots-4k/`), only sharper. Three 4K consequences are handled here:
- **Hairlines.** `--fr-border-width` was the theme's only `px` value. It is now `0.1rem`, so a hairline stays one canvas pixel at either layout width.
- **Codecs.** 4K Samsung panels decode HEVC, 10-bit and HDR natively, so the refusal copy never blames x265. The real offender is sound: DTS, DTS-HD and often TrueHD. The source row flags it before you pick, and the refusal names it after.
- **Images.** Ask Cinemeta for the large poster and background variants. A 245-px-wide poster on a 4K panel is upscaled 2× and looks soft. This is a Wire task, not CSS.

## What the player looks like now
- **Hidden** while playing.
- **Any key:** a flat scrim band at the bottom shows the state word, the times, a timeline and a strip of the options with their current values (Pause · Subtitles English · Speed 1× · Sound English 5.1 · Next episode), plus a legend saying what OK and Back do right now. A thin top line shows the title, the episode, and the time the episode ends.
- **Paused:** the picture steps back, the word *Paused* appears, and the chrome stays up.
- **◂ ▸:** move a charge-coloured preview head with the target time; it commits on OK or after 0.8 s.
- **Options:** the Art panel's drawer with choice rows. Subtitles (language, version, size), Speed, Sound (gated with a reason), Next episode.
- **Starting, refusals and the end:** a black veil with one message and one way on.

## Rules this pass follows (and checks it against)
- **Colour means state.** Charge = cursor. Seal = committed (selected shelf, chosen season, the open episode, Watched). Breach = refusals only. Bone = work in progress (the wait tick, the countdown) and the one filled action per surface.
- **One filled action per surface:** Play/Resume on detail; Play now / Try the next source / Back to {title} in the player's card or veil. Everything else is a quiet `.act`.
- **One button kind.** `.act` is the part. `.shelf-btn`, `.media-more`, `.media-key` and `.media-action` are kept as aliases in the same rules until the markup is renamed; rename them when convenient.
- **Every wait has a form:** a stepped tick on a hairline (`.wait`, 8 cuts per 1.6 s). It stops under `prefers-reduced-motion` or `html[data-motion="reduced"]`, where the words carry the state.
- **No drop shadows, no gradients over video, no blur.** Depth is surface plus border weight.
- **Risk list.** No new `clip-path`, `mix-blend-mode` or `:focus-within` dependence. `-webkit-line-clamp` is removed from cards and has a height-cap fallback on the description. Flex `gap` and `order` are used; both are fine on Tizen 8's Chromium.

## Build notes (behaviour the contract still lacks)
1. **media-play.js becomes a state machine.** It writes the `data-*` attributes on `.player` and owns all timers, reading their lengths from the theme (see the sheet).
   - Drop the focusable surface and the `fr-arrive` bottom-edge animation; the timeline is the cursor's home.
   - The surface `.media-player`, its `::after`, `.media-player__status` and `.media-next` are retired. Their replacements are `.player`, the state word / badge / veil, and `.upnext`.
2. **The drawer is built with `F.controls.render`**, not `panelRow` buttons. Subtitles are de-duplicated by language; when a language has several files they become the **Version** row.
3. **Scrub preview.** Keep a `scrubTarget` and seek once on commit. Hold-to-accelerate uses `e.detail.fast` from the nav engine.
4. **Cues lift above the band** while the chrome is shown (`cue.line = -6`), and go back to `'auto'` after.
5. **Detail.** `#md-play` replaces `#md-resume`. The rest:
   - Seasons render one at a time.
   - Sources hang under the open episode.
   - The fold holds the unplayable rows.
   - Normalise `name` / `size` / `flag` per the comments in `markup/media-item.html`.
6. **Browse.** Toggle `.has-cursor` on `#media-grid` on focusin/focusout. Cards get the progress hairline and a sub-line without percentages.
7. **Copy.** Keys and strings are in COMPONENT-SHEETS.md. No "Oops", no exclamation points, never `[TB+]` or error codes on screen.

## Not verified
- Nothing here has run on the TV. The specimen is Chromium on a PC with the same CSS.
- On the device, check:
  - `::cue` styling: Tizen honours `font-family`, `color` and `background` on cues, but test the Garamond fallback.
  - `video.audioTracks` availability, which decides whether Sound is gated.
  - The stepped tick's frame cost during playback; if it costs frames, stop it whenever video is playing.
- Only the Mhach theme exists. Every new value is a role token, so a second theme restyles it without touching `app.css`.
