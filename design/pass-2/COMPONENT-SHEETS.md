# framed · pass 2 · component sheets

Each surface has the same five parts: its states, focus order, key bindings, the copy for each state, and one row per act. Every state listed here is drawn in `specimen/index.html`, and screenshots are in `shots/`.

Tags used in the act tables:
- **await**: a visible wait the moment the state starts.
- **fault**: retry or dismiss, on the same request.
- **gated**: stays on screen and gives its reason in words.
- **exit**: back, close or dismiss.
- **quiet**: draws nothing.

---

## 1 · Player overlay (`#/media-play`)

### Why it changes
Field report: *"the pause menu is confusing and there's not a lot of options."* The causes in the current code:
- Paused looks almost like playing: only a status chip changes.
- Every option sits behind a green button nobody can see.
- The options are one long list of rows labelled `current` / `OK cycles`.
- ▴ ▾ seek by a minute, so the arrows can't reach anything.
- Every ◂ ▸ press seeks at once, so the stream re-buffers on each step.

### States (one machine: `media-play.js`; written to `.player` as attributes)

| `data-state` | When | Chrome | What shows |
|---|---|---|---|
| `starting` | enter, `src` set, until `playing` | veil | title, episode, source; stepped wait; "Connecting to the stream"; Back cancels |
| `starting` + `data-slow` | still starting after `--fr-slow-start` (8 s) | veil | + cause line and **Try a Ready source** / **Try another source** |
| `playing` | `playing` event | hidden after `--fr-chrome-linger` (5 s) without a key | nothing; subtitles only |
| `paused` | `pause` (not at end) | pinned | picture dims by `--fr-pause-dim`; state word **Paused**; toggle reads **Play** |
| `buffering` | `waiting` after first frame | unchanged | chrome shown: state word "Buffering" + tick. Chrome hidden: one corner badge |
| `refused` | `error`; or buffering past `--fr-stall` (20 s) | veil | breach bar; cause; **Try the next source** / **Try again from 31:04** |
| `ended` | `ended` with no next episode (or the up-next card was dismissed) | veil over a scrim | **Back to {title}** (fill) · **Watch from the start**; series: **Play S2 · E6** (fill) · **Back to {title}** |

These sub-states run in parallel with `data-state`:
- `data-scrub="active"`: ◂ ▸ have moved a preview head. Nothing is sought yet.
- `data-panel="open"`: the Options drawer is open.
- `data-upnext`:
  - `offered`: within 60 s of the end and there is a next episode with a playable source.
  - `counting`: autoplay is on and the last `--fr-upnext-count` (10) s are running.
  - `missing`: there is a next episode, but none of its sources can play.

  While `data-upnext` is not `none`, the chrome is pinned.

The machine owns every timer: linger, scrub settle, slow start, stall, and the countdown. It reads them from the theme with `parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fr-chrome-linger'))`. The markup holds no timers.

### Focus order
1. **Timeline**: the default cursor on entry and after every veil.
2. **Strip**: Pause/Play · Subtitles · Speed · Sound · Next episode (series only).
3. **Up next acts**: Play now / Choose a source · Keep watching. These take the cursor when the card appears.
4. **Veil acts**: when a veil is up, nav scope moves to `.player__veil`.
5. **Drawer rows**: when the drawer is open, nav scope moves to `.panel`. The cursor starts on the row named by the strip button's `data-row`, or on Language when the drawer was opened with the green key.

The cursor never lands on `<body>`. Chrome hides by opacity, so the focused element stays focusable.

### Key bindings

| Key | Chrome hidden (playing) | Cursor on timeline | Cursor on strip | Scrubbing | Drawer open | Veil |
|---|---|---|---|---|---|---|
| OK | pause | play/pause | act (toggle · open drawer at row · next episode) | **commit** | — (◂ ▸ change) | act |
| ◂ ▸ | show chrome **and** take one scrub step | scrub step (held: accelerates) | walk strip | step again (resets settle) | change value | walk acts |
| ▴ | show chrome | — | to timeline | — | row up | — |
| ▾ | show chrome | to strip | — | — | row down | — |
| Back | leave → detail (place kept) | hide chrome · **paused: leave** | hide chrome | **cancel** (head returns) | close drawer | starting: cancel → detail · refused/ended: → detail |
| Play/Pause key | toggle | toggle | toggle | commit + toggle | toggle | — |
| ⏪ ⏩ | scrub ∓30 s | scrub ∓30 s | scrub ∓30 s | step ∓30 s | — | — |
| Green / C | open drawer | open drawer | open drawer | cancel scrub, open drawer | close drawer | — |
| Stop | leave | leave | leave | leave | leave | leave |

