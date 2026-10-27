"""Plan 52: keep the broken-bat card (bat bends behind the head) away from players for good.
Standard library for the sha256 and string checks; the pixel check needs Pillow + numpy and says
"skipped" (never "passed") without them. Used by export-app-art.py, split-matchups.py and test_known_bad.py."""
import hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, 'tools', 'fixtures', 'known-bad-1901-light-a.webp')
DENY_SHA = {
    'c6021879d98f2d4b622cf8b0d5afcd23fa0d5b9ab1ab7717ceb7e7216d1280ab',   # broken source art/sprites/matchup/batter/1901-light-a.webp (before plan 52)
    '90775c068d2d78504cedf465143ff26ce281b1970bd81ddfae903bf019fce689',   # card-batter-1901-light-a-90775c068d.webp (fixture)
}
ALLOW_SOURCE = ('art/sprites/matchup/batter/1901-light-a.webp',
                '9550abb9b1c702a035aaf13ca9adb29235bb5883d002c5b55d081d7a4fdc5185')   # fixed bat, approved Oct 26-27 2026
BAD_NAME = '90775c068d'
TEXT_FILES = re.compile(r'(^|/)(art-manifest\.json|index\.html|main-[A-Z0-9]+\.js)$')   # sw.js names the URL on purpose
BOX = (290, 72, 435, 207)   # x0, y0, x1, y1: the bat area, the only place the bad and fixed cards differ
BOX_LIMIT = 10.0            # mean difference below this = the bad card (re-encodes 1.2-4.8; fixed 27.7; other cards 38+)

def sha_file(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()

_ref = None
def _pixels():
    global _ref
    try:
        from PIL import Image; import numpy as np
    except ImportError:
        return None
    if _ref is None:
        _ref = np.asarray(Image.open(FIXTURE).convert('RGB'), dtype=float)
    return Image, np, _ref

def pixel_hit(img_or_path):
    """True = looks like the bad card, False = clear, None = skipped (no Pillow, or not a 480x720 card)."""
    pk = _pixels()
    if pk is None: return None
    Image, np, ref = pk
    im = Image.open(img_or_path) if isinstance(img_or_path, str) else img_or_path
    if im.size != (480, 720): return None
    a = np.asarray(im.convert('RGB'), dtype=float)
    x0, y0, x1, y1 = BOX
    return float(np.abs(a[y0:y1, x0:x1] - ref[y0:y1, x0:x1]).mean()) < BOX_LIMIT

def check_source(path):
    """Raise if a card source is the bad card or the 1901 batter light-a file is not the approved fixed one."""
    rel = os.path.relpath(os.path.abspath(path), ROOT).replace(os.sep, '/')
    s = sha_file(path)
    if s in DENY_SHA: raise SystemExit(f'BLOCKED known-bad file: {rel}')
    if rel == ALLOW_SOURCE[0] and s != ALLOW_SOURCE[1]: raise SystemExit(f'BLOCKED {rel} is not the approved fixed-bat source')
    if pixel_hit(path): raise SystemExit(f'BLOCKED looks like the broken-bat card: {rel}')

def check_image(img, label):
    """Raise if an image about to be written looks like the bad card."""
    if pixel_hit(img): raise SystemExit(f'BLOCKED output looks like the broken-bat card: {label}')

def scan(paths):
    """Return (problems, skipped_pixel_checks) for every file under the given folders."""
    problems, skipped = [], 0
    skip_dir = os.path.join(ROOT, 'tools', 'fixtures')
    for top in paths:
        for d, _, files in os.walk(top):
            if os.path.abspath(d).startswith(skip_dir) or '_to_delete' in d.split(os.sep): continue
            for f in files:
                p = os.path.join(d, f); rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
                if BAD_NAME in f: problems.append(f'bad file name: {rel}')
                if f.endswith(('.webp', '.png', '.jpg')):
                    if sha_file(p) in DENY_SHA: problems.append(f'known-bad file: {rel}'); continue
                    if rel == ALLOW_SOURCE[0] and sha_file(p) != ALLOW_SOURCE[1]: problems.append(f'not the approved source: {rel}')
                    try: hit = pixel_hit(p)
                    except Exception: hit = None
                    if hit: problems.append(f'looks like the broken-bat card: {rel}')
                    elif hit is None and _pixels() is None: skipped += 1
                elif TEXT_FILES.search(rel) and BAD_NAME in open(p, encoding='utf-8', errors='ignore').read():
                    problems.append(f'references {BAD_NAME}: {rel}')
    return problems, skipped
