"""Plan 32B/32C: slice side-on batter sheets into 8 aligned frames (cell 520 x 480), paint out shoe logos, record the
contact point, and make line-art sheets. Usage (repo root): python3 tools/slice-side-batter.py
Reads art/source/batter/side/*.png, writes art/sprites/batter-side/."""
import glob, json, os, sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
CW, CH, FOOT_Y, MAXH, CX = 520, 480, 470, 440, 0.40
def fgmask(a):
    near = a.min(2) > 238
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    for i, sl in enumerate(ndi.find_objects(lab), 1):   # enclosed flat white pockets (between arm and body)
        if i in border or sl is None: continue
        m = lab[sl] == i
        if m.sum() < 120: continue
        px = a[sl][m]
        if px.mean() > 246 and px.std() < 4: bg[sl] |= m
    fg = ~bg
    lab, n = ndi.label(fg); sz = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 400])
    return keep
def owners(fg):
    """Bodies = tall connected pieces (8 expected; a merged pair is split at its leg gap). Every other piece
    (a bat drawn apart from the hands) goes whole to the nearest body."""
    lab, n = ndi.label(fg); objs = ndi.find_objects(lab)
    hts = np.array([o[0].stop - o[0].start for o in objs])
    bodies = [i + 1 for i in range(n) if hts[i] >= 0.55 * hts.max()]
    body = np.zeros(fg.shape, np.int32)
    for i in bodies: body[lab == i] = i
    while len(bodies) < 8:
        w = max(bodies, key=lambda i: objs[i - 1][1].stop - objs[i - 1][1].start)
        sl = objs[w - 1]; m = lab == w
        y0, y1 = sl[0].start, sl[0].stop; x0, x1 = sl[1].start, sl[1].stop
        # two torsos = thick blobs in the upper body; flood the merged piece from them (watershed)
        from skimage.segmentation import watershed
        # two heads = the two biggest pieces in the top quarter; flood the merged piece from them (watershed)
        band = np.zeros_like(m); band[y0: int(y0 + 0.25 * (y1 - y0))] = True
        cl, cn = ndi.label(ndi.binary_opening(m & band, np.ones((9, 9))))
        cs = ndi.sum(np.ones_like(cl), cl, range(1, cn + 1)); top2 = np.argsort(cs)[-2:] + 1
        markers = np.zeros(m.shape, np.int32)
        for j, t in enumerate(top2, 1): markers[cl == t] = j
        ws = watershed(-ndi.distance_transform_edt(m), markers, mask=m)
        xs1 = np.nonzero(ws == 1)[1].mean(); xs2 = np.nonzero(ws == 2)[1].mean()
        right = ws == (2 if xs2 > xs1 else 1); cut = int(min(xs1, xs2))
        new = lab.max() + 1
        lab[right] = new; body[right] = new; objs = ndi.find_objects(lab)
        bodies.append(new); print('  split merged figure at x', cut)
    if len(bodies) > 8: raise SystemExit(f'{len(bodies)} bodies')
    order = sorted(bodies, key=lambda i: ndi.center_of_mass(lab == i)[1])
    rank = {b_: k for k, b_ in enumerate(order)}
    _, (iy, ix) = ndi.distance_transform_edt(body == 0, return_indices=True)
    own = np.full(fg.shape, -1)
    for b_ in bodies: own[lab == b_] = rank[b_]
    for i in range(1, lab.max() + 1):
        if i in rank: continue
        m = lab == i
        if not m.any(): continue
        yy, xx = np.nonzero(m)
        near = body[iy[yy, xx], ix[yy, xx]]
        own[m] = rank[np.bincount(near).argmax()]
    return own
def defringe(a, fg):
    al = np.where(fg & ~ndi.binary_erosion(fg), np.maximum(np.clip((255 - a.min(2)) / 60.0, 0, 1), 0.35), fg.astype(float))
    rgb = a.astype(float)
    edge = fg & ~ndi.binary_erosion(fg)
    for c in range(3):
        un = (rgb[..., c] - 255 * (1 - al)) / np.maximum(al, 1e-3)
        rgb[..., c] = np.where(edge, np.clip(un, 0, 255), rgb[..., c])
    return np.dstack([rgb, al * 255]).astype(np.uint8)
def clean_shoes(img):
    """Paint out shoe logos: bright marks enclosed by dark shoe pixels in the bottom 8% of the figure."""
    a = img[..., :3].astype(int); al = img[..., 3] > 128
    ys = np.nonzero(al.any(1))[0]; top = ys.min(); bot = ys.max()
    y0 = int(bot - 0.085 * (bot - top))
    band = np.zeros(al.shape, bool); band[y0:bot + 1] = True
    dark = (a.max(2) < 90) & al & band
    holes = ndi.binary_fill_holes(ndi.binary_closing(dark, np.ones((5, 5)))) & ~dark & al & band
    bright = holes & (a.min(2) > 120)
    bright = ndi.binary_dilation(bright, np.ones((2, 2))) & holes
    n = int(bright.sum())
    img[bright, :3] = (28, 28, 30)
    return img, n