**Scrub steps.** A tap moves 10 s. While the key is held (`e.detail.fast`), the step grows each second: 10 s → 30 s → 60 s → 2 min. The scrub commits on OK, or `--fr-scrub-settle` (0.8 s) after the last step. Committing sets `currentTime` once and clears `data-scrub`.

The old ▴ = +60 s and ▾ = −60 s are dropped. Holding a key covers big jumps, and the arrows are needed for moving between controls.

**Legend** (`#mp-legend`): only what OK and Back do right now.

| Where the cursor is | Legend |
|---|---|
| timeline, playing | OK Pause · Back Hide |
| timeline, paused | OK Play · Back Leave · your place is kept |
| strip | OK {Change subtitles \| Change speed \| Change sound \| Play next episode} · Back Hide |
| scrubbing | OK Jump here · Back Cancel |
| up next | Back Keep watching |
| starting | Back Cancel |
| refused / ended | Back Back to {title} |

### Drawer: Options
The drawer reuses the Art panel's drawer and `F.controls` choice rows, so the player doesn't grow a second list widget. ◂ ▸ changes a value in one gesture, and the change applies immediately.

| Group | Row | Options | Note line (`.control__note`) | States |
|---|---|---|---|---|
| Subtitles | **Language** | Off + one per language. Embedded and addon tracks are merged and de-duplicated by language name. Names are shown in their own language (English, Español, …). | "From OpenSubtitles" · "In the video file" | **await**: gated, options = Off only, note "Finding subtitles" + inline wait. **fault**: `data-fault`, note "These {lang} subtitles didn't arrive. OK tries again." **gated**: none found, note "No subtitles found for this title." |
| Subtitles | **Version** | 1 · 2 · 3 … | "{n} files for {lang}. Try another if lines run early or late." | Only drawn when the chosen language has more than one file. |
| Subtitles | **Size** | Small 80% · Medium 100% · Large 130% · Larger 160% | — | quiet |
| Playback | **Speed** | 0.75× · 1× · 1.25× · 1.5× · 2× | — | quiet. The 0.5× option is dropped. |
| Playback | **Sound** | One per `video.audioTracks` | when gated: "This stream has one sound track." or "This TV can't switch sound tracks in this file." (when `audioTracks` is undefined) | **gated** unless there are 2+ tracks and switching works |
| Series | **Next episode** | Play automatically · Ask me | — | Series only. Maps to `prefs.autoplayNext`. |

**Sound note.** Samsung TVs since 2018 don't decode DTS or DTS-HD, and many don't decode TrueHD. The picture plays with no sound, or the player refuses the file. That's why the design covers it in three places:
1. The source row flags it in advance ("sound may not play (DTS)").
2. The refusal names it.
3. The Sound row says when switching tracks isn't possible.

**Subtitles over the band.** `::cue` can't be positioned from CSS. While `data-chrome="shown"`, set `cue.line = -6` on the showing track's active cues, and restore `'auto'` when the chrome hides. Otherwise subtitle lines sit under the band.

### Copy (keys → text)

| Key | Text |
|---|---|
| play.starting.kicker / msg | Starting / Connecting to the stream |
| play.starting.sub | {S · E  episode title  ·  }{quality} from {addon}{ via TorBox} |
| play.slow.msg | Still connecting |
| play.slow.cause.uncached | TorBox is fetching this one before it can stream. That can take a few minutes. A source marked Ready starts at once. |
| play.slow.cause.other | The source is slow to answer. Another source may start faster. |
| play.slow.act | Try a Ready source (when one exists) · Try another source |
| play.refused.kicker / title | Can't play / This TV can't play this file |
| play.refused.cause.decode (MediaError 3) | The TV's player stopped before the first frame.{ This file's sound is DTS, which Samsung TVs no longer decode.} Another source of the same episode, with AAC or Dolby sound, usually plays. |
| play.refused.cause.format (MediaError 4) | The TV doesn't support this file's format{ (MKV with DTS / TrueHD sound)}. Another source usually plays. |
| play.refused.cause.network (MediaError 2) | The connection to the source dropped while it was starting. |
| play.refused.act | Try the next source + value "{quality} · {sound}" of that source · Choose a source |
| play.refused.none | (Try the next source, gated) why: "No other source plays on this TV" |
| play.stall.kicker / title / cause | Stopped / The stream stopped sending / Nothing has arrived for 20 seconds. The source may be busy, or the network dropped. |
| play.stall.act | Try again + value "from {position}" · Try the next source |
| play.paused | Paused |
| play.buffering | Buffering |
| play.upnext.kicker | Up next |
| play.upnext.count | Starts in {n} seconds |
| play.upnext.missing | None of this episode's sources play on this TV. |
| play.ended.kicker | Finished |
| play.ended.sub | Marked as watched · (series finale) That's the last episode for now |
| play.clock | {hh:mm} · ends **{hh:mm}** |

