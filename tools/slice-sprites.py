"""Plan 14 v2: turn 8-panel AI strips into uniform transparent sprite sheets.
Usage: python3 tools/slice-sprites.py   (run from the repo root; reads art/source, writes art/sprites)"""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

SRC, OUT = 'art/source', 'art/sprites'
CELL_W, CELL_H, PAD = 360, 480, 12
NAMES = {'pitcher': ['set', 'hands-up', 'kick', 'peak', 'stride', 'cock', 'release', 'follow'],
         'batter': ['stance', 'load', 'stride', 'swing', 'contact', 'follow', 'take', 'bail']}

def background(a):
    near = a.min(2) > 240
    lab, n = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # enclosed pockets: only flat pure white counts as background (keeps shaded uniforms)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if i in border or sl is None: continue
        m = lab[sl] == i
        if m.sum() < 150: continue
        px = a[sl][m]
        if px.mean() > 248 and px.std() < 3: bg[sl] |= m
    return bg

def remove_mound(a, fg):
    h = a.shape[0]
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    tan = (r - b > 28) & (r > 140) & (a.max(2) - a.min(2) > 25)
    band = np.zeros_like(fg); band[int(h * 0.78):] = True
    fg = fg & ~(tan & band)
    # drop leftover specks in the band
    lab, n = ndi.label(fg & band)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    for i, s in enumerate(sizes, 1):
        if s < 60: fg[lab == i] = False
    return fg

def ranges(mask, min_size, tol=4):
    lab, n = ndi.label(mask)
    objs = ndi.find_objects(lab)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = sorted((objs[i][1].start, objs[i][1].stop) for i in range(n) if sizes[i] > min_size)
    merged = []
    for s_, e in big:
        if merged and s_ <= merged[-1][1] + tol: merged[-1][1] = max(merged[-1][1], e)
        else: merged.append([s_, e])
    return merged

BANDS = [(0.0, 0.75), (0.45, 0.78), (0.6, 0.97), (0.3, 0.6)]

def split(fg, h, role):
    """Find exactly 8 figures using the first horizontal band that separates them cleanly.
    Batters are found by their legs: bats cross between neighbouring panels."""
    order = BANDS if role == 'pitcher' else [(0.62, 0.97), (0.45, 0.78)] + BANDS
    for b0, b1 in order:
        r = ranges(fg[int(h * b0): int(h * b1)], 800)
        if len(r) == 8: return r
    r = ranges(fg[: int(h * 0.75)], 3000)
    if len(r) == 8: return r
    # plan 14 v1 step 2 fallback: cut at the lowest leg-band coverage column near each 1/8 mark
    band = fg[int(h * 0.62): int(h * 0.97)] if role == 'batter' else fg[int(h * 0.45): int(h * 0.78)]
    cov = band.sum(0); W = fg.shape[1]; win = W // 16
    cuts = [0]
    for k in range(1, 8):
        c = round(W * k / 8); lo, hi = c - win, c + win
        cuts.append(lo + int(np.argmin(cov[lo:hi])))
    cuts.append(W)
    figs = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        nz = np.nonzero(cov[a:b])[0]
        if nz.size == 0: return []
        figs.append([a + nz[0], a + nz[-1] + 1])
    print(f'note: leg-gap fallback used, cut columns {cuts[1:-1]}')
    return figs

