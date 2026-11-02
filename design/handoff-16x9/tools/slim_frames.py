"""Slim frames: a narrow black moulding that continues the TV's own bezel. The only frames framed makes.

The Frame's 14 mm black bezel is the outside of the frame; the picture draws only the inside: a flat black
face matched to the bezel (so the two read as one piece), then a lit edge stepping down to the painting,
which takes the frame's shadow.

The rule: pictures are the screen's shape (16:9; 9:16 on a TV turned to portrait), and the frame never
crops them. The frame is the same width all round and hugs the whole picture, so its opening is 16:9 too;
the few millimetres left over at the sides are the bezel's black, which the flat face continues
(top/bottom 12 mm, sides about 21 mm on the plain frame). A picture of another shape is refused.

Shared by compose_artmode.py (Drawn), compose_artmode_blender.py (Rendered) and gen_frames.py (the app).
"""
import numpy as np
import gen_frames as G

F32 = np.float32
BEZEL_MM = 14.1            # The Frame 2024's bezel (sides 14.14, top/bottom 14.38 mm)
SHAPE_TOLERANCE = 0.01     # a picture may differ from 16:9 by this fraction (trimmed evenly, ~10 px)
BEZEL_BLACK = 5            # sRGB level of the black face, set per TV with the bezel test card (owner: 5)


class Bezel(G.Design):
    """Satin black, flat face flush with the bezel, an eased edge, a small cove tier, a crisp sight edge."""
    kind = 'moulding'
    lip_mm = 6.0
    h_outer = 14.0          # the bezel continues outside at the face's height: no outer edge is drawn
    note = 'satin black, flush with the TV bezel'
    bezel_match = True

    def __init__(self, name, width_mm):
        self.name, self.width_mm = name, float(width_mm)

    @property
    def face_mm(self):                                          # the flat face, matched to the bezel
        return self.width_mm - 9.0

    def profile(self):
        w = self.width_mm
        fw = w - 9.0                                            # the flat face
        return [
            (fw, G.seg_round(0, 14.0, fw, 14.0, 0.15), 1),
            (fw + 2.0, G.seg_quarter_down(fw, fw + 2.0, 14.0, 12.0), 1),   # eased edge: a fine line of light
            (fw + 5.5, G.seg_cove(fw + 2.0, 12.0, fw + 5.5, 10.5, 0.6), 1),
            (w - 2.0, G.seg_line(fw + 5.5, 10.5, w - 2.0, 10.0), 1),
            (w, G.seg_quarter_down(w - 2.0, w, 10.0, 6.0), 1),           # sight edge, 6 mm above the art
        ]

    def material(self, ctx, H, reg):
        rng, S, A, px = ctx['rng'], ctx['S'], ctx['A'], ctx['px_mm']
        med = G.spectral_noise(rng, S, A, 2 * px, 120 * px)
        fine = G.spectral_noise(rng, S, A, 0.3 * px, 5 * px)
        alb = np.array([0.020, 0.0195, 0.019], F32) * (1 + 0.05 * med + 0.03 * fine)[..., None]
        return G.dielectric(alb, 0.48 + 0.02 * med, 0.045)


class BezelFloat(Bezel):
    """The bezel as a floater frame: only the moulding's narrow inner lip shows before the gap."""
    lip_mm = 0.0
    h_outer = 24.0

    @property
    def face_mm(self):
        return self.width_mm - 1.5

    def profile(self):
        w = self.width_mm
        return [
            (w - 1.5, G.seg_round(0, 24.0, w - 1.5, 24.0, 0.1), 1),
            (w, G.seg_quarter_down(w - 1.5, w, 24.0, 22.0), 1),
        ]


class GoldLine(G.Design):
    """A burnished gold bead, the thinnest sight fillet a framer would use."""
    name = 'goldline'
    kind = 'liner'
    width_mm = 5.0
    lip_mm = 3.0
    h_outer = 4.5
    note = 'burnished gilt bead'

    def profile(self):
        return [
            (4.0, G.seg_bead(0, 4.0, 3.0, 1.8), 1),
            (5.0, G.seg_quarter_down(4.0, 5.0, 3.0, 1.0), 2),
        ]

    def material(self, ctx, H, reg):
        return G.gilt_material(ctx, H, reg, burnish_regions=(1,), matte_regions=(2,), sand_regions=(), wear_amt=0.5)


MOULDINGS = [Bezel('bezel', 12.0), BezelFloat('bezelfloat', 6.0)]
LINERS = [GoldLine()]

PRESETS = {
    'slim': dict(moulding='bezel', liner=None, fit='whole', surface='canvas',
                 about='12 mm satin black continuing the bezel: the default frame'),
    'slim-gold': dict(moulding='bezel', liner='goldline', fit='whole', surface='canvas',
                      about='the same black with a 5 mm gold bead at the sight edge'),
    'slim-float': dict(moulding='bezelfloat', liner='float', fit='whole', surface='canvas',
                       about='the bezel as a floater frame: a 6 mm lip, a 9 mm shadow gap, the canvas floating'),
}


def require_screen_shape(size, portrait=False):
    """Refuse a picture that isn't the screen's shape: no frame can show it whole without a mat or bars."""
    w, h = size
    want = 9 / 16 if portrait else 16 / 9
    if abs((w / h) / want - 1) > SHAPE_TOLERANCE:
        raise SystemExit('Refused: the picture is %d x %d (%.3f:1). framed only hangs pictures the shape of the '
                         'screen, %s (ideally %s), so nothing is cropped or padded. Crop it to that shape first.'
                         % (w, h, w / h, '9:16' if portrait else '16:9', '2160 x 3840' if portrait else '3840 x 2160'))


def srgb8_to_lin(v):
    x = v / 255.0
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def match_strip(img, face_px, target):
    """match_bezel for one rendered strip (uint8 sRGB, rows from the outer edge inwards, before orienting):
    the app's frame strips get the same black as the Art Mode pictures."""
    x = img.astype(np.float32) / 255
    lin = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    lum = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    med = max(float(np.median(lum[:face_px])), 1e-6)
    k = srgb8_to_lin(target) / med
    sheen = 1 - (1 - k) * np.minimum(med / np.maximum(lum, 1e-9), 1)
    sheen[:face_px] = k
    lin = lin * sheen[..., None]
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)
    return np.clip(np.round(out * 255), 0, 255).astype(np.uint8)


def match_bezel(lin, ring_px, face_px, target):
    """Scale the moulding ring (outer ring_px of the image, linear rgb, in place) so the median of its flat face
    (outer face_px) lands on `target` (sRGB 0-255), the level that disappears into the TV's own bezel. Each
    rail is matched on its own (owned up to the mitres), since the bezel beside it is one even black. The face is
    scaled (the paint is darker). Past the face, light above the face level is shifted by the same amount instead,
    since a satin black's sheen is surface reflection and stays put when the paint gets blacker."""
    h, w = lin.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    dist = np.stack(np.broadcast_arrays(yy, h - 1 - yy, xx, w - 1 - xx))
    own, d = dist.argmin(0), dist.min(0)
    lum = lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722
    ks = []
    for k in range(4):
        side = own == k
        med = max(float(np.median(lum[side & (d < face_px)])), 1e-6)
        ks.append(srgb8_to_lin(target) / med)
        ring = side & (d < ring_px)
        sheen = 1 - (1 - ks[-1]) * np.minimum(med / np.maximum(lum[ring], 1e-9), 1)
        lin[ring] *= np.where(d[ring] < face_px, ks[-1], sheen)[:, None]
    return ks
