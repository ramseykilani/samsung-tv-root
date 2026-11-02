#!/usr/bin/env python
"""Bezel test card: finds the black that disappears into The Frame's own bezel.

    python -I tools/bezel_card.py            # writes artmode/bezel-card.jpg (and -portrait)
    python -I tools/bezel_card.py --low      # bezel-card-low.jpg: 0 to 24, for TVs whose bezel beats 16

Show it in Art Mode (matte None) in the room's usual light and look from a few metres. Every edge of the
screen carries the same run of numbered black bands. The band whose edge against the bezel vanishes is the
level for the slim frames: --black N with either composer. Check again by day and by lamplight; if two
numbers tie, take the lower one (a frame face a touch darker than the bezel still reads as one piece).
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = list(range(16, 68, 4))           # sRGB levels; the composers' default is 40
LOW_LEVELS = list(range(0, 26, 2))
BAND_MM = 25.0
PX_MM = 3840 / 1208.7


def font(size):
    for f in ('C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def card(W, H, levels=LEVELS):
    im = Image.new('RGB', (W, H), (128, 124, 116))
    d = ImageDraw.Draw(im)
    b = int(round(BAND_MM * PX_MM))
    n = len(levels)
    f_num, f_big, f_txt = font(44), font(72), font(40)
    for side in 'tblr':
        start, along = (0, W) if side in 'tb' else (b, H - 2 * b)     # the sides run between the top and bottom
        for i, lv in enumerate(levels):
            a0, a1 = start + round(i * along / n), start + round((i + 1) * along / n)
            lx = min(max((a0 + a1) / 2, min(b + 130, a1 - 30)), max(W - b - 130, a0 + 30))   # clear of the side labels
            if side == 't':
                box, lab = (a0, 0, a1, b), (lx, b + 40)
            elif side == 'b':
                box, lab = (a0, H - b, a1, H), (lx, H - b - 40)
            elif side == 'l':
                box, lab = (0, a0, b, a1), (b + 42, (a0 + a1) / 2)
            else:
                box, lab = (W - b, a0, W, a1), (W - b - 42, (a0 + a1) / 2)
            d.rectangle((box[0], box[1], box[2] - 1, box[3] - 1), fill=(lv, lv, lv))
            d.text(lab, str(lv), fill=(200, 196, 188), font=f_num, anchor='mm')
    cx, cy = W / 2, H / 2
    d.text((cx, cy - 110), 'Black level test', fill=(236, 232, 224), font=f_big, anchor='mm')
    lines = ['Find the number whose band disappears into the TV\'s black frame.',
             'Use that number for the slim frames (--black).']
    for k, t in enumerate(lines):
        d.text((cx, cy + k * 60), t, fill=(222, 218, 210), font=f_txt, anchor='mm')
    return im


if __name__ == '__main__':
    import sys
    low = '--low' in sys.argv
    tag, levels = ('-low', LOW_LEVELS) if low else ('', LEVELS)
    out = os.path.join(ROOT, 'artmode')
    os.makedirs(out, exist_ok=True)
    for name, size in ((f'bezel-card{tag}.jpg', (3840, 2160)), (f'bezel-card{tag}-portrait.jpg', (2160, 3840))):
        card(*size, levels).save(os.path.join(out, name), quality=97, subsampling=0)
        print(os.path.join(out, name))
