# Handoff: 16:9 pictures only, thin frames only

**From:** the design session. **To:** the agent that looks after the TV (the `framed` app and Art Mode).
**TV:** Samsung The Frame 2024, 55" (LS03D).

**Where this picks up:** the last package you received was `framed-artmode-tv-handoff-3.zip` (Art Mode
pictures with black level 5). This one contains everything since then:

- the Art screen changes from an update that was never sent to you (no mat, picture grid; below);
- the 16:9 rule and the thin frames (below);
- new Art Mode pictures that **replace all of handoff 3's** (02 to 07 and portrait). The black level 5
  from handoff 3 is built in, so its test card isn't needed again.

The app code here is measured against the app you installed from `framed-full-design-handback.zip`
and `framed-frames-update.zip`. Handoff 3 didn't touch the app.

## The decision (the owner's words, in short)

> If it's meant to look like a real painting on the wall, a picture that isn't the TV's shape will
> look bad whatever we do. So we only hang pictures that are the right shape. If someone wants to
> hang the wrong shape: you're holding it wrong.

That leads to three rules, all agreed with the owner:

1. **Pictures must be 16:9** (ideally 3840 × 2160). Anything else is refused, quietly.
2. **The frame never hides any of the picture.** Before, the frame was the same width all round, so
   the space inside it was wider than 16:9 and even a correctly shaped picture got cropped. The app's
   walnut default cut 6 % off the top and the bottom, which cut a signature and date out of the
   owner's corners. Now the frame hugs the whole 16:9 picture.
3. **Only thin frames.** The wide walnut, gilt, ebony and black ash frames are retired.

## What changed in the app (`framed/`)

On the Art screen (`#/art`) and its settings panel:

- **The mat is gone:** no Matte width, Bottom weight, Matte colour or custom colour rows. The owner
  found that a mat always reads as a picture frame inside a TV, not a TV-sized picture frame.
- **Image fit and Caption are gone**, along with the caption label on screen.
- **Picking pictures is a thumbnail grid** at the top of the panel, three across, replacing the
  "Picture: 1 of 9" slider.
  - Each thumbnail is cropped exactly as it looks on the wall.
  - The picture on the wall has a purple bar under it.
  - Opening the panel puts the cursor on the current picture. Arrows move the green cursor ring,
    and OK hangs the picture.
  - Left/Right with the panel closed still steps through the pictures, and the slideshow is unchanged.
- **Frame is now one choice with four options:** None, Black, Black and gold, Floating. These are the
  same thin frames as the Art Mode pictures. The Frame width and Liner rows are gone.
- **The picture always shows whole.** The frame hugs it, the same width all round. At the top and
  bottom it meets the screen's edge; at the sides a few millimetres of black continue the frame's flat
  black face. That black is level 5, the level the owner matched to the TV's bezel.
- **Pictures that aren't 16:9 are left out.** The library measures each picture: it uses `width` and
  `height` from the manifest if present, otherwise it loads the image. Anything more than 1 % off 16:9
  is skipped.
  - Settings → About then says, for example, "9 pictures, remote · 2 left out (not 16:9)".
  - The console logs which ones were left out.
- **Light from** (Left/Right) stays. Leave it on Left: the drawn light comes mostly from above, a
  little from the left, which suits the owner's room.
- **Saved settings migrate on their own.** An old walnut + gold fillet becomes "Black and gold";
  anything else becomes "Black". Old mat, fit and caption settings are dropped. No reset is needed.
- **The sample picture is now a 16:9 crop of the marsh** (`assets/art/marsh.jpg`). The old 3:2 and
  portrait samples are gone.

### Files

The whole app is in `framed/` (1.2 MB). Compared with the version on the TV now:

