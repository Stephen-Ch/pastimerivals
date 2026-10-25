"""Plan 44 (v4.2): slice the 5 fielder sheets into 8 aligned frames and make pen-and-ink sheets.
Frames: 0 ready, 1 run, 2 catch high, 3 scoop, 4 throw, 5 first-base stretch, 6 catcher mask up, 7 catcher catching.
Reads art/source/fielder/run2-<era>.png (eras 1901 1920 1946 1970 1990), writes art/sprites/fielder/<era>-color.png,
<era>-line.png (pen and ink: every fill white, so no skin tone shows) and fielder-meta.json.
One scale per sheet, so the figures keep their sizes relative to each other. Feet on FOOT_Y, torso centred.
Usage (repo root): python3 tools/slice-fielders.py [src_dir] [out_dir]"""
import json, os, sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi

CW, CH, FOOT_Y, MAXH, CX = 360, 420, 410, 390, 0.5
ERAS = ('1901', '1920', '1946', '1970', '1990')
SRC = sys.argv[1] if len(sys.argv) > 1 else 'art/source/fielder'
OUTD = sys.argv[2] if len(sys.argv) > 2 else 'art/sprites/fielder'

def fgmask(a):
    near = a.min(2) > 238
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    for i, sl in enumerate(ndi.find_objects(lab), 1):   # enclosed white pockets: a real gap (between arm and body)
        if i in border or sl is None: continue          # is ringed by black outline; white cloth (1946, 1970) is not
        sl = tuple(slice(max(s.start - 4, 0), s.stop + 4) for s in sl)
        m = lab[sl] == i
        if m.sum() < 60: continue
        ring = ndi.binary_dilation(m, iterations=3) & ~m
        if a[sl][m].mean() > 246 and (a[sl][ring].min(1) < 110).mean() >= 0.45: bg[sl] |= m
    fg = ~bg
    lab, n = ndi.label(fg); sz = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    return np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 40])

def owners(fg):
    """Bodies = the 8 tallest pieces; every smaller piece (a ball, a mask held apart) goes to the nearest body."""
    lab, n = ndi.label(fg); objs = ndi.find_objects(lab)
    hts = np.array([o[0].stop - o[0].start for o in objs])
    bodies = [i + 1 for i in range(n) if hts[i] >= 0.45 * hts.max()]
    if len(bodies) != 8: raise SystemExit(f'{len(bodies)} bodies (expected 8)')
    order = sorted(bodies, key=lambda i: ndi.center_of_mass(lab == i)[1])
    rank = {b: k for k, b in enumerate(order)}
    body = np.zeros(fg.shape, np.int32)
    for b in bodies: body[lab == b] = b
    _, (iy, ix) = ndi.distance_transform_edt(body == 0, return_indices=True)
    own = np.full(fg.shape, -1)
    for b in bodies: own[lab == b] = rank[b]
    for i in range(1, n + 1):
        if i in rank: continue
        m = lab == i; yy, xx = np.nonzero(m)
        own[m] = rank[np.bincount(body[iy[yy, xx], ix[yy, xx]]).argmax()]
    return own

def defringe(a, fg):
    edge = fg & ~ndi.binary_erosion(fg)
    al = np.where(edge, np.maximum(np.clip((255 - a.min(2)) / 60.0, 0, 1), 0.35), fg.astype(float))
    rgb = a.astype(float)
    for c in range(3):
        un = (rgb[..., c] - 255 * (1 - al)) / np.maximum(al, 1e-3)
        rgb[..., c] = np.where(edge, np.clip(un, 0, 255), rgb[..., c])
    return np.dstack([rgb, al * 255]).astype(np.uint8)

def clean_shoes(img):
    """Paint out shoe marks: bright bits enclosed by dark shoe pixels in the bottom 8% of the figure."""
    a = img[..., :3].astype(int); al = img[..., 3] > 128
    ys = np.nonzero(al.any(1))[0]; top, bot = ys.min(), ys.max()
    band = np.zeros(al.shape, bool); band[int(bot - 0.085 * (bot - top)):bot + 1] = True
    dark = (a.max(2) < 90) & al & band
    holes = ndi.binary_fill_holes(ndi.binary_closing(dark, np.ones((5, 5)))) & ~dark & al & band
    bright = ndi.binary_dilation(holes & (a.min(2) > 120), np.ones((2, 2))) & holes
    img[bright, :3] = (28, 28, 30)
    return img, int(bright.sum())

def torso_x(m):
    h = m.shape[0]; b = ndi.binary_opening(m, np.ones((15, 15)))[int(h * 0.25): int(h * 0.6)]
    xs = np.nonzero(b)[1]
    return xs.mean() if xs.size else m.shape[1] / 2