def torso_x(m):
    h = m.shape[0]; body = ndi.binary_opening(m, np.ones((25, 25)))
    b = body[int(h * 0.25): int(h * 0.6)]
    xs = np.nonzero(b)[1]
    return xs.mean() if xs.size else m.shape[1] / 2
out = {}; bad_edge = False
OUTD = 'art/sprites/batter-side'
os.makedirs(OUTD, exist_ok=True)
for p in sorted(glob.glob('art/source/batter/side/*.png')):
    name = os.path.basename(p)[:-4]
    a = np.asarray(Image.open(p).convert('RGB'))
    fg = fgmask(a); own = owners(fg); rgba = defringe(a, fg)
    frames = []
    for k in range(8):
        m = (own == k) & fg
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        img = rgba[y0:y1, x0:x1].copy(); img[..., 3] = np.where(m[y0:y1, x0:x1], img[..., 3], 0)
        frames.append(img)
    s = MAXH / max(f.shape[0] for f in frames)
    sheet = Image.new('RGBA', (CW * 8, CH), (0, 0, 0, 0)); meta = {'scale': round(s, 4), 'frames': [], 'logoPixels': 0}
    for k, f in enumerate(frames):
        im = Image.fromarray(f).resize((max(1, round(f.shape[1] * s)), max(1, round(f.shape[0] * s))), Image.LANCZOS)
        arr = np.asarray(im).copy(); arr, nlogo = clean_shoes(arr); meta['logoPixels'] += nlogo
        m = arr[..., 3] > 128
        tx = torso_x(m); px = round(CW * CX - tx); py = FOOT_Y - arr.shape[0]
        if arr.shape[1] < CW - 4: px = min(max(px, 2), CW - 2 - arr.shape[1])   # a wide pose (running, bat on the ground) shifts to fit
        clip = px < 0 or px + arr.shape[1] > CW or py < 0
        sheet.alpha_composite(Image.fromarray(arr), (k * CW + max(px, 0), max(py, 0)), (max(-px, 0), max(-py, 0)))
        fr = {'w': arr.shape[1], 'h': arr.shape[0], 'x': px, 'y': py, 'clipped': bool(clip)}
        if k == 2:   # plan 36: bat tip while it is still up (start of the swing smear) = highest opaque point
            ys2, xs2 = np.nonzero(m); i = np.argmin(ys2)
            fr['batTip'] = [int(xs2[i] + px), int(ys2[i] + py)]
        if k == 3:   # contact: barrel end = rightmost opaque pixel in the upper 60%; contact point a little inside it
            up = m[: int(arr.shape[0] * 0.6)]
            ys2, xs2 = np.nonzero(up); i = np.argmax(xs2)
            tipx, tipy = xs2[i] + px, ys2[i] + py
            col = up[:, max(xs2[i] - 14, 0)]; yy = np.nonzero(col)[0]
            cy = (yy.mean() + py) if yy.size else tipy
            fr['batTip'] = [int(tipx), int(tipy)]; fr['contact'] = [int(tipx - 14), round(float(cy))]
        meta['frames'].append(fr)
    alpha = np.asarray(sheet)[..., 3] > 128
    for k in range(8):   # no opaque piece may touch a cell edge (ghost bits from a neighbour, or a clipped bat)
        cl, _ = ndi.label(alpha[:, k * CW:(k + 1) * CW])
        if set(np.unique(np.concatenate([cl[:, 0], cl[:, -1], cl[0], cl[-1]]))) - {0}: print(f'EDGE {name} frame {k}'); bad_edge = True
    if any(f['clipped'] for f in meta['frames']): sys.exit(f'{name} has a clipped frame')
    sheet.save(f'{OUTD}/{name}.png'); out[name] = meta
    print(name, 'scale', meta['scale'], 'logo px', meta['logoPixels'], 'clipped', [i for i, f in enumerate(meta['frames']) if f['clipped']], 'contact', meta['frames'][3].get('contact'))
json.dump({'cell': [CW, CH], 'footY': FOOT_Y, 'sheets': out}, open(f'{OUTD}/side-meta.json', 'w'), indent=1)

# Plan 32C: line-art sheets for batters with no researched tone (pen and ink, every fill white, so no skin tone shows).
def line_art(src, dst):
    im = Image.open(src).convert('RGBA'); a = np.asarray(im).astype(float)
    al = a[..., 3]; L = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    sil = al > 128
    ink = (L < 70) & sil
    edge = (np.hypot(ndi.sobel(L, 0), ndi.sobel(L, 1)) > 140) & sil
    rim = sil & ~ndi.binary_erosion(sil, iterations=2)
    lines = (ink & ~ndi.binary_opening(ink, np.ones((7, 7)))) | edge | rim
    out = np.zeros(a.shape, np.uint8); out[..., :3] = 255; out[..., 3] = np.where(sil, 255, 0)
    out[lines, :3] = (29, 27, 25)
    Image.fromarray(out).save(dst)
for look in ('1901', '1920', '1956', '1990'):
    line_art(f'{OUTD}/{look}-light.png', f'{OUTD}/{look}-line.png')
    out[f'{look}-line'] = out[f'{look}-light']
json.dump({'cell': [CW, CH], 'footY': FOOT_Y, 'sheets': out}, open(f'{OUTD}/side-meta.json', 'w'), indent=1)
print('line art done')