No exclamation points. Never print "Oops", "error", addon IDs, MediaError codes or `[TB+]`.

### Acts

| Act | Machine | Event | State | Parent | Tag | What the tag owes | Render | Copy key | Confirm weight | Left off the screen |
|---|---|---|---|---|---|---|---|---|---|---|
| Start a source | player | enter | starting | — | await | Veil the same frame the route changes, before `src` is set | `.player__veil` + `.wait` | play.starting.* | none | % progress (unknowable) |
| Wait it out | player | slow timer | starting+slow | starting | await | Cause + one way on | `.veil__slow` | play.slow.* | none | retry counts |
| Cancel start | player | Back | → detail | starting | exit | Back is named in the legend | legend | — | none | "Are you sure" |
| Pause / play | player | OK, Play/Pause key | paused ⇄ playing | — | quiet | Paused shows a word, a dimmed picture and pinned chrome | `.player__state`, `.player__dim` | play.paused | none | centre glyph |
| Reveal chrome | player | any arrow | chrome shown | playing | exit | Back or the linger timer hides it | `data-chrome` | — | none | hover reveal as the only route |
| Scrub | player | ◂ ▸ on timeline | scrub active | playing/paused | await | Preview head, tip with target and delta | `.timeline__preview/__tip/__span` | — | none | thumbnails (no trickplay source) |
| Commit scrub | player | OK / settle | buffering → playing | scrub | await | Buffering state if data isn't there | state word / badge | play.buffering | none | — |
| Cancel scrub | player | Back | scrub idle | scrub | exit | Head returns to the real position | — | — | none | — |
| Open options | player | OK on a strip value · Green | drawer open | any | exit | Back / Green closes; cursor on the matching row | `.panel` | — | none | "green button or C closes" in a title |
| Change subtitles | player | ◂ ▸ Language | subs.loading → shown | drawer | await · fault · gated | Row-level wait, retry on the row, reason when none | `.control__note` | see drawer | none | per-file addon names in the option label |
| Change size / speed | player | ◂ ▸ | — | drawer | quiet | Value moves; cue/rate change at once | choice | — | none | — |
| Change sound | player | ◂ ▸ | — | drawer | gated | Reason when it can't be done | `.control__note` | see drawer | none | — |
| Next episode | player | OK on strip / up next | starting (next) | — | await | Same starting veil | veil | play.starting.* | none | — |
| Up next countdown | player | T−10 s | upnext counting | playing | await | Words + draining hairline; Back keeps watching | `.upnext__count` | play.upnext.count | none | ambient motion before T−10 |
| No playable next | player | streams(next) empty | upnext missing | playing | gated | Says why + Choose a source | `.upnext__missing` | play.upnext.missing | none | — |
| Can't play | player | `error` | refused | — | fault | Cause in words; the retry moves to the next source, busy while working | veil, breach bar | play.refused.* | none | MediaError codes |
| Stream stopped | player | stall timer | refused | buffering | fault | Retry from the same position, once per press | veil | play.stall.* | none | — |
| Leave | player | Back (hidden/paused), Stop | → detail | — | quiet | Position saved; detail shows Resume | — | — | none | "Saving…" (the frame owns save-status) |

---

## 2 · Detail (`#/media-item`)

### States

| Part | State | What shows |
|---|---|---|
| Play (`#md-play`) | loading | gated fill · why "Finding sources…" |
| | ready | fill · "Play" / "Resume" + value (episode · time) |
| | none playable | gated · why "Nothing here plays on this TV yet" |
| | fault | gated · why "No sources yet" |
| Episodes | loaded | season choice row + that season's rows; the open row has its sources beneath |
| Sources | loading | `.wait` + note "Asking your {n} addons" |
| | some play | note "{n} play on this TV. Ready ones start at once." + playable rows + fold |
| | none play | `.empty` (no debrid) + note "What the addons found" + struck rows, unfolded |
| | none at all | `.empty` "No sources for this episode" · Ask again |
| | unreachable | `.empty--fault` "Couldn't reach your addons" · Ask again |