def line_art(sheet):
    """Same method as the plan 32C batter line art."""
    a = np.asarray(sheet).astype(float)
    al = a[..., 3]; L = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    sil = al > 128
    ink = (L < 70) & sil
    edge = (np.hypot(ndi.sobel(L, 0), ndi.sobel(L, 1)) > 140) & sil
    rim = sil & ~ndi.binary_erosion(sil, iterations=2)
    lines = (ink & ~ndi.binary_opening(ink, np.ones((7, 7)))) | edge | rim
    out = np.zeros(a.shape, np.uint8); out[..., :3] = 255; out[..., 3] = np.where(sil, 255, 0)
    out[lines, :3] = (29, 27, 25)
    return Image.fromarray(out)

def hybrid(color, line):
    """Stephen 2026-10-24: keep the uniform colors, but skin goes pen-and-ink white (no skin tone assigned)."""
    a = np.asarray(color).astype(int); l = np.asarray(line)
    R, G, B, A = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    skin = (A > 128) & (R > 165) & (G > 115) & (B > 85) & (R - G >= 12) & (R - G <= 75) & (G - B >= 8) & (G - B <= 60) & (R - B >= 30)
    skin = ndi.binary_opening(skin, np.ones((2, 2)))
    lab, n = ndi.label(skin); sz = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    skin = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 25])
    skin = ndi.binary_closing(skin, iterations=2) & (A > 128)
    grow = ndi.binary_dilation(skin, iterations=1) & (A > 128) & (a[..., :3].max(2) > 110)
    out = a.astype(np.uint8); out[grow] = l[grow]
    return Image.fromarray(out)

os.makedirs(OUTD, exist_ok=True)
meta = {'cell': [CW, CH], 'footY': FOOT_Y, 'frames': ['ready', 'run', 'catchHigh', 'scoop', 'throw', 'stretch', 'catcherUp', 'catcherCatch'], 'sheets': {}}
bad = False
for era in ERAS:
    p = f'{SRC}/run2-{era}.png'
    if not os.path.exists(p): print('missing', p); bad = True; continue
    a = np.asarray(Image.open(p).convert('RGB'))
    fg = fgmask(a); own = owners(fg); rgba = defringe(a, fg)
    frames = []
    for k in range(8):
        m = (own == k) & fg; ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        img = rgba[y0:y1, x0:x1].copy(); img[..., 3] = np.where(m[y0:y1, x0:x1], img[..., 3], 0)
        frames.append(img)
    s = MAXH / max(f.shape[0] for f in frames)
    sheet = Image.new('RGBA', (CW * 8, CH), (0, 0, 0, 0)); sm = {'scale': round(s, 4), 'frames': [], 'shoePixels': 0}
    for k, f in enumerate(frames):
        im = Image.fromarray(f).resize((max(1, round(f.shape[1] * s)), max(1, round(f.shape[0] * s))), Image.LANCZOS)
        arr = np.asarray(im).copy(); arr, n = clean_shoes(arr); sm['shoePixels'] += n
        m = arr[..., 3] > 128
        px = round(CW * CX - torso_x(m)); py = FOOT_Y - arr.shape[0]
        if arr.shape[1] < CW - 4: px = min(max(px, 2), CW - 2 - arr.shape[1])
        clip = px < 0 or px + arr.shape[1] > CW or py < 0
        sheet.alpha_composite(Image.fromarray(arr), (k * CW + max(px, 0), max(py, 0)), (max(-px, 0), max(-py, 0)))
        sm['frames'].append({'w': arr.shape[1], 'h': arr.shape[0], 'x': px, 'y': py, 'clipped': bool(clip)})
    alpha = np.asarray(sheet)[..., 3] > 128
    for k in range(8):   # no opaque piece may touch a cell edge
        cl, _ = ndi.label(alpha[:, k * CW:(k + 1) * CW])
        if set(np.unique(np.concatenate([cl[:, 0], cl[:, -1], cl[0], cl[-1]]))) - {0}: print(f'EDGE {era} frame {k}'); bad = True
    if any(f['clipped'] for f in sm['frames']): print(f'{era} clipped'); bad = True
    line = line_art(sheet)
    sheet.save(f'{OUTD}/{era}-color.png'); line.save(f'{OUTD}/{era}-line.png'); hybrid(sheet, line).save(f'{OUTD}/{era}-hybrid.png')
    meta['sheets'][era] = sm
    print(era, 'scale', sm['scale'], 'shoe px', sm['shoePixels'], 'heights', [f['h'] for f in sm['frames']])
json.dump(meta, open(f'{OUTD}/fielder-meta.json', 'w'), indent=1)
sys.exit(1 if bad else 0)
