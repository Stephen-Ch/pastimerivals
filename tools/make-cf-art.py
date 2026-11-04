"""Plan 59 Round 5: art for the center-field (CF) windup shot.

  back  SRC ERA TONE   slice an 8-pose back-view pitcher strip (gpt-image-2) into art/sprites/cf/back-<era>-<tone>.png,
                       scaled so its median figure height matches the front windup sprite of the same era and tone,
                       feet on the same baseline (468 of 480), torso centred like the front sheet.
  strip LOOK ERA TONE  frames 0-1 (stance, load) of the front batter sprite -> art/sprites/cf/front-<look>-<era>-<tone>.png
                       (TONE 'line' = pen and ink from the light strip: every fill white, no skin shown).
  cu    SRC ERA        catcher + umpire (2 figures, front view) -> art/sprites/cf/cu-<era>.png, hybrid look like the
                       fielders (uniform colours kept, skin pen-and-ink white), one scale: 7.3 ft per 480 px.
  check                every file in art/sprites/cf: alpha, baseline, heights within 3% of the reference, line = no fill.
Cell 360 x 480, baseline 468 (as art/sprites/pitcher). Needs scipy (cloud). Run from the repo root."""
import importlib.util, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

CW, CH, BASE = 360, 480, 468
OUT = 'art/sprites/cf'
PX_PER_FT = 480 / 7.3          # the windup cell: 480 px for 7.3 ft (park.ts PITCHER_CELL_FT)
CU_FT = {'catcher': 3.7, 'umpire': 5.2}
# Front batter sheet per side look (lookOf): the 1956 look uses the 1946 sheet (helmets from 1956 on).
FRONT_SHEET = {'1901': '1901', '1920': '1920', '1956': '1946', '1990': '1990'}