### Focus order
Play → Save → Mark watched → Forget my place → Season row → episode rows (the open one, then its sources) → the fold → struck rows.

On entry the cursor goes to **Play** once Play is ready. That replaces "land on the streams": Play already picks the best source, and the list is one ▾ away. Picking an episode moves the cursor to that episode's first playable source.

### Keys
| Key | On Play / quiet acts | Season row | Episode row | Source row | Fold |
|---|---|---|---|---|---|
| OK | act | — | open/close its sources, cursor to first playable | play it · struck: info toast with the reason | show/hide struck rows |
| ◂ ▸ | walk | change season (one gesture) | — | — | — |
| ▴ ▾ | rows | rows | rows | rows | rows |
| Back | → browse | → browse | → browse | → browse | → browse |

### Acts

| Act | Machine | Event | State | Parent | Tag | What the tag owes | Render | Copy key | Confirm weight | Left off the screen |
|---|---|---|---|---|---|---|---|---|---|---|
| Play best source | detail | OK on Play | → player starting | sources ready | gated (until ready) | Reason beside Play in words | `.act--fill` + `.act__why` | detail.play.* | none | a source picker first |
| Load sources | detail | enter / episode open | sources loading | — | await | Wait in the list, gated Play | `.wait` + `.note` | detail.sources.asking | none | spinner overlay |
| Retry addons | detail | OK Ask again | sources loading | fault | fault | Same request; `data-busy` while running, repeats ignored | `.empty--fault` | detail.sources.unreachable | none | — |
| Pick a source | detail | OK on `.src` | → player starting | sources | quiet | — | `.src` | — | none | — |
| Learn why a row is struck | detail | OK on struck `.src` | toast (info) | sources | gated | The reason is already on the row; OK repeats it as a sentence | `.src__flag` | detail.src.why.* | none | error tone |
| Fix "nothing plays" | detail | OK Set one up in Addons | → browse/addons | none play | — | Cause first, then the way on | `.empty` | detail.sources.nodebrid | none | jargon past one "debrid" |
| Change season | detail | ◂ ▸ | episodes | — | quiet | List swaps; cursor stays on the row | choice | — | none | — |
| Mark watched | detail | OK | — | — | quiet | Label flips; seal mark on the row | `.ep__mark` | — | none | confirm dialog (cheap, reversible) |
| Forget my place | detail | OK | — | — | quiet | Names what is lost; toast after | `.act` | detail.forget | none | — (cheap; Continue Watching re-fills on the next play) |

Copy:
- **detail.sources.nodebrid**:
  - Head: "Nothing here plays on this TV yet"
  - Cause: "All {n} sources are torrents. A TV can only play a torrent through a debrid service such as TorBox: it fetches the torrent and hands the TV an ordinary video link."
  - Action: "Set one up in Addons"
- **Fold row**: "{n} more can't play on this TV", with the why "plain torrents, from addons without TorBox". When a debrid service is configured, the why reads instead "torrents your debrid service didn't take".

---

## 3 · Browse (`#/media`)

Most of this screen is polish; the structure is unchanged.
- **One poster measure.** Board-row cards are now exactly the grid's column width (`(100% − 5 gaps) / 6`), so a poster is the same size on every shelf.
- **Resume hairline.** A `.progress` along the poster's foot replaces "37% watched". The sub-line carries the time left in words: "S2 · E5 · 21 min left" in Continue, nothing about percent elsewhere.
- **One line each.** Title and sub use `nowrap` + ellipsis. `-webkit-line-clamp` is gone from cards because it is on the risk list.
- **Recede.** `.has-cursor` is toggled by media.js on grid focusin/focusout. `:focus-within` is kept as a separate rule, so an engine without it drops only that line.
- **Row overflow.** Rows pad by the focus gap and ring width, so the held-off charge rule on the first and last poster is never clipped by `overflow-x`.
- **Shelf button.** A selected shelf keeps its seal underline while it has the cursor: both bars draw.
- **Status line.** The keys hint ("OK opens · red saves · green marks watched") leaves the status line, which now only states the count. Check 8: no hints between the person and the posters. Red and green stay as shortcuts. They don't need to be learned, because Save and Mark watched are visible buttons on every detail screen.

Focus and keys are unchanged.
