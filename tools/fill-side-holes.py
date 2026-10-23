"""Plan 40 C v3 (2026-10-23): paint paper color into see-through gaps enclosed by a side-on batter's figure
(white uniforms and pen-and-ink sheets were keyed out to transparent).
Per 520 px frame: figure f = alpha > 32. Gaps enclosed by f itself are filled. Gaps that only close up after a
2 px closing (outline breaks) are filled only when each piece is under MAX_EXTRA px; bigger pieces are listed and
left alone unless their frame/box is in ALLOW. Paper color #fbfaf7 goes UNDER the original art, grown 1 px into the
anti-aliased rim, never outside the original figure's filled shape. Gaps that touch the cell edge count as outside.
Usage from repo root: python3 tools/fill-side-holes.py art/sprites/batter-side <outdir> [sheet names...]"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
PAPER = (0xfb, 0xfa, 0xf7)
CELL, FRAMES, MAX_EXTRA = 520, 8, 300
ALLOW = {}   # 'sheet': [(frame, x0, y0, x1, y1)], hand-checked large extra pieces
def fill(name, img):
    a = np.array(img.convert('RGBA'))
    assert a.shape[1] == CELL * FRAMES, f'{name}: width {a.shape[1]}'
    paper = np.zeros_like(a); paper[..., :3] = PAPER
    holes_n = painted_n = 0; report = []
    for i in range(FRAMES):
        sl = np.s_[:, i * CELL:(i + 1) * CELL]
        f = a[sl][..., 3] > 32
        h0 = ndimage.binary_fill_holes(f) & ~f
        h1 = ndimage.binary_fill_holes(ndimage.binary_closing(f, iterations=2)) & ~f & ~h0
        lab, n = ndimage.label(h1)
        keep = np.zeros_like(h1)
        for k, s in enumerate(ndimage.find_objects(lab), 1):
            piece = lab == k; size = int(piece.sum())
            box = (s[1].start, s[0].start, s[1].stop, s[0].stop)
            ok = size < MAX_EXTRA or any(fr == i and box[0] >= x0 and box[1] >= y0 and box[2] <= x1 and box[3] <= y1 for fr, x0, y0, x1, y1 in ALLOW.get(name, []))
            if ok: keep |= piece
            else: report.append((i, size, box))
        holes = h0 | keep
        shape = ndimage.binary_fill_holes(f | holes)
        grown = (ndimage.binary_dilation(holes) & ndimage.binary_erosion(shape)) | holes
        paper[sl][..., 3][grown] = 255
        holes_n += int(holes.sum()); painted_n += int(grown.sum())
    out = Image.alpha_composite(Image.fromarray(paper), Image.fromarray(a))
    return out, holes_n, painted_n, report
def main(src, out, names):
    os.makedirs(out, exist_ok=True)
    for n in names:
        im, h, p, rep = fill(n, Image.open(os.path.join(src, n + '.png')))
        im.save(os.path.join(out, n + '.png'), optimize=True)
        print(n, 'holes', h, 'painted', p, 'left alone (frame, px, box):', rep)
if __name__ == '__main__':
    names = sys.argv[3:] or [f'{l}-{t}' for l in ('1901', '1920', '1956', '1990') for t in ('light', 'darkbrown', 'line')]
    main(sys.argv[1], sys.argv[2], names)