def _mod(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


here = os.path.dirname(os.path.abspath(__file__))
slicer = _mod('slice_sprites', os.path.join(here, 'slice-sprites.py'))


def boxes(sheet, n=8):
    a = np.asarray(sheet)[..., 3] > 128
    out = []
    for i in range(n):
        c = a[:, i * CW:(i + 1) * CW]
        ys, xs = np.nonzero(c.any(1))[0], np.nonzero(c.any(0))[0]
        out.append((int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1) if ys.size else None)
    return out


def heights(sheet, n=8):
    return [b[1] - b[0] for b in boxes(sheet, n) if b]


def line_art(im):
    """Same method as tools/slice-side-batter.py line_art (plan 32C)."""
    a = np.asarray(im.convert('RGBA')).astype(float)
    al = a[..., 3]; L = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    sil = al > 128
    ink = (L < 70) & sil
    edge = (np.hypot(ndi.sobel(L, 0), ndi.sobel(L, 1)) > 140) & sil
    rim = sil & ~ndi.binary_erosion(sil, iterations=2)
    lines = (ink & ~ndi.binary_opening(ink, np.ones((7, 7)))) | edge | rim
    out = np.zeros(a.shape, np.uint8); out[..., :3] = 255; out[..., 3] = np.where(sil, 255, 0)
    out[lines, :3] = (29, 27, 25)
    return Image.fromarray(out)


def place(frames, scale, n):
    sheet = Image.new('RGBA', (CW * n, CH), (0, 0, 0, 0))
    for i, (img, anc) in enumerate(frames):
        im = Image.fromarray(img, 'RGBA')
        w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
        im = im.resize((w, h), Image.LANCZOS)
        sheet.alpha_composite(im, (i * CW + round(CW / 2 - anc * scale), BASE - h))
    return sheet


def clear_pockets(sheet, min_area=120):
    """Enclosed flat near-white pockets (gaps between the arms and the head) become transparent; small white bits
    (the ball, piping) stay."""
    a = np.asarray(sheet).copy()
    white = (a[..., 3] > 128) & (a[..., :3].min(2) > 240)
    lab, n = ndi.label(white)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None: continue
        m = lab[sl] == i
        px = a[sl][m][:, :3].astype(float)
        # paper white between the arms and the head (hands-up poses); white jerseys lower down stay
        cell = sl[1].start // CW; fy = np.nonzero(a[:, cell * CW:(cell + 1) * CW, 3].max(1) > 128)[0]
        high = fy.size and sl[0].stop < fy.min() + 0.3 * (fy.max() - fy.min())
        if cell == 1 and m.sum() >= min_area and px.mean() > 246 and px.std() < 4 and high: a[sl][..., 3][m] = 0   # hands-up pose only
    return Image.fromarray(a)


def _outer_background(a):
    """slice-sprites background() without its enclosed-pocket rule (it eats flat white jerseys); pockets are cleared
    later by clear_pockets, high on the figure only."""
    near = a.min(2) > 240
    # close small gaps in the ink outline first, so a flat white jersey is not flooded from outside
    inner = near & ~ndi.binary_dilation(~near, iterations=2)
    lab, n = ndi.label(inner)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return ndi.binary_dilation(np.isin(lab, list(border)), iterations=3) & near


def back(src, era, tone):
    keep = slicer.background; slicer.background = _outer_background
    try: fr, err = slicer.frames_of(src, 'pitcher')
    finally: slicer.background = keep
    if err: raise SystemExit(f'{src}: {err}')
    ref = Image.open(f'art/sprites/pitcher/{era}-{tone}.png')
    want = float(np.median(heights(ref)))
    have = float(np.median([f[0].shape[0] for f in fr]))
    sheet = clear_pockets(place(fr, want / have, 8))
    os.makedirs(OUT, exist_ok=True)
    p = f'{OUT}/back-{era}-{tone}.png'; sheet.save(p, optimize=True)
    print('wrote', p, 'scale', round(want / have, 4))


BATTER_SRC = 'art/source/batter-cf'   # gpt-image-2: the batter side-on as the CF camera sees him (stance, load)


def side_on(src, sheet, tone):
    """Stephen (Nov 4): the batter stands sideways to the pitcher (chest toward the plate). Two figures, left to right,
    scaled so the stance is as tall as the front sprite's stance, feet on the baseline, mirrored so a righty faces
    screen left (toward the plate as seen from center field)."""
    a = np.asarray(Image.open(src).convert('RGB'))
    fg = ~_outer_background(a)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:2]]
    objs = sorted(((ndi.find_objects(lab)[k - 1], k) for k in keep), key=lambda o: o[0][1].start)
    if len(objs) != 2: raise SystemExit(f'{src}: {len(objs)} figures')
    rgba = slicer.defringe(a, fg)
    want = heights(Image.open(f'art/sprites/batter/{sheet}-{tone}.png'))[0]
    sc = want / (objs[0][0][0].stop - objs[0][0][0].start)
    out = Image.new('RGBA', (CW * 2, CH), (0, 0, 0, 0))
    for i, (sl, k) in enumerate(objs):
        m = lab[sl] == k
        img = rgba[sl].copy(); img[..., 3] = np.where(m, img[..., 3], 0)
        im = Image.fromarray(img, 'RGBA').transpose(Image.FLIP_LEFT_RIGHT)
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        if im.width > CW: raise SystemExit(f'{src}: figure {i} too wide for the cell')
        out.alpha_composite(im, (i * CW + (CW - im.width) // 2, BASE - im.height))
    return out


def strip(look, era, tone):
    src_tone = 'light' if tone == 'line' else tone
    s = side_on(f'{BATTER_SRC}/{FRONT_SHEET[look]}-{src_tone}.png', FRONT_SHEET[look], src_tone)
    rule = RECOLOR.get((look, era)) or RECOLOR.get((look, era, tone))
    if rule and tone != 'line': s = recolor(s, rule, era)
    if tone == 'line': s = line_art(s)
    os.makedirs(OUT, exist_ok=True)
    p = f'{OUT}/front-{look}-{era}-{tone}.png' if tone != 'line' else f'{OUT}/front-{look}-line.png'
    s.save(p, optimize=True); print('wrote', p)


def cu(src, era):
    a = np.asarray(Image.open(src).convert('RGB'))
    fg = ~slicer.background(a)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(np.ones_like(lab), lab, range(1, n + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:2]]
    objs = sorted(((ndi.find_objects(lab)[k - 1], k) for k in keep), key=lambda o: o[0][1].start)   # left to right
    if len(objs) != 2: raise SystemExit(f'{src}: {len(objs)} figures')
    (sa, _), (sb, _) = objs; ha, hb = sa[0].stop - sa[0].start, sb[0].stop - sb[0].start
    if not (1.1 < hb / ha < 2.0) or min(sa[1].stop - sa[1].start, sb[1].stop - sb[1].start) < 0.4 * max(sa[1].stop - sa[1].start, sb[1].stop - sb[1].start):
        raise SystemExit(f'{src}: the two figures do not look like a catcher and a taller umpire ({ha}, {hb} px tall)')
    rgba = slicer.defringe(a, fg)
    sheet = Image.new('RGBA', (CW * 2, CH), (0, 0, 0, 0))
    for i, ((sl, k), name) in enumerate(zip(objs, ('catcher', 'umpire'))):
        m = lab[sl] == k
        img = rgba[sl].copy(); img[..., 3] = np.where(m, img[..., 3], 0)
        im = Image.fromarray(img, 'RGBA')
        sc = CU_FT[name] * PX_PER_FT / im.height
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        sheet.alpha_composite(im, (i * CW + (CW - im.width) // 2, BASE - im.height))
    sheet = hybrid(sheet)
    os.makedirs(OUT, exist_ok=True)
    p = f'{OUT}/cu-{era}.png'; sheet.save(p, optimize=True); print('wrote', p)


def hybrid(sheet):
    """Skin to pen-and-ink white, uniform colours kept (the fielders' hybrid look): skin = warm, light-to-mid pixels."""
    a = np.asarray(sheet).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    skin = (al > 128) & (r > 120) & (r - b > 35) & (r - g > 12) & (g - b > 8) & (r < 250)
    skin = ndi.binary_opening(skin, iterations=1)
    line = np.asarray(line_art(sheet))
    out = a.copy().astype(np.uint8)
    out[skin, :3] = line[skin, :3]
    return Image.fromarray(out)


# ---- Part 2: era colours for the front strips (simple Lab gates; the strips are 2 still frames) ----
PAL = {'1946': {'body': (87, 2, 16), 'trim': (35, 47, 35)}, '1970': {'body': (89, 0, 10), 'trim': (26, 8, -34)},
       '1990': {'body': (15, 0, 2), 'pants': (78, 2, 10)}}
# (look, era short, tone) -> what to recolour. 1920 look in 1946-55: gray flannel to cream, navy trim to red.
# 1956 look in 1970-89: red trim to royal blue. 1990 darkbrown: cream jersey to black, cream pants to gray.
RECOLOR = {('1920', '1946'): 'gray-navy', ('1956', '1970'): 'red'}   # the side-on art (Nov 4) already wears the 1990 black


def _lab(rgb):
    c = rgb / 255.0; c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _rgb(lab):
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1); xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * np.array([0.95047, 1.0, 1.08883])
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    c = xyz @ M.T; c = np.where(c > 0.0031308, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055, 12.92 * c)
    return np.clip(c * 255, 0, 255)


def _paint(lab, m, target, k=0.7):
    if not m.any(): return
    L = lab[..., 0]; med = np.median(L[m])
    lab[..., 0][m] = np.clip(target[0] + (L[m] - med) * k, 0, 100)
    lab[..., 1][m] = target[1]; lab[..., 2][m] = target[2]


def recolor(im, rule, era):
    a = np.asarray(im.convert('RGBA')).astype(float); lab = _lab(a[..., :3]); al = a[..., 3] > 128
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]; C = np.hypot(A, B)
    if rule == 'gray-navy':
        gray = al & (C < 10) & (L > 45) & (L < 95)
        navy = al & (L < 50) & (B < -6) & (C > 6)
        _paint(lab, gray, PAL[era]['body']); _paint(lab, navy, PAL[era]['trim'], 0.5)
    elif rule == 'red':
        red = al & (A > 30) & (A > 0.9 * B) & (L < 75)
        _paint(lab, red, PAL[era]['trim'], 0.6)
    elif rule == 'cream':
        cream = al & (L > 62) & (C < 28) & (A < 9) & (B > -3)
        for i in range(a.shape[1] // CW):   # per frame: split jersey and pants at the belt (row with the least cream mid-body)
            sl = np.s_[:, i * CW:(i + 1) * CW]; m = cream[sl]
            ys = np.nonzero((al[sl]).any(1))[0]; y0, y1 = ys.min(), ys.max()
            rows = m.sum(1); lo, hi = int(y0 + 0.38 * (y1 - y0)), int(y0 + 0.62 * (y1 - y0))
            belt = lo + int(np.argmin(rows[lo:hi]))
            top = np.zeros_like(m); top[:belt] = True
            jl, pl = lab[sl].copy(), lab[sl].copy()
            jm, pm = m & top, m & ~top
            _paint(jl, jm, PAL[era]['body'], 0.3); _paint(pl, pm, PAL[era]['pants'])
            out = lab[sl]; out[jm] = jl[jm]; out[pm] = pl[pm]; lab[sl] = out
    rgb = _rgb(lab); out = a.copy(); out[..., :3] = np.where(al[..., None], rgb, a[..., :3])
    return Image.fromarray(out.astype(np.uint8))


def check():
    bad = []
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.png'): continue
        im = Image.open(f'{OUT}/{f}').convert('RGBA'); n = im.width // CW
        bx = boxes(im, n)
        if any(b is None for b in bx): bad.append(f'{f}: empty frame'); continue
        if any(abs(b[1] - BASE) > 2 for b in bx): bad.append(f'{f}: feet off the baseline {[b[1] for b in bx]}')
        if f.startswith('front-'):   # the stance (bat up) is 6.0-7.6 ft at the cell scale
            ft = heights(im, n)[0] / PX_PER_FT
            if not 6.0 <= ft <= 7.6: bad.append(f'{f}: batter {ft:.1f} ft tall')
        if f.startswith('back-'):
            era, tone = f[5:-4].split('-')
            ref = heights(Image.open(f'art/sprites/pitcher/{era}-{tone}.png'))
            if abs(np.median(heights(im)) / np.median(ref) - 1) > 0.03: bad.append(f'{f}: height off the front windup')
            al = np.asarray(im)[..., 3] > 128
            for i in range(8):
                if i == 1: continue   # hands up: the gap between the arms is real
                c = al[:, i * CW:(i + 1) * CW]; holes = ndi.binary_fill_holes(c) & ~c
                if holes.sum() > 0.01 * c.sum(): bad.append(f'{f}: frame {i} has see-through holes ({holes.sum()} px)')
        if f.startswith('front-') and f.endswith('-line.png'):
            a = np.asarray(im); fill = (a[..., 3] > 128) & (a[..., :3].min(2) < 250) & (a[..., :3].max(2) > 40)
            if fill.sum() > 0.002 * (a[..., 3] > 128).sum(): bad.append(f'{f}: line strip has colour fill')
    print('\n'.join(bad) or 'cf check ok')
    return not bad


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'back': back(*sys.argv[2:5])
    elif cmd == 'strip': strip(*sys.argv[2:5])
    elif cmd == 'cu': cu(*sys.argv[2:4])
    elif cmd == 'check': sys.exit(0 if check() else 1)
    else: print(__doc__)