def seg_batter(fg, h):
    """Plan 14 v4: seed each batter at head/upper torso, flood inside the figure mask."""
    from skimage.segmentation import watershed
    op = ndi.binary_opening(fg, structure=np.ones((21, 21)))
    y0, y1 = int(h * 0.15), int(h * 0.40)
    lab, n = ndi.label(op[y0:y1])
    objs = ndi.find_objects(lab); sz = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    seeds = sorted([(o[1].start, o[1].stop, i + 1) for i, (o, z) in enumerate(zip(objs, sz)) if z > 1500])
    if len(seeds) != 8: return None, None, f'{len(seeds)} head seeds found (need 8)'
    xs = [(a + b) / 2 for a, b, _ in seeds]
    gaps = np.diff(xs)
    if gaps.min() < 150 or gaps.max() > 400: return None, None, f'seed spacing odd {gaps.astype(int).tolist()}'
    if max(b - a for a, b, _ in seeds) > 250: return None, None, 'seed too wide (two figures merged?)'
    dist = ndi.distance_transform_edt(fg)
    core = dist[y0:y1] >= 14  # thick body core only: no bat survives this
    markers = np.zeros(fg.shape, np.int32)
    for k, (_, _, li) in enumerate(seeds, 1):
        markers[y0:y1][(lab == li) & core] = k
    if any(not (markers == k).any() for k in range(1, 9)): return None, None, 'empty seed core'
    # thick bodies flood first; each thin piece (bat, forearm) then goes whole to the body it touches most
    thick = op & fg
    ws = watershed(-dist, markers, mask=thick)
    thin_lab, tn = ndi.label(fg & ~thick & (ws == 0))
    for i, sl in enumerate(ndi.find_objects(thin_lab), 1):
        if sl is None: continue
        pad = (slice(max(sl[0].start - 1, 0), sl[0].stop + 1), slice(max(sl[1].start - 1, 0), sl[1].stop + 1))
        m = thin_lab[pad] == i
        ring = ndi.binary_dilation(m) & ~m
        touch = ws[pad][ring]
        touch = touch[touch > 0]
        if touch.size:
            labs = np.unique(touch)
            if len(labs) >= 2 and labs.max() - labs.min() == 1:
                # bat lying across the next batter: swings point right, so it belongs to the left figure
                ws[pad][m] = labs.min()
            else:
                ws[pad][m] = np.bincount(touch).argmax()
    owner = ws - 1  # -1 = unreached
    # unreached pieces: drop specks, give the rest to the nearest assigned pixel
    un = fg & (ws == 0)
    plab, pn = ndi.label(un)
    _, (iy, ix) = ndi.distance_transform_edt(ws == 0, return_indices=True)
    for i, sl in enumerate(ndi.find_objects(plab), 1):
        m = plab[sl] == i
        if m.sum() < 150:
            fg[sl][m] = False; continue
        yy, xx = np.nonzero(m); yy += sl[0].start; xx += sl[1].start
        owner[yy, xx] = ws[iy[yy, xx], ix[yy, xx]] - 1
    figs = [[a, b] for a, b, _ in seeds]
    widths = []
    for k in range(8):
        cols = np.nonzero((owner == k).any(0))[0]
        widths.append(cols[-1] - cols[0] + 1 if cols.size else 0)
    med = sorted(widths)[4]
    if max(widths) > 2 * med: return None, None, f'frame too wide {widths}'
    return owner, figs, None

def defringe(a, fg):
    rgba = np.dstack([a, (fg * 255).astype(np.uint8)]).astype(float)
    edge = fg & ~ndi.binary_erosion(fg)
    alpha = np.clip((255 - a.min(2)) / 60.0, 0, 1)
    al = np.where(edge, np.maximum(alpha, 0.35), fg.astype(float))
    for c in range(3):
        ch = rgba[..., c]
        un = (ch - 255 * (1 - al)) / np.maximum(al, 1e-3)
        rgba[..., c] = np.where(edge, np.clip(un, 0, 255), ch)
    rgba[..., 3] = al * 255
    return rgba.astype(np.uint8)

def frames_of(path, role):
    for mode in ('bands', 'even'):
        fr, err = _frames(path, role, mode)
        if fr is None: continue
        hs = [f[0].shape[0] for f in fr]
        med = sorted(hs)[4]
        px = [int((f[0][..., 3] > 128).sum()) for f in fr]
        pmed = sorted(px)[4]
        if min(hs) >= 0.6 * med and min(px) >= 0.5 * pmed and max(px) <= 1.6 * pmed and max(f[0].shape[1] for f in fr) <= 0.3 * Image.open(path).width:
            if mode == 'even': print(f'FALLBACK even split used for {path}')
            return fr, None
        err = f'{mode}: frame sizes uneven {hs}'
    return None, err

