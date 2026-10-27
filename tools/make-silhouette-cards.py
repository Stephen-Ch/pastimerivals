"""Plan 52 Part 2: blank-paper silhouette cards for players with no researched skin tone.

Two steps:
  masks  (cloud only: needs mediapipe 0.10.32 + opencv) builds one skin mask per light card into
         art/sprites/matchup/masks/<role>-<short>-<a|b>.png and records each source's sha256 in
         masks/masks.json. Masks marked "hand": true there are never overwritten (use --force).
  build  (Pillow + numpy only) fills each mask with cream paper and an ink outline and writes
         art/sprites/matchup/<role>/<short>-line-<a|b>.webp, plus a contact sheet.
Usage: python3 tools/make-silhouette-cards.py masks [--force] | build [--sheet PATH]
Run from the repo root."""
import hashlib, json, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import known_bad

ROOT = known_bad.ROOT
SRC = os.path.join(ROOT, 'art', 'sprites', 'matchup')
MASKS = os.path.join(SRC, 'masks')
META = os.path.join(MASKS, 'masks.json')
ROLES = ('batter', 'pitcher')
SHORTS = ('1901', '1920', '1946', '1970', '1990')
PAPER = (244, 236, 220)    # D1: cream paper
INK = (40, 34, 30)         # D1: ink outline
OUTLINE = 4                # px
MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/image_segmenter/'
             'selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite')
MODEL_SHA = 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0'
MEDIAPIPE = '0.10.32'

def cards():
    return [(r, s, v) for r in ROLES for s in SHORTS for v in 'ab']

def src_path(r, s, v): return os.path.join(SRC, r, f'{s}-light-{v}.webp')
def mask_path(r, s, v): return os.path.join(MASKS, f'{r}-{s}-{v}.png')
def out_path(r, s, v): return os.path.join(SRC, r, f'{s}-line-{v}.webp')

def load_meta():
    return json.load(open(META)) if os.path.exists(META) else {}

# ---------------- masks (cloud) ----------------
def _segmenter():
    import mediapipe as mp
    if mp.__version__ != MEDIAPIPE: raise SystemExit(f'need mediapipe {MEDIAPIPE}, have {mp.__version__}')
    from mediapipe.tasks.python import vision, BaseOptions
    cache = os.path.join(os.path.expanduser('~'), '.cache', 'pr-seg', 'selfie_multiclass_256x256.tflite')
    if not os.path.exists(cache):
        os.makedirs(os.path.dirname(cache), exist_ok=True); urllib.request.urlretrieve(MODEL_URL, cache)
    if known_bad.sha_file(cache) != MODEL_SHA: raise SystemExit('segmenter model sha256 mismatch')
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=cache), output_confidence_masks=True))
    def run(a):
        res = seg.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(a)))
        return np.stack([c.numpy_view().squeeze() for c in res.confidence_masks], -1)
    return run

def _probs(run, a):
    """Segmenter class probabilities, averaged over a padded full card and overlapping 360/480 crops."""
    H, W, _ = a.shape
    acc = np.zeros((H, W, 6)); n = np.zeros((H, W, 1))
    pad = np.full((H, H, 3), 255, np.uint8); x0 = (H - W) // 2; pad[:, x0:x0 + W] = a
    acc += run(pad)[:, x0:x0 + W]; n += 1
    for s in (360, 480):
        step = (H - s) // max(1, (H - s) // 120)
        for y in range(0, H - s + 1, step):
            for x in sorted({0, (W - s) // 2, W - s}):
                acc[y:y + s, x:x + s] += run(a[y:y + s, x:x + s]); n[y:y + s, x:x + s] += 1
    return acc / n

def _mask(a, p):
    import cv2
    K = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    H, W, _ = a.shape
    sk = p[..., 2] + p[..., 3]                      # body skin + face skin
    L = cv2.cvtColor(a, cv2.COLOR_RGB2LAB).astype(np.float32)
    seed = sk > 0.85
    if seed.sum() < 3000: seed = sk > np.quantile(sk, 0.99)
    X = L[seed]; mu = X.mean(0); Ci = np.linalg.inv(np.cov(X.T) + np.diag([30, 3, 3]))
    d = L - mu; md = np.sqrt(np.einsum('...i,ij,...j->...', d, Ci, d))   # distance from this card's skin colour
    col = cv2.morphologyEx((md < 3.2).astype(np.uint8), cv2.MORPH_OPEN, K(3))
    n, lb, st, _ = cv2.connectedComponentsWithStats(col, 8)
    cm = np.zeros((H, W), np.uint8)
    for i in range(1, n):
        x, y, w, h, ar = st[i]
        if ar < 150: continue
        comp = lb == i
        if ((x == 0) + (y == 0) + (x + w == W) + (y + h == H)) and ar > 20000: continue   # background
        if sk[comp].mean() > 0.25 or (sk[comp] > 0.6).mean() > 0.2: cm[comp] = 1
    pb = cv2.GaussianBlur(p.astype(np.float32), (0, 0), 3)
    g = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY).astype(np.float32)
    tex = np.sqrt(np.maximum(cv2.blur(g * g, (9, 9)) - cv2.blur(g, (9, 9)) ** 2, 0))
    Lm = np.median(L[seed][:, 0])
    gate = (pb[..., 0] < 0.5) & ((pb[..., 4] < 0.35) | ((md < 3.5) & (tex < 16) & (L[..., 0] > Lm - 40)))
    m = (((sk > 0.5) & (md < 7)) | ((cm > 0) & gate) | (sk > 0.92)).astype(np.uint8)
    m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_OPEN, K(5)), cv2.MORPH_CLOSE, K(11))
    n, lb, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, 4] >= 400: keep[lb == i] = 1
    n, lb, st, _ = cv2.connectedComponentsWithStats((1 - keep).astype(np.uint8), 4)
    for i in range(1, n):                            # fill holes: eyes, mustaches
        x, y, w, h, ar = st[i]
        if ar < 2500 and x > 0 and y > 0 and x + w < W and y + h < H: keep[lb == i] = 1
    return keep

