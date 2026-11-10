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
    # 7a2f626 = plan59-r3-juice, the branch this round starts from (HEAD would compare the manifest with itself)
    return json.loads(subprocess.run(['git', 'show', '7a2f626:app/public/art-manifest.json'], capture_output=True, check=True, text=True).stdout)


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


def test_play_screen_bytes_worst_case_at_most_1_2x():
    """Per at-bat images: pitcher card + batter card + windup + side sheet, every era/tone/variant, new vs the branch base."""
    import json, os
    old, new = _head_manifest(), json.load(open('app/public/art-manifest.json'))
    size = lambda u: os.path.getsize('app/public' + u)
    looks = {'1901-1919': ['1901'], '1920-1945': ['1920'], '1946-1969': ['1920', '1956'], '1970-1989': ['1956'], '1990-2025': ['1990']}
    worst = 0.0
    for era, lks in looks.items():
        for t in ('light', 'darkbrown', 'line'):
            for v in ('a', 'b'):
                for lk in lks:
                    side_t = 'line' if t == 'line' else t
                    o = size(old['cards'][f'pitcher/{era}/{t}/{v}']) + size(old['cards'][f'batter/{era}/{t}/{v}']) + size(old['side']['sheets'][f'{lk}/{side_t}'])
                    nk = f'{lk}/{era[:4]}/{t}' if t != 'line' else f'{lk}/line'
                    n = size(new['cards'][f'pitcher/{era}/{t}/{v}']) + size(new['cards'][f'batter/{era}/{t}/{v}']) + size(new['side']['sheets'][nk])
                    if t != 'line':
                        o += size(old['sheets'][f'pitcher/{era}/{t}']); n += size(new['sheets'][f'pitcher/{era}/{t}'])
                    worst = max(worst, n / o)
    assert worst <= 1.2, worst


def test_planted_shrunk_card_mask_fails(monkeypatch):
    """Shrink a card's SAM jersey mask before regions() runs (as if SAM missed a patch): the leftover check must fail."""
    for n in [k for k in NAMES if k.startswith('card-')]:
        cfg = ru.REGIONS[n]; body = next(p for p in cfg['parts'] if p['to'] == 'body' and 'sam' in p)
        a, _, _ = ru.load(cfg); parts, _, _, _ = ru.regions(n, a)
        ys, xs = np.nonzero(parts[body['name']]); y, x = int(np.median(ys)), int(np.median(xs))
        real = ru.sam_masks
        def shrunk(name, real=real, key=body['sam'], y=y, x=x):
            m = real(name); m = dict(m); k = m[key].copy(); k[y - 40:y + 40, x - 40:x + 40] = False; m[key] = k; return m
        monkeypatch.setattr(ru, 'sam_masks', shrunk)
        hole = parts[body['name']] & ~ru.regions(n, a)[0][body['name']]
        o = out_of(n); o[hole] = a[hole]
        r = ru.check(n, out=o)
        monkeypatch.setattr(ru, 'sam_masks', real)
        assert hole.sum() > 300 and any('leftover' in f for f in r['fails']), (n, int(hole.sum()), r['fails'])


def test_cf_play_screen_bytes_at_most_1_2x():
    """Plan 59 Round 5 test 9: with the CF shot an at-bat loads cards + back sheet + front strip + catcher/umpire + side
    instead of cards + front windup + side: at most 1.2x, for every era/tone/variant that has CF art."""
    import json, os
    m = json.load(open('app/public/art-manifest.json')); cf = m.get('cf') or {}
    size = lambda u: os.path.getsize('app/public' + u)
    looks = {'1901-1919': ['1901'], '1920-1945': ['1920'], '1946-1969': ['1920', '1956'], '1970-1989': ['1956'], '1990-2025': ['1990']}
    worst, n = 0.0, 0
    for era, lks in looks.items():
        for t in ('light', 'darkbrown'):
            back = cf.get('back', {}).get(f'{era}/{t}')
            if not back: continue
            for bt in ('light', 'darkbrown', 'line'):
                for lk in lks:
                    fk = f'{lk}/line' if bt == 'line' else f'{lk}/{era[:4]}/{bt}'
                    front = cf.get('front', {}).get(fk)
                    if not front: continue
                    sk = f'{lk}/line' if bt == 'line' else f'{lk}/{era[:4]}/{bt}'
                    for v in ('a', 'b'):
                        base = size(m['cards'][f'pitcher/{era}/{t}/{v}']) + size(m['cards'][f'batter/{era}/{bt}/{v}']) + size(m['side']['sheets'][sk])
                        o = base + size(m['sheets'][f'pitcher/{era}/{t}'])
                        nn = base + size(back) + size(front) + (size(cf['cu'][era]) if era in cf.get('cu', {}) else 0)
                        worst = max(worst, nn / o); n += 1
    assert n > 0
    assert worst <= 1.2, worst
