#!/usr/bin/env python
"""
framed: compose a painting and its frame into one finished 3840 x 2160 picture for The Frame's Art Mode.

    python -I tools/compose_artmode.py ART.jpg                       # default: slim (continues the TV bezel)
    python -I tools/compose_artmode.py ART.jpg --preset slim-gold
    python -I tools/compose_artmode.py ART.jpg --preset slim-float --light right
    python -I tools/compose_artmode.py ART.jpg --all-presets
    python -I tools/compose_artmode.py PORTRAIT_ART.jpg --portrait   # TV turned to portrait: 9:16 art

The picture must be the screen's shape: 16:9 (ideally 3840 x 2160), or 9:16 with --portrait. Anything
else is refused, because no frame can show it whole without cropping it or padding it. The frame hugs
the whole picture (see tools/slim_frames.py), so nothing of it is ever hidden.

Writes artmode/out/<art>-<preset>[-right].jpg (3840 x 2160, sRGB, 4:4:4 JPEG). Upload it to Art Mode
with matte "None". Art Mode shows it pixel for pixel and its light sensor sets the brightness, so the
picture is encoded as a lit object (reflectance under one room light), not as a bright screen image.

Everything is to physical scale for the chosen screen size: a 12 mm moulding is 12 mm on the wall. The
mouldings and liners are the same cross-sections and materials as tools/gen_frames.py, rendered here at
the panel's native density (no scaling anywhere), with the light from the same room. The painting gets
the same light: the frame's sight edges cast soft shadows onto it, the inner corners collect a little
occlusion, the canvas or paper surface has a faint relief lit from the key, and the whole wall is lit
slightly more strongly towards the light.

Strips are cached in .work/strips (a first full run renders for a few minutes; later runs are seconds).
"""
import os
import sys
import math
import time
import argparse
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_frames as G          # noqa: E402
import slim_frames as SF        # noqa: E402

F32 = np.float32
ROOT = G.ROOT
CACHE = os.path.join(ROOT, '.work', 'strips')
OUT = os.path.join(ROOT, 'artmode', 'out')
JPEG_Q = 95

# The Frame 2024 (LS03D): viewable diagonal in inches by nominal size. All are 3840 x 2160 except the 32".
VIEWABLE_IN = {43: 42.5, 50: 49.5, 55: 54.6, 65: 64.5, 75: 74.5, 85: 84.5}
MM_PER_IN_16x9 = 25.4 * 16 / math.hypot(16, 9)     # viewable width (mm) per inch of diagonal

# ------------------------------------------------------------------ light (same room as gen_frames)
_KEY0 = G.KEY_DIR.copy()
_ENV0 = G.env_radiance
_LIGHT = [None]


def set_light(side):
    if _LIGHT[0] == side:
        return
    sx = -1.0 if side == 'right' else 1.0
    G.KEY_DIR = np.array([_KEY0[0] * sx, _KEY0[1], _KEY0[2]])
    G.KEY_DIRS = G.key_samples()
    if sx < 0:
        mirror = np.array([-1, 1, 1], F32)
        G.env_radiance = lambda d, blur: _ENV0(d * mirror, blur)
    else:
        G.env_radiance = _ENV0
    G.AMB_RAD = G.env_radiance(G.AMB_DIRS, np.full(len(G.AMB_DIRS), 0.3, F32))
    _LIGHT[0] = side


def flat_irradiance():
    """Key and ambient light (rgb) falling on a flat surface facing out of the wall."""
    n = np.array([0, 0, 1], F32)
    key = np.mean([max(float(n @ L), 0) for L in G.KEY_DIRS]) * G.KEY_RGB
    amb = (np.maximum(G.AMB_DIRS @ n, 0)[:, None] * G.AMB_RAD).sum(0) * 4 / len(G.AMB_DIRS)
    return key.astype(F32), amb.astype(F32)