def make_masks(force):
    os.makedirs(MASKS, exist_ok=True)
    meta = load_meta(); run = _segmenter()
    for r, s, v in cards():
        key = f'{r}-{s}-{v}'; src = src_path(r, s, v)
        known_bad.check_source(src)
        if meta.get(key, {}).get('hand') and not force:
            print('kept hand mask', key); continue
        a = np.asarray(Image.open(src).convert('RGB'))
        m = _mask(a, _probs(run, a))
        Image.fromarray((m * 255).astype(np.uint8)).save(mask_path(r, s, v), optimize=True)
        meta[key] = {'source_sha256': known_bad.sha_file(src), 'hand': False}
        print('mask', key, int(m.sum()))
    json.dump(meta, open(META, 'w'), indent=1, sort_keys=True)

# ---------------- build (Pillow + numpy) ----------------
def silhouette(card, mask):
    """Cream paper inside the mask, a 4 px ink line on its edge; everything else untouched."""
    m = mask.convert('L').point(lambda x: 255 if x >= 128 else 0)
    soft = np.asarray(m.filter(ImageFilter.GaussianBlur(1.2)), dtype=float)[..., None] / 255
    a = np.asarray(card.convert('RGB'), dtype=float)
    o = a * (1 - soft) + np.array(PAPER) * soft
    edge = np.asarray(m.filter(ImageFilter.MaxFilter(OUTLINE - 1 | 1)), dtype=int) - np.asarray(m.filter(ImageFilter.MinFilter(OUTLINE - 1 | 1)), dtype=int)
    o[edge > 0] = INK
    return Image.fromarray(np.clip(o, 0, 255).astype(np.uint8))

def build(sheet_path):
    meta = load_meta(); thumbs = []; errors = []
    for r, s, v in cards():
        key = f'{r}-{s}-{v}'; src = src_path(r, s, v); mp_ = mask_path(r, s, v)
        known_bad.check_source(src)
        if key not in meta or not os.path.exists(mp_): errors.append(f'no mask {key}'); continue
        if meta[key]['source_sha256'] != known_bad.sha_file(src): errors.append(f'mask {key} was made from a different source'); continue
        out = silhouette(Image.open(src), Image.open(mp_))
        known_bad.check_image(out, key)
        out.save(out_path(r, s, v), 'WEBP', quality=90, method=6)
        thumbs.append((key + (' (hand)' if meta[key].get('hand') else ''), out))
    if errors: print('ERRORS', errors); sys.exit(1)
    if sheet_path:
        tw, th = 240, 360; small = 96
        sheet = Image.new('RGB', (10 * tw, 2 * (th + small + 24)), 'white'); d = ImageDraw.Draw(sheet)
        for i, (k, im) in enumerate(thumbs):
            x, y = (i % 10) * tw, (i // 10) * (th + small + 24)
            sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 16)); d.text((x + 4, y + 2), k, fill='black')
            sheet.paste(im.resize((small * 2 // 3, small), Image.LANCZOS), (x + 4, y + 20 + th))   # tile size
        sheet.save(sheet_path); print('sheet', sheet_path)
    print(f'built {len(thumbs)} line cards')

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'masks': make_masks('--force' in sys.argv)
    elif cmd == 'build': build(sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None)
    else: print(__doc__); sys.exit(2)