def _frames(path, role, mode):
    a = np.asarray(Image.open(path).convert('RGB'))
    h = a.shape[0]
    fg = ~background(a)
    if role == 'pitcher': fg = remove_mound(a, fg)
    if role == 'batter':
        if mode == 'even': return None, 'even split disabled for batters (v4)'
        owner_map, figs, err = seg_batter(fg, h)
        if err: return None, err
    else:
        if mode == 'even':
            W = a.shape[1]; figs = [[round(W * k / 8) + 10, round(W * (k + 1) / 8) - 10] for k in range(8)]
        else:
            figs = split(fg, h, role)
        if len(figs) != 8: return None, f'{len(figs)} figures found'
        cuts = [0] + [(figs[i][1] + figs[i + 1][0]) // 2 for i in range(7)] + [a.shape[1]]
        centers = np.array([(f0 + f1) / 2 for f0, f1 in figs])
        # assign each connected piece to the figure whose x-range it overlaps most (bats stay with their batter);
        # a piece that clearly overlaps two or more figures (two batters joined by a bat) is split at the cut columns
        lab, n = ndi.label(fg)
        xs_all = np.broadcast_to(np.arange(a.shape[1])[None, :], fg.shape)
        col_owner = np.searchsorted(np.array(cuts[1:-1]), np.arange(a.shape[1]), side='right')
        owner_map = np.full(fg.shape, -1)
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            if sl is None: continue
            xs0, xs1 = sl[1].start, sl[1].stop
            ov = [max(0, min(xs1, f1) - max(xs0, f0)) for f0, f1 in figs]
            hits = [k for k, o in enumerate(ov) if o > 0.25 * (figs[k][1] - figs[k][0])]
            m = lab[sl] == i
            if len(hits) >= 2:
                # v3: give the whole piece to the figure owning >= 80% of its leg-band pixels (a bat stays with its batter)
                ys_p, xs_p = np.nonzero(m)
                ys_p = ys_p + sl[0].start; xs_p = xs_p + xs0
                leg = ys_p >= int(h * 0.62)
                if leg.sum() > 0:
                    counts = np.array([((xs_p[leg] >= f0) & (xs_p[leg] < f1)).sum() for f0, f1 in figs])
                    k = int(np.argmax(counts))
                    if counts[k] >= 0.8 * leg.sum():
                        owner_map[sl][m] = k
                        continue
                owner_map[sl][m] = col_owner[xs_all[sl][m]]
            else:
                k = int(np.argmax(ov)) if max(ov) > 0 else int(np.argmin(abs(centers - (xs0 + xs1) / 2)))
                owner_map[sl][m] = k
    rgba = defringe(a, fg)
    out = []
    for i in range(8):
        own = (owner_map == i) & fg
        if role == 'batter' and i not in (4, 6, 7):
            # only contact, take and bail frames may carry a loose ball; drop loose bits elsewhere
            cl, cn = ndi.label(own)
            if cn > 1:
                cs = ndi.sum(np.ones_like(cl), cl, range(1, cn + 1))
                own = cl == (int(np.argmax(cs)) + 1)
        if own.sum() < 2000: return None, f'frame {i + 1} empty after split'
        ys, xs = np.nonzero(own)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        img = rgba[y0:y1, x0:x1].copy()
        m = own[y0:y1, x0:x1]
        img[..., 3] = np.where(m, img[..., 3], 0)
        hh = y1 - y0
        band = m[int(hh * 0.2): int(hh * 0.5)]
        f0, f1 = figs[i]; wpad = 0.4 * (f1 - f0)
        bx = np.nonzero(band)[1] + x0
        bx = bx[(bx >= f0 - wpad) & (bx < f1 + wpad)]
        anchor = (bx.mean() - x0) if bx.size else m.shape[1] / 2
        out.append((img, anchor))
    return out, None

def main():
    os.makedirs(OUT, exist_ok=True)
    report, checks = [], []
    for role in ('pitcher', 'batter'):
        strips = sorted(glob.glob(f'{SRC}/{role}/*.png'))
        loaded = {}
        for p in strips:
            fr, err = frames_of(p, role)
            if err: report.append(f'SKIP {p}: {err}'); continue
            loaded[p] = fr
        if not loaded: continue
        # one scale for the whole role, fitting height and both sides of the anchor
        need_h = max(f[0].shape[0] for fr in loaded.values() for f in fr)
        need_side = max(max(anc, f[0].shape[1] - anc) for fr in loaded.values() for f, anc in [(x[0], x[1]) for x in fr])
        scale = min(1.0, (CELL_H - 2 * PAD) / need_h, (CELL_W / 2 - PAD) / need_side)
        os.makedirs(f'{OUT}/{role}', exist_ok=True)
        for p, fr in loaded.items():
            name = os.path.splitext(os.path.basename(p))[0]
            sheet = Image.new('RGBA', (CELL_W * 8, CELL_H), (0, 0, 0, 0))
            for i, (img, anc) in enumerate(fr):
                im = Image.fromarray(img, 'RGBA')
                w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
                im = im.resize((w, h), Image.LANCZOS)
                x = i * CELL_W + round(CELL_W / 2 - anc * scale)
                y = CELL_H - PAD - h
                sheet.alpha_composite(im, (x, y))
            sheet.save(f'{OUT}/{role}/{name}.png', optimize=True)
            json.dump({'cell': [CELL_W, CELL_H], 'frames': 8, 'names': NAMES[role], 'baseline': CELL_H - PAD, 'scale': round(scale, 4)},
                      open(f'{OUT}/{role}/{name}.json', 'w'), indent=1)
            gif = []
            for i in range(8):
                f = Image.new('RGBA', (CELL_W, CELL_H), (226, 231, 222, 255))
                f.alpha_composite(sheet.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)))
                gif.append(f.convert('RGB'))
            gif[0].save(f'{OUT}/{role}/{name}.preview.gif', save_all=True, append_images=gif[1:], duration=100, loop=0)
            checks.append((f'{role}/{name}', sheet))
            report.append(f'OK {role}/{name} scale={scale:.3f}')
    # contact sheet: checkerboard, red baseline, cell borders
    rows = len(checks)
    cs = Image.new('RGBA', (CELL_W * 8 // 3, rows * (CELL_H // 3 + 16)), 'white')
    d = ImageDraw.Draw(cs)
    for r, (label, sh) in enumerate(checks):
        y = r * (CELL_H // 3 + 16)
        bgc = Image.new('RGBA', sh.size, (255, 255, 255, 255)); bd = ImageDraw.Draw(bgc)
        for yy in range(0, CELL_H, 24):
            for xx in range(0, sh.width, 24):
                if (xx // 24 + yy // 24) % 2: bd.rectangle([xx, yy, xx + 23, yy + 23], fill=(222, 222, 222, 255))
        bgc.alpha_composite(sh); bd = ImageDraw.Draw(bgc)
        bd.line([0, CELL_H - PAD, sh.width, CELL_H - PAD], fill=(220, 0, 0, 255), width=2)
        for i in range(9): bd.line([i * CELL_W, 0, i * CELL_W, CELL_H], fill=(0, 0, 255, 255), width=2)
        cs.paste(bgc.resize((sh.width // 3, CELL_H // 3)), (0, y + 16))
        d.text((4, y + 2), label, fill='black')
    cs.convert('RGB').save(f'{OUT}/_check.png')
    print('\n'.join(report))

if __name__ == '__main__':
    main()