# ------------------------------------------------------------------ extra liners for Art Mode
class Mat(G.Design):
    """Museum mat board: a flat paper face and a 45-degree bevel cut into its white core."""
    kind = 'liner'
    PLY = 2.4                                   # 8-ply board, mm

    def __init__(self, width_mm, colour, over_mm):
        self.name = 'mat'
        self.width_mm = float(width_mm)
        self.lip_mm = self.PLY
        self.h_outer = self.PLY + over_mm       # the moulding's sight edge, standing over the board
        self.h_inner = 0.0
        self.colour = np.asarray(colour, F32)
        self.note = 'mat board, bevel-cut white core'

    def profile(self):
        w, p = self.width_mm, self.PLY
        return [(w - p, G.seg_line(0, p, w - p, p), 1),
                (w, G.seg_line(w - p, p, w, 0.0), 2)]

    def ornament(self, s, a, reg, ctx):
        px = ctx['px_mm']
        tooth = G.spectral_noise(ctx['rng'], ctx['S'], ctx['A'], 0.25 * px, 0.25 * px)
        return np.where(reg == 1, 0.004 * tooth, 0).astype(F32)

    def material(self, ctx, H, reg):
        rng, S, A, px = ctx['rng'], ctx['S'], ctx['A'], ctx['px_mm']
        fib = G.spectral_noise(rng, S, A, 0.15 * px, 1.2 * px)
        blot = G.spectral_noise(rng, S, A, 6 * px, 8 * px)
        face = self.colour * (1 + 0.012 * fib + 0.008 * blot)[..., None]
        core = np.array([0.83, 0.82, 0.78], F32) * (1 + 0.01 * fib)[..., None]
        alb = np.where((reg == 2)[..., None], core, face)
        return G.dielectric(alb, np.full((S, A), 0.85, F32), 0.03)


class Walnut(G.Walnut):
    """At native 4K the app's walnut figure reads as contour rings. Mouldings are milled from straight,
    flat-sawn boards, so here the figure is long and quiet: streaks along the length, the growth bands
    following the carved profile, and only a faint drift of cathedral figure."""

    def material(self, ctx, H, reg):
        rng, S, A, px = ctx['rng'], ctx['S'], ctx['A'], ctx['px_mm']
        s = ctx['s2']
        streak = G.spectral_noise(rng, S, A, 0.3 * px, 45 * px)
        med = G.spectral_noise(rng, S, A, 3.0 * px, 200 * px)
        low = G.spectral_noise(rng, S, A, 18 * px, 420 * px)
        warp = G.periodic_warp(rng, A, 260 * px, 1.6)[None, :]
        ring = (s * 0.30 + H * 1.15 + warp + 0.65 * med) / 2.6
        ringv = np.abs(((ring % 1.0) - 0.5) * 2)
        late = G.smoothstep(0.6, 0.95, ringv)
        t = 0.50 + 0.13 * med + 0.11 * streak + 0.14 * low - 0.15 * late
        t = np.clip(t, 0, 1)
        dark = np.array([0.030, 0.0155, 0.0085], F32)
        light = np.array([0.150, 0.080, 0.042], F32)
        alb = dark + (light - dark) * t[..., None]
        pores = G.wood_pores(rng, S, A, 0.0035, 5 * G.SS, 0.45)
        alb = alb * pores[..., None]
        rough = 0.30 + 0.03 * streak + 0.18 * (1 - pores)
        return G.dielectric(alb, rough, 0.045)


MOULDINGS = {d.name: d for d in G.DESIGNS if d.kind == 'moulding'}
MOULDINGS['walnut'] = Walnut()
LINERS = {d.name: d for d in G.DESIGNS if d.kind == 'liner'}
MOULDINGS.update({d.name: d for d in SF.MOULDINGS})
LINERS.update({d.name: d for d in SF.LINERS})

# Warm museum mat colours (linear albedo). "warm" is the default: a white that still reads as paper.
MAT_COLOURS = {
    'warm': (0.80, 0.765, 0.69),
    'white': (0.84, 0.83, 0.80),
    'cream': (0.76, 0.69, 0.56),
    'stone': (0.42, 0.40, 0.36),
}

# The frames framed makes: the slim family (tools/slim_frames.py) and none. The wide wooden and gilt
# mouldings and the mats are retired: their equal-width rails can't leave a 16:9 opening on a 16:9 screen
# without cropping the picture. surface: the relief lit on the art itself.
PRESETS = {
    'none': dict(moulding=None, liner=None, fit='whole', surface='canvas',
                 about='no frame: the TV bezel is the frame'),
}
PRESETS.update(SF.PRESETS)

