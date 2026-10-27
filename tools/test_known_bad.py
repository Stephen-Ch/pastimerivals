"""Plan 52: fail if the broken-bat card can reach a build. Usage: python3 tools/test_known_bad.py [--selftest]
Scans art/sprites, app/public, src/PastimeRivals.Api/wwwroot and any publish/* folder (git-ignored, laptop only)."""
import glob, io, os, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import known_bad as kb

def selftest():
    from PIL import Image
    tmp = tempfile.mkdtemp()
    try:
        bad = Image.open(kb.FIXTURE).convert('RGB')
        shutil.copy(kb.FIXTURE, os.path.join(tmp, 'planted.webp'))
        for q in (40, 60, 90): bad.save(os.path.join(tmp, f'q{q}.webp'), 'WEBP', quality=q)
        probs, _ = kb.scan([tmp])
        assert len(probs) == 4, probs
        good = [os.path.join(kb.ROOT, kb.ALLOW_SOURCE[0])] + glob.glob(os.path.join(kb.ROOT, 'art/sprites/matchup/*/*.webp'))
        hits = [p for p in good if kb.pixel_hit(p)]
        assert not hits, hits
        try: kb.check_source(kb.FIXTURE); raise AssertionError('fixture not refused')
        except SystemExit: pass
        print(f'selftest ok: 4 bad copies caught, {len(good)} good cards clear')
    finally: shutil.rmtree(tmp)

if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest()
    tops = [os.path.join(kb.ROOT, p) for p in ('art/sprites', 'app/public', 'src/PastimeRivals.Api/wwwroot')]
    tops += [p for p in glob.glob(os.path.join(kb.ROOT, 'publish', '*')) if os.path.isdir(p)]
    probs, skipped = kb.scan([t for t in tops if os.path.isdir(t)])
    for p in probs: print('FAIL', p)
    if skipped: print(f'pixel check skipped on {skipped} images (no Pillow/numpy): sha and name checks only')
    if probs: sys.exit(1)
    print('known-bad scan ok')
