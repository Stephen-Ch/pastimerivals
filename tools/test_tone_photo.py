"""Plan 54: tests for the photo pilot rules. python3 tools/test_tone_photo.py"""
import importlib.util, json, os, tempfile, csv
import numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('tp', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tone-photo-pilot.py'))
tp = importlib.util.module_from_spec(spec); spec.loader.exec_module(tp)

rng = np.random.default_rng(1)
gray = Image.fromarray(np.repeat(rng.integers(0, 255, (100, 100, 1), dtype=np.uint8), 3, 2))
sepia = Image.fromarray(np.stack([g * 1.0, g * 0.8, g * 0.6], 2).astype(np.uint8)) if (g := rng.integers(60, 255, (100, 100)).astype(float)) is not None else None
color = Image.fromarray(np.concatenate([np.full((50, 100, 3), (200, 40, 40), np.uint8), np.full((50, 100, 3), (40, 60, 200), np.uint8)]))
faded = Image.fromarray(np.concatenate([np.full((50, 100, 3), (190, 140, 120), np.uint8), np.full((50, 100, 3), (120, 150, 170), np.uint8)]))
assert tp.is_monochrome(gray), 'gray'
assert tp.is_monochrome(sepia), 'sepia'
assert not tp.is_monochrome(color), 'color'
assert not tp.is_monochrome(faded), 'faded colour print keeps two hues'
assert tp.is_monochrome(Image.fromarray(np.asarray(gray)).convert('CMYK').convert('RGB')), 'cmyk gray'

# agreement rule and control check
d = tempfile.mkdtemp(); tp.CACHE = d; tp.TONE = d; tp.CROPS = os.path.join(d, 'crops'); os.makedirs(tp.CROPS)
for pid in ('p1', 'p2', 'p3', 'p4', 'cL', 'cD'):
    Image.new('RGB', (240, 240), 'white').save(os.path.join(d, 'crops', f'{pid}.jpg'))
    json.dump({'ok': True, 'sha256': 'x' * 64, 'last_modified': 'v1'}, open(os.path.join(d, f'{pid}.json'), 'w'))
with open(os.path.join(d, 'photo-pilot.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['id', 'name', 'first_year', 'rank', 'photo', 'commons_url'])
    for p in ('p1', 'p2', 'p3', 'p4'): w.writerow([p, p.upper(), '2000', '1', f'{p}.jpg', 'u'])
json.dump({'controls': {'cL': 'light', 'cD': 'darkbrown'},
           'plan': {'A': [{'sheet': 'sheet-A01.png', 'cells': ['p1', 'cL', 'p2', 'p3', 'cD', 'p4']}],
                    'B': [{'sheet': 'sheet-B01.png', 'cells': ['cD', 'p4', 'p3', 'p2', 'p1', 'cL']}]}}, open(os.path.join(d, 'sheets.json'), 'w'))
Y = lambda t: {'one_person': 'yes', 'real_color_photo': 'yes', 'tone': t}
a = {'sheet-A01.png': {'1': Y('light'), '2': Y('light'), '3': Y('darkbrown'), '4': Y('light'), '5': Y('darkbrown'), '6': {'one_person': 'yes', 'real_color_photo': 'no', 'tone': 'light'}}}
b = {'sheet-B01.png': {'1': Y('darkbrown'), '2': Y('light'), '3': Y('unsure'), '4': Y('darkbrown'), '5': Y('light'), '6': Y('light')}}
json.dump(a, open(os.path.join(d, 'a.json'), 'w')); json.dump(b, open(os.path.join(d, 'b.json'), 'w'))
tp.decide(os.path.join(d, 'a.json'), os.path.join(d, 'b.json'))
got = {r['id']: r['tone'] for r in csv.DictReader(open(os.path.join(d, 'pending', 'tones-photo.csv')))}
assert got == {'p1': 'light', 'p2': 'darkbrown'}, got   # p3 unsure in B, p4 not a real colour photo in A
# a missed control throws out the sheet
b['sheet-B01.png']['1'] = Y('light'); json.dump(b, open(os.path.join(d, 'b.json'), 'w'))
tp.decide(os.path.join(d, 'a.json'), os.path.join(d, 'b.json'))
got = {r['id']: r['tone'] for r in csv.DictReader(open(os.path.join(d, 'pending', 'tones-photo.csv')))}
assert got == {}, got
print('tone-photo tests ok')