LINEN_COLOUR = (0.56, 0.47, 0.335)   # the linen of gen_frames' Linen liner

MAT_MIN_MM = 65.0          # narrowest mat margin
MAT_BOTTOM_EXTRA_MM = 10.0  # bottom-weighted, as framers do
LINEN_MIN_MM = 40.0


# ------------------------------------------------------------------ strip rendering (cached)
def render_strip(design, side, length_px, px_mm, seed, light):
    """One side of a ring at the panel's density, lit for that side. Returns uint8 (oriented like gen_frames)."""
    key = '%s-%.2f-%s-%d-%.4f-%s-%d' % (design.name, design.width_mm, side, length_px, px_mm, light, seed)
    if isinstance(design, Mat):
        key += '-%.3f-%.3f-%.3f-%.2f' % (tuple(design.colour) + (design.h_outer,))
    path = os.path.join(CACHE, key + '.png')
    if os.path.exists(path):
        return np.asarray(Image.open(path).convert('RGB'))
    set_light(light)
    t0 = time.time()
    rng = np.random.default_rng(seed)
    px = px_mm * G.SS
    S = int(round(design.width_mm * px))
    S += S % G.SS
    A = length_px * G.SS
    s = (np.arange(S, dtype=F32) + 0.5) / px
    a = np.arange(A, dtype=F32)
    h1, reg1 = G.eval_profile(design.profile(), s)
    s2 = np.repeat(s[:, None], A, 1)
    a2 = np.repeat(a[None, :], S, 0)
    reg = np.repeat(reg1[:, None], A, 1)
    H = np.repeat(h1[:, None], A, 1).astype(F32)
    ctx = dict(rng=rng, S=S, A=A, px_mm=px, s2=s2, side=side)
    orn = design.ornament(s2, a2, reg, ctx)
    if orn is not None:
        H = (H + orn).astype(F32)
    mat = design.material(ctx, H, reg)
    col = G.shade(H, mat, side, px, design.h_outer, design.h_inner)
    img = G.orient(G.finish(col, rng), side)
    os.makedirs(CACHE, exist_ok=True)
    Image.fromarray(img).save(path, optimize=False, compress_level=1)
    print('  rendered %-7s %s %5.1f mm x %4d px  %.0fs' % (design.name, side, design.width_mm, length_px, time.time() - t0))
    return img


# ------------------------------------------------------------------ colour helpers
def srgb_to_lin(u8):
    x = u8.astype(F32) / 255
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(F32)


def tonemap(col):
    """The same soft shoulder gen_frames applies to the frames."""
    knee = 0.72
    over = np.maximum(col - knee, 0)
    return np.where(col > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), col).astype(F32)


