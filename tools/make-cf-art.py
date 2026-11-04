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
        if m.sum() >= min_area and a[sl][m][:, :3].mean() > 246: a[sl][..., 3][m] = 0
    return Image.fromarray(a)


def back(src, era, tone):
    fr, err = slicer.frames_of(src, 'pitcher')
    if err: raise SystemExit(f'{src}: {err}')
    ref = Image.open(f'art/sprites/pitcher/{era}-{tone}.png')
    want = float(np.median(heights(ref)))
    have = float(np.median([f[0].shape[0] for f in fr]))
    sheet = clear_pockets(place(fr, want / have, 8))
    os.makedirs(OUT, exist_ok=True)
    p = f'{OUT}/back-{era}-{tone}.png'; sheet.save(p, optimize=True)
    print('wrote', p, 'scale', round(want / have, 4))


def strip(look, era, tone):
    src_tone = 'light' if tone == 'line' else tone
    s = Image.open(f'art/sprites/batter/{FRONT_SHEET[look]}-{src_tone}.png').convert('RGBA').crop((0, 0, 2 * CW, CH))
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


def check():
    bad = []
    for f in sorted(os.listdir(OUT)):
        if not f.endswith('.png'): continue
        im = Image.open(f'{OUT}/{f}').convert('RGBA'); n = im.width // CW
        bx = boxes(im, n)
        if any(b is None for b in bx): bad.append(f'{f}: empty frame'); continue
        if any(abs(b[1] - BASE) > 2 for b in bx): bad.append(f'{f}: feet off the baseline {[b[1] for b in bx]}')
        if f.startswith('back-'):
            era, tone = f[5:-4].split('-')
            ref = heights(Image.open(f'art/sprites/pitcher/{era}-{tone}.png'))
            if abs(np.median(heights(im)) / np.median(ref) - 1) > 0.03: bad.append(f'{f}: height off the front windup')
        if f.startswith('front-') and f.endswith('-line.png'):
            a = np.asarray(im); fill = (a[..., 3] > 128) & (a[..., :3].min(2) < 250) & (a[..., :3].max(2) > 40)
            if fill.mean() > 0.002: bad.append(f'{f}: line strip has colour fill')
    print('\n'.join(bad) or 'cf check ok')
    return not bad


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'back': back(*sys.argv[2:5])
    elif cmd == 'strip': strip(*sys.argv[2:5])
    elif cmd == 'cu': cu(*sys.argv[2:4])
    elif cmd == 'check': sys.exit(0 if check() else 1)
    else: print(__doc__)
