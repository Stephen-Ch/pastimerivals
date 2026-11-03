"""Plan 59 Round 4 tool tests: CIEDE2000 reference pairs, and planted faults that each check must catch.
Run from the repo root: python3 -m pytest tools/test_recolor_uniforms.py (needs the cached masks and out/ PNGs)."""
import importlib.util, os
import numpy as np
from PIL import Image
from skimage.color import deltaE_ciede2000

spec = importlib.util.spec_from_file_location('ru', os.path.join(os.path.dirname(__file__), 'recolor-uniforms.py'))
ru = importlib.util.module_from_spec(spec); spec.loader.exec_module(ru)
NAMES = [n for n in ru.REGIONS if os.path.exists(f'{ru.ROOT}/out/{n}.png')]


def test_ciede2000_sharma_pairs():
    # Sharma, Wu, Dalal (2005), pairs 1, 17, 25
    pairs = [((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425),
             ((50, 2.5, 0), (73, 25, -18), 27.1492),
             ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644)]
    for a, b, want in pairs:
        assert abs(deltaE_ciede2000(np.array([a], float), np.array([b], float))[0] - want) < 1e-3


def out_of(name):
    return np.asarray(Image.open(f'{ru.ROOT}/out/{name}.png').convert('RGBA')).copy()


def test_built_images_pass():
    assert NAMES, 'no built images'
    for n in NAMES:
        r = ru.check(n)
        assert r['ok'], r


def test_rebuild_is_byte_identical():
    for n in NAMES:
        before = out_of(n); after = ru.recolor(n)
        assert np.array_equal(before, after), n


def test_planted_alpha_change_fails():
    n = NAMES[0]; o = out_of(n); o[o[..., 3] > 0, 3] -= 1
    assert any('alpha' in f for f in ru.check(n, out=o)['fails'])


def test_planted_change_outside_regions_fails():
    n = NAMES[0]; a, _, _ = ru.load(ru.REGIONS[n]); parts, _, _, _ = ru.regions(n, a)
    region = np.zeros(a.shape[:2], bool)
    for m in parts.values(): region |= m
    o = out_of(n); ys, xs = np.nonzero((a[..., 3] > 0) & ~region); o[ys[:20], xs[:20], 0] ^= 0x40
    assert any('outside regions' in f for f in ru.check(n, out=o)['fails'])


def test_planted_skin_in_region_fails():
    for n in NAMES:
        if ru.REGIONS[n].get('paper_skin'): continue
        a, _, _ = ru.load(ru.REGIONS[n]); parts, skin, _, _ = ru.regions(n, a)
        assert skin.sum() > 200, f'{n}: skin check mask too small'
        body = next(p['name'] for p in ru.REGIONS[n]['parts'] if p['to'] in ('body',))
        r = ru.check(n, parts_override={body: parts[body] | skin})
        assert any('skin-like' in f for f in r['fails']), (n, r)


def test_planted_missed_sleeve_fails():
    """Drop the body region of frame 0 (as if a mask missed it) and leave those pixels in the source colour."""
    for n in NAMES:
        cfg = ru.REGIONS[n]; a, cw, _ = ru.load(cfg); parts, _, _, _ = ru.regions(n, a)
        body = next(p['name'] for p in cfg['parts'] if p['to'] == 'body')
        miss = parts[body].copy(); miss[:, cw:] = False
        o = out_of(n); o[miss] = a[miss]
        r = ru.check(n, out=o, parts_override={body: parts[body] & ~miss})
        # leftover catches it when the colour change is visible (dE >= 10); the area check catches it on sheets either way
        assert any('leftover' in f or 'area off' in f for f in r['fails']), (n, r)


def test_manifest_has_every_played_side_key():
    """Plan 59 Round 4 test 6: the 12 look/era/tone keys exist, each with the base look's frames."""
    import json
    m = json.load(open('app/public/art-manifest.json'))['side']
    for le in ('1901/1901', '1920/1920', '1920/1946', '1956/1946', '1956/1970', '1990/1990'):
        for t in ('light', 'darkbrown'):
            k = f'{le}/{t}'; look = le.split('/')[0]
            assert m['sheets'].get(k), k
            assert m['frames'][k] == m['frames'][f'{look}/{t}'], k


CHANGED_URLS = {   # plan 59 Round 4: the only existing manifest keys whose file changes
    ('cards', 'batter/1901-1919/light/b'), ('cards', 'batter/1901-1919/line/b'), ('cards', 'batter/1990-2025/darkbrown/a'),
    ('cards', 'batter/1990-2025/darkbrown/b'), ('cards', 'pitcher/1990-2025/darkbrown/b'), ('sheets', 'pitcher/1990-2025/darkbrown')}


def _head_manifest():
    import json, subprocess
    return json.loads(subprocess.run(['git', 'show', 'HEAD:app/public/art-manifest.json'], capture_output=True, check=True, text=True).stdout)


def test_manifest_keys_only_grow_and_only_listed_urls_change():
    import json
    old, new = _head_manifest(), json.load(open('app/public/art-manifest.json'))
    assert old['tones'] == new['tones'] and old['fielder'] == new['fielder'] and old['cell'] == new['cell']
    for sec in ('cards', 'sheets'):
        for k, v in old[sec].items():
            assert k in new[sec], k
            assert (new[sec][k] != v) == ((sec, k) in CHANGED_URLS), (sec, k)
    for k, v in old['side']['sheets'].items():
        assert new['side']['sheets'][k] == v and new['side']['frames'][k] == old['side']['frames'][k], k


def test_play_screen_bytes_at_most_1_2x():
    """A batter now loads his era copy instead of the base look: each copy at most 1.2x the base file it replaces."""
    import json, os
    m = json.load(open('app/public/art-manifest.json'))['side']['sheets']
    size = lambda u: os.path.getsize('app/public' + u)
    for k, u in m.items():
        if k.count('/') == 2:
            look, _, t = k.split('/')
            assert size(u) <= 1.2 * size(m[f'{look}/{t}']), (k, size(u), size(m[f'{look}/{t}']))