def encode(lin, rng):
    lin = np.clip(lin, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    tri = rng.random(srgb.shape, dtype=F32) - rng.random(srgb.shape, dtype=F32)
    return np.clip(np.round(srgb * 255 + tri), 0, 255).astype(np.uint8)


def phi(z):
    return 1.0 / (1.0 + np.exp(-1.702 * z))


# ------------------------------------------------------------------ rings
def paste_ring(out, rect, strips, widths, hairline=True):
    """Mitre four strips into the band just inside rect. strips/widths keyed t, b, l, r (px)."""
    x0, y0, x1, y1 = rect
    Wr, Hr = x1 - x0, y1 - y0
    wt, wb, wl, wr = (widths[k] for k in 'tblr')
    ys, xs = np.mgrid[0:Hr, 0:Wr].astype(F32)
    dt, db, dl, dr = ys + 0.5, Hr - ys - 0.5, xs + 0.5, Wr - xs - 0.5
    n = np.stack([dt / wt, db / wb, dl / wl, dr / wr])
    own = n.argmin(0)
    band = n.min(0) < 1
    yi, xi = ys.astype(np.int32), xs.astype(np.int32)
    region = out[y0:y1, x0:x1]
    for k, (side, strip) in enumerate(zip('tblr', (strips[s] for s in 'tblr'))):
        m = band & (own == k)
        yy, xx = yi[m], xi[m]
        if side == 'b':
            yy = yy - (Hr - wb)
        elif side == 'r':
            xx = xx - (Wr - wr)
        region[m] = srgb_to_lin(strip[yy, xx])
    if not hairline:
        return
    # the mitre joints read as a fine dark line
    shade = np.ones((Hr, Wr), F32)
    for (da, wa), (dbb, wbb) in (((dl, wl), (dt, wt)), ((dr, wr), (dt, wt)), ((dl, wl), (db, wb)), ((dr, wr), (db, wb))):
        dist = np.abs(da * wbb - dbb * wa) / math.hypot(wa, wbb)
        near = (da < wa + 2) & (dbb < wbb + 2) & band
        shade = np.where(near, shade * (1 - 0.32 * np.exp(-(dist / 0.6) ** 2)), shade)
    region *= shade[..., None]


def ring_widths(design, px_mm):
    S = int(round(design.width_mm * px_mm * G.SS))
    S += S % G.SS
    return S // G.SS


# ------------------------------------------------------------------ the art itself
def fit_art(img, box_w, box_h, fit, focus):
    """cover: crop to the box around the focus point. contain: whole picture, scaled to fit."""
    iw, ih = img.size
    if fit == 'cover':
        sc = max(box_w / iw, box_h / ih)
        cw, ch = min(box_w / sc, iw), min(box_h / sc, ih)     # min(): float rounding can overshoot by a hair
        fx, fy = focus
        cx = max(min(fx * iw - cw / 2, iw - cw), 0)
        cy = max(min(fy * ih - ch / 2, ih - ch), 0)
        return img.resize((box_w, box_h), Image.LANCZOS, box=(cx, cy, cx + cw, cy + ch)), sc
    sc = min(box_w / iw, box_h / ih)
    return img.resize((max(1, round(iw * sc)), max(1, round(ih * sc))), Image.LANCZOS), sc


def surface_relief(h, w, px_mm, kind, rng, light_x):
    """Shading factor (~1) of the canvas weave or paper tooth under the key light, box-filtered from 2x."""
    if kind == 'none':
        return np.ones((h, w), F32)
    ss = 2
    H2, W2 = h * ss, w * ss
    px = px_mm * ss
    if kind == 'canvas':
        pitch = 1.0                                    # mm per thread, a medium linen canvas
        x = (np.arange(W2, dtype=F32) / px)[None, :]
        y = (np.arange(H2, dtype=F32) / px)[:, None]
        wx = np.cos(math.pi * x / pitch) ** 2
        wy = np.cos(math.pi * y / pitch) ** 2
        chk = np.sign(np.sin(math.pi * x / pitch) * np.sin(math.pi * y / pitch))
        hgt = 0.25 * (wy * (1 + chk) + wx * (1 - chk))
        hgt = hgt + 0.35 * G.spectral_noise(rng, H2, W2, 0.3 * px, 3.0 * px)    # slubs along the weft
        amp = 0.006
    else:                                              # paper: fibrous tooth and a little cockle
        hgt = G.spectral_noise(rng, H2, W2, 0.18 * px, 0.28 * px)
        hgt = hgt + 1.5 * G.spectral_noise(rng, H2, W2, 30 * px, 45 * px)
        amp = 0.0035
    hgt = (hgt * amp).astype(F32)
    gx = np.gradient(hgt, axis=1) * px                 # dh/dx (mm/mm), x to the right
    gy = -np.gradient(hgt, axis=0) * px                # dh/dy with y up the wall
    L = np.array([0.36 * light_x, 0.80, 0.48], F32)
    L /= np.linalg.norm(L)
    ndl = (-gx * L[0] - gy * L[1] + L[2]) / np.sqrt(1 + gx * gx + gy * gy)
    rel = (ndl / L[2]).astype(F32)
    return rel.reshape(h, ss, w, ss).mean((1, 3))


def art_light(h, w, px_mm, occluders, key, amb, relief, light_x):
    """Irradiance on the art relative to an unshadowed flat surface (rgb), from the sight-edge shadows."""
    ys = ((np.arange(h, dtype=F32) + 0.5) / px_mm)[:, None]
    xs = ((np.arange(w, dtype=F32) + 0.5) / px_mm)[None, :]
    d = {'t': ys, 'b': h / px_mm - ys, 'l': xs, 'r': w / px_mm - xs}
    L = np.array([-0.36 * light_x, 0.80, 0.48])           # towards the light (x negative = from the left)
    L /= np.linalg.norm(L)
    tan = {'t': L[1] / L[2], 'b': -L[1] / L[2], 'l': -L[0] / L[2], 'r': L[0] / L[2]}
    sig = G.KEY_SIGMA
    vis = np.ones((h, w), F32)
    ao = np.ones((h, w), F32)
    for side in 'tblr':
        for off, hh in occluders[side]:
            dd = d[side] + off
            if tan[side] > 0:
                l0 = hh * tan[side]
                sp = max(hh * sig * (1 + tan[side] ** 2), 0.4)
                vis = vis * phi((dd - l0) / sp)
            ao = ao * (1 - 0.22 * np.exp(-dd / (0.9 * hh + 0.5)))
    E = (key[None, None, :] * (vis * relief)[..., None] + amb[None, None, :] * ao[..., None]) / (key + amb)
    return E.astype(F32)


def wall_falloff(H, W, light_x):
    """The light is above and to one side: the wall is a little brighter towards it."""
    v = np.linspace(1, -1, H, dtype=F32)[:, None]
    u = np.linspace(-1, 1, W, dtype=F32)[None, :]
    return (1 + 0.05 * v - 0.025 * u * light_x).astype(F32)


# ------------------------------------------------------------------ compose
def compose(art_path, preset_name, light='left', size=55, portrait=False, focus=(0.5, 0.5),
            fit=None, surface=None, mat_colour='warm', moulding=None, seed=7, black=SF.BEZEL_BLACK):
    p = dict(PRESETS[preset_name])
    if moulding:
        p['moulding'] = moulding
    fit = fit or p['fit']
    surface = surface or p['surface']
    W, H = (2160, 3840) if portrait else (3840, 2160)
    width_mm = VIEWABLE_IN[size] * MM_PER_IN_16x9
    px_mm = 3840 / width_mm
    light_x = -1.0 if light == 'right' else 1.0          # +1: light from the left
    set_light(light)
    key, amb = flat_irradiance()
    out = np.zeros((H, W, 3), F32)
    rng = np.random.default_rng(seed)

    rect = (0, 0, W, H)
    occ = {s: [] for s in 'tblr'}                         # (distance from art edge mm, height above art mm)
    m = MOULDINGS[p['moulding']] if p['moulding'] else None
    src = Image.open(art_path).convert('RGB')
    SF.require_screen_shape(src.size, portrait)
    if fit == 'whole' and m is not None:
        # The frame is made for the painting, as a framer would: it hugs the whole picture at the largest
        # size the screen allows, and the screen beyond it is the bezel's black. Nothing is cropped.
        t = ring_widths(m, px_mm) + (ring_widths(LINERS[p['liner']], px_mm) if p['liner'] not in (None, 'mat') else 0)
        a = src.width / src.height
        fw_, fh = round(a * (H - 2 * t)) + 2 * t, H
        if fw_ > W:
            fw_, fh = W, round((W - 2 * t) / a) + 2 * t
        x0, y0 = (W - fw_) // 2, (H - fh) // 2
        rect = (x0, y0, x0 + fw_, y0 + fh)
        out[:] = SF.srgb8_to_lin(black)
    if m is not None:
        wm = ring_widths(m, px_mm)
        strips = {s: render_strip(m, s, (rect[2] - rect[0]) if s in 'tb' else (rect[3] - rect[1]),
                                  px_mm, seed * 100 + i, light) for i, s in enumerate('tblr')}
        paste_ring(out, rect, strips, dict(t=wm, b=wm, l=wm, r=wm))
        if getattr(m, 'bezel_match', False):
            SF.match_bezel(out[rect[1]:rect[3], rect[0]:rect[2]], wm, int(m.face_mm * px_mm), black)
        rect = (rect[0] + wm, rect[1] + wm, rect[2] - wm, rect[3] - wm)

    liner = p['liner'] if m is not None else None
    iw, ih = rect[2] - rect[0], rect[3] - rect[1]

    # A board is one sheet with a window cut in it: a paper mat, or (gilt, contained) a linen-covered
    # board with a gold fillet in the window, the framer's way of setting a small painting in a big frame.
    board = 'mat' if liner == 'mat' else ('linen' if liner == 'linen' and fit == 'contain' else None)
    fil = LINERS['fillet']
    fil_px = ring_widths(fil, px_mm) if board == 'linen' else 0

    if board and fit == 'contain':
        # size the window so the whole picture shows, with margins a framer would choose
        mn = (MAT_MIN_MM if board == 'mat' else LINEN_MIN_MM) * px_mm
        extra = (MAT_BOTTOM_EXTRA_MM if board == 'mat' else 0) * px_mm
        sc = min((iw - 2 * mn - 2 * fil_px) / src.width, (ih - 2 * mn - extra - 2 * fil_px) / src.height)
        aw, ah = int(round(src.width * sc)) + 2 * fil_px, int(round(src.height * sc)) + 2 * fil_px
        side_px = (iw - aw) // 2
        top_px = (ih - ah - int(round(extra))) // 2
        widths = dict(t=top_px, b=ih - ah - top_px, l=side_px, r=iw - aw - side_px)
    elif liner == 'mat':
        mn = MAT_MIN_MM * px_mm
        widths = dict(t=int(mn), b=int(mn + MAT_BOTTOM_EXTRA_MM * px_mm), l=int(mn), r=int(mn))
    elif liner:
        wl = ring_widths(LINERS[liner], px_mm)
        widths = dict(t=wl, b=wl, l=wl, r=wl)
    else:
        widths = None

    if board:
        # one continuous face (no seams), with the moulding's shadow falling across it
        x0, y0, x1, y1 = rect
        kind = 'paper' if board == 'mat' else 'canvas'
        face_rel = art_light(ih, iw, px_mm, {s: [(0.0, m.lip_mm)] for s in 'tblr'}, key, amb,
                             surface_relief(ih, iw, px_mm, kind, rng, light_x), light_x)
        fib = G.spectral_noise(rng, ih, iw, 0.4 * px_mm, 1.2 * px_mm)
        blot = G.spectral_noise(rng, ih, iw, 6 * px_mm, 8 * px_mm)
        colour = MAT_COLOURS[mat_colour] if board == 'mat' else LINEN_COLOUR
        grain = (0.010 * fib + 0.008 * blot) if board == 'mat' else (0.035 * fib + 0.02 * blot)
        alb = np.asarray(colour, F32)[None, None, :] * (1 + grain)[..., None]
        out[y0:y1, x0:x1] = tonemap(alb * (key + amb)[None, None, :] * face_rel)
        rect = (x0 + widths['l'], y0 + widths['t'], x1 - widths['r'], y1 - widths['b'])
        if board == 'mat':
            # only the 45-degree bevel is rendered per side, cut into the board around the window
            bev = int(round(Mat.PLY * px_mm))
            narrow = Mat(Mat.PLY + 4.0, MAT_COLOURS[mat_colour], 0.0)
            bs = {s: render_strip(narrow, s, iw if s in 'tb' else ih, px_mm, seed * 100 + 10 + i, light)
                  for i, s in enumerate('tblr')}
            bs = dict(t=bs['t'][-bev:], b=bs['b'][:bev], l=bs['l'][:, -bev:], r=bs['r'][:, :bev])
            paste_ring(out, (rect[0] - bev, rect[1] - bev, rect[2] + bev, rect[3] + bev), bs,
                       dict(t=bev, b=bev, l=bev, r=bev), hairline=False)
            for s in 'tblr':
                occ[s].append((0.0, Mat.PLY))
                occ[s].append((widths[s] / px_mm, Mat.PLY + m.lip_mm))
        else:
            # the gold fillet lines the window; the linen board sits at the fillet's outer height
            ww, wh = rect[2] - rect[0], rect[3] - rect[1]
            fs = {s: render_strip(fil, s, ww if s in 'tb' else wh, px_mm, seed * 100 + 10 + i, light)
                  for i, s in enumerate('tblr')}
            paste_ring(out, rect, fs, dict(t=fil_px, b=fil_px, l=fil_px, r=fil_px))
            rect = (rect[0] + fil_px, rect[1] + fil_px, rect[2] - fil_px, rect[3] - fil_px)
            for s in 'tblr':
                occ[s].append((0.0, fil.lip_mm))
                occ[s].append(((fil_px + widths[s]) / px_mm, fil.lip_mm + m.lip_mm))
    elif liner:
        designs = {}
        for s in 'tblr':
            mm = widths[s] / px_mm
            if liner == 'mat':
                d = Mat(mm, MAT_COLOURS[mat_colour], m.lip_mm)
            else:
                d = LINERS[liner]
            designs[s] = d
        lw = {s: ring_widths(designs[s], px_mm) for s in 'tblr'}
        strips = {s: render_strip(designs[s], s, iw if s in 'tb' else ih, px_mm, seed * 100 + 10 + i, light)
                  for i, s in enumerate('tblr')}
        paste_ring(out, rect, strips, lw)
        rect = (rect[0] + lw['l'], rect[1] + lw['t'], rect[2] - lw['r'], rect[3] - lw['b'])
        for s in 'tblr':
            d = designs[s]
            if liner == 'float':
                occ[s].append((lw[s] / px_mm, max(d.h_outer - d.h_inner, 0.1)))
            else:
                occ[s].append((0.0, d.lip_mm))
                occ[s].append((lw[s] / px_mm, d.lip_mm + m.lip_mm))
    elif m is not None:
        for s in 'tblr':
            occ[s].append((0.0, m.lip_mm))

    aw, ah = rect[2] - rect[0], rect[3] - rect[1]
    art, sc = fit_art(src, aw, ah, 'cover', focus)          # the art fills its opening (contain set the opening)
    alb = srgb_to_lin(np.asarray(art)) * 0.88 + 0.004       # paint/paper reflectance, varnish veil in the darks
    relief = surface_relief(ah, aw, px_mm, surface, rng, light_x)
    E = art_light(ah, aw, px_mm, occ, key, amb, relief, light_x)
    out[rect[1]:rect[3], rect[0]:rect[2]] = tonemap(alb * E)

    out *= wall_falloff(H, W, light_x)[..., None]
    img = encode(out, rng)
    info = dict(preset=preset_name, art_px=(aw, ah), art_scale=sc, px_mm=px_mm, src_px=src.size)
    return img, info


def main(argv):
    ap = argparse.ArgumentParser(description='Compose a framed picture for Art Mode.')
    ap.add_argument('art')
    ap.add_argument('--preset', default='slim', choices=sorted(PRESETS))
    ap.add_argument('--all-presets', action='store_true')
    ap.add_argument('--light', default='left', choices=('left', 'right'))
    ap.add_argument('--size', type=int, default=55, choices=sorted(VIEWABLE_IN))
    ap.add_argument('--portrait', action='store_true', help='TV rotated to portrait (2160 x 3840)')
    ap.add_argument('--surface', choices=('canvas', 'paper', 'none'))
    ap.add_argument('--black', type=int, default=SF.BEZEL_BLACK,
                    help='slim frames: sRGB level of the black face (from the bezel test card)')
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args(argv[1:])
    os.makedirs(a.out, exist_ok=True)
    stem = os.path.splitext(os.path.basename(a.art))[0]
    for name in (sorted(PRESETS) if a.all_presets else [a.preset]):
        t0 = time.time()
        img, info = compose(a.art, name, a.light, a.size, a.portrait, surface=a.surface, black=a.black)
        tag = name + ('-right' if a.light == 'right' else '') + ('-portrait' if a.portrait else '')
        path = os.path.join(a.out, '%s-%s.jpg' % (stem, tag))
        Image.fromarray(img).save(path, quality=JPEG_Q, subsampling=0, optimize=True)
        up = info['art_scale']
        warn = '  (art upscaled %.1fx: supply a larger file for full sharpness)' % up if up > 1.05 else ''
        print('%s  art %dx%d  %.1fs%s' % (path, info['art_px'][0], info['art_px'][1], time.time() - t0, warn))


if __name__ == '__main__':
    main(sys.argv)