| File | Change |
|---|---|
| `index.html` | caption markup removed; the panel holds the picture grid (`#art-pictures`) above the controls |
| `js/screens/art.js` | no mat/fit/caption, picture grid, four frames, hugging geometry, settings migration |
| `js/library.js` | 16:9 check, `rejected()`, manifest `width`/`height` |
| `js/screens/settings.js` | "left out (not 16:9)" in About |
| `css/app.css` | mat and caption styles gone; picture grid styles; stage is the bezel black; brightness preview uses the new sample |
| `css/frames.css` | mat texture and mat bevel gone; gold line liner; generated block has the thin frames only |
| `css/theme.css` | new `--fr-bezel-black: rgb(5, 5, 5)` |
| `assets/frames/` | new strips: `bezel-*`, `bezelfloat-*`, `goldline-*`, `float-*` |
| `assets/art/marsh.jpg` | new 16:9 sample |
| `README.md` | Art section updated |

**Delete from the app** (no longer used): `assets/frames/walnut-*`, `gilt-*`, `black-*`, `ebony-*`,
`fillet-*`, `linen-*`, `slip-*` (4 files each), and `assets/art/landscape.jpg`, `assets/art/portrait.jpg`.

`app-changes.diff` shows every code change against the version on the TV now (from the two
zips named above).

**How to install:** if you haven't changed the app's files since that handover, replace the whole
`framed/` folder with this one and reinstall as you normally do. If you have, apply `app-changes.diff`
instead and copy the new assets.

### The desktop picture server (if you run one)

If you generate `index.json` for the remote library, please add each picture's pixel size. Without it,
the TV has to load every picture just to measure it:

```json
{ "images": [ { "file": "name.jpg", "title": "Optional title", "width": 3840, "height": 2160 } ] }
```

It would also help to warn at that end when a picture in the folder isn't 16:9, so the owner finds
out when adding it rather than when it's missing on the TV.

## What changed for Art Mode

The picture tools follow the same rules: they refuse a picture that isn't 16:9, and the frame hugs
the picture. Because the frames are thinner than before (12 mm instead of 22 mm), the painting is bigger.

Upload these, untouched, with **matte None**, and replace the earlier ones:

| File | What it is |
|---|---|
| `upload/02-slim-drawn.jpg` | thin black frame, "Drawn" style (the default) |
| `upload/03-slim-rendered.jpg` | the same, "Rendered" style |
| `upload/04-slim-gold-drawn.jpg` | black with a thin gold line at the painting |
| `upload/05-slim-gold-rendered.jpg` | the same, Rendered |
| `upload/06-slim-float-drawn.jpg` | thinnest: the painting floats inside a dark gap |
| `upload/07-slim-float-rendered.jpg` | the same, Rendered |
| `upload/portrait/…` | only if the TV is turned to portrait |

The black level is settled at 5, so the test card isn't needed again.

To make a picture from the owner's own 16:9 art (Drawn style; Python 3 with numpy and Pillow), run this
from this folder:

```
python -I tools/compose_artmode.py THEIR_PICTURE.jpg                      # thin black (default)
python -I tools/compose_artmode.py THEIR_PICTURE.jpg --preset slim-gold
python -I tools/compose_artmode.py THEIR_PICTURE.jpg --preset slim-float
```

Output goes to `artmode/out/`. A picture that isn't 16:9 is refused with a message saying so. The
Rendered style needs Blender and a GPU, so leave that to the design session.

## Checks on the TV

1. **App, Art screen:** a 16:9 picture shows completely, including its corners. Compare against the
   file on a computer: a signature or date in a corner must be fully visible.
2. **App:** open the panel (corner button or `s`). It opens on the picture grid with the cursor on the
   current picture. Arrow to another and press OK: it fades onto the wall and the purple bar moves.
   There are no Matte, Image fit, Caption, Frame width or Liner rows.
3. **App:** try all four frames from the panel. The black at the sides should blend into the TV's
   own black edge, with no visible step.
4. **App:** put a picture that isn't 16:9 in the library. It should be missing from the grid, and
   Settings → About should count it as left out.
5. **Art Mode:** the frame is the same width all round, and the whole painting is visible.
