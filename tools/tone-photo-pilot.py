"""Plan 54: skin-tone photo review pilot (500 most-drawn untoned players with a Wikimedia Commons photo).

  select   -> data/tone/photo-pilot.csv (fill-only: skips anyone with a tone in any source, research 'unknown', hand-check)
  fetch    -> data/tone/_photo-cache/<id>.jpg  (Special:FilePath width 500, 1 s apart, size cap, sha256 + version noted)
  prep     -> drops black-and-white/sepia (hue spread) and no-face photos; crops head and shoulders to 240 px squares
  controls -> known-tone control players (darkbrown from tones-wiki, light from batch files) fetched and cropped the same way
  sheets   -> two independent passes (A, B): own shuffle and grouping, 25 players + 4 controls per sheet, cells numbered only
  decide <answersA.json> <answersB.json> -> data/tone/pending/tones-photo.csv (both agree, both say real colour photo
             of one clear person, controls right) + spot-check sheet
Reviewers answer per cell: one_person yes/no, real_color_photo yes/no, tone light/darkbrown/unsure."""
import csv, glob, hashlib, io, json, os, random, sys, time, urllib.error, urllib.parse, urllib.request
import numpy as np
from PIL import Image, ImageCms, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TONE = os.path.join(ROOT, 'data', 'tone')
CACHE = os.path.join(TONE, '_photo-cache')
CROPS = os.path.join(CACHE, 'crops')
UA = {'User-Agent': 'PastimeRivals-tone-research/1.0 (schurchville@gmail.com)'}
N = 500
CELLS, CONTROLS = 25, 4
MAX_BYTES = 6_000_000
FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

def rcsv(name): return list(csv.DictReader(open(os.path.join(TONE, name), encoding='utf-8-sig'))) if os.path.exists(os.path.join(TONE, name)) else []

def known_ids():
    """Everyone with a tone from any source, plus research 'unknown' and the plan 53 hand-check list (fill-only)."""
    ids = set(json.load(open(os.path.join(ROOT, 'app', 'public', 'art-manifest.json')))['tones'])
    for f in glob.glob(os.path.join(TONE, 'batch*.csv')): ids |= {r['id'] for r in csv.DictReader(open(f, encoding='utf-8-sig'))}
    for n in ('tones-ngl.csv', 'tones-wiki.csv', 'tones-researched.csv', 'wiki-handcheck.csv'): ids |= {r['id'] for r in rcsv(n)}
    return ids

def ranks():
    best = {}
    for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'audio', 'name-priority.csv'), encoding='utf-8-sig')):
        best.setdefault(r['id'], int(r['rank']))
    return best

def commons(photo): return 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(photo.replace(' ', '_'))

def select():
    known, rk = known_ids(), ranks()
    rows = [r for r in rcsv('wiki-lookup.csv') if r['photo'] and r['id'] not in known and not r['skip']]
    rows.sort(key=lambda r: rk.get(r['id'], 10 ** 9))
    out = [{'id': r['id'], 'name': r['name'], 'first_year': r['first_year'], 'rank': rk.get(r['id'], ''), 'photo': r['photo'],
            'commons_url': commons(r['photo'])} for r in rows[:N]]
    with open(os.path.join(TONE, 'photo-pilot.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    print(f'selected {len(out)} of {len(rows)} untoned players with a photo')

def fetch_one(pid, photo):
    path = os.path.join(CACHE, f'{pid}.jpg'); meta = os.path.join(CACHE, f'{pid}.json')
    if os.path.exists(meta): return json.load(open(meta))
    os.makedirs(CACHE, exist_ok=True)
    url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + urllib.parse.quote(photo) + '?width=500'
    info = {'photo': photo, 'ok': False}
    resp = None
    for k in range(3):   # 429: wait and retry; a run that still gets 429 leaves no note, so the next run retries
        try: resp = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60); break
        except urllib.error.HTTPError as e:
            if e.code != 429: break
            time.sleep(20 * (k + 1))
    if resp is None:
        time.sleep(2); return {'photo': photo, 'ok': False, 'why': 'rate limited, retry later'}
    try:
        data = resp.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES: info['why'] = 'too big'
        else:
            im = Image.open(io.BytesIO(data)); im.load()
            if 'icc_profile' in im.info:   # convert to sRGB so colours are not shifted
                try: im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile'])), ImageCms.createProfile('sRGB'), outputMode='RGB')
                except Exception: pass
            im = im.convert('RGB'); im.save(path, 'JPEG', quality=92)
            info.update(ok=True, sha256=hashlib.sha256(data).hexdigest(), last_modified=resp.headers.get('Last-Modified', ''), final_url=resp.geturl())
    except Exception as e: info['why'] = f'download failed: {e}'[:200]
    json.dump(info, open(meta, 'w'))
    time.sleep(2.0)
    return info

def fetch(rows=None, budget=None):
    rows = rows or rcsv('photo-pilot.csv'); t0 = time.time(); n = 0
    for r in rows:
        if budget and time.time() - t0 > budget: break
        if not os.path.exists(os.path.join(CACHE, f"{r['id']}.json")): fetch_one(r['id'], r['photo']); n += 1
    done = sum(os.path.exists(os.path.join(CACHE, f"{r['id']}.json")) for r in rows)
    print(f'fetched {n} now; {done}/{len(rows)} done')

def is_monochrome(im):
    """Black-and-white or one-hue (sepia/tinted) photo: few saturated pixels, or saturated pixels all in one narrow hue band."""
    hsv = np.asarray(im.convert('HSV'), dtype=float)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    sat = (s > 40) & (v > 40) & (v < 245)
    if sat.mean() < 0.04: return True
    hues = h[sat] / 255 * 2 * np.pi
    spread = 1 - np.hypot(np.cos(hues).mean(), np.sin(hues).mean())   # circular spread: 0 = one hue
    return spread < 0.06

def face_crop(im, det):
    import mediapipe as mp
    a = np.ascontiguousarray(np.asarray(im))
    res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=a))
    if not res.detections: return None
    d = max(res.detections, key=lambda d: d.bounding_box.width * d.bounding_box.height)
    b = d.bounding_box
    if b.width < 28: return None                       # face too small to judge
    cx, cy, size = b.origin_x + b.width / 2, b.origin_y + b.height * 0.6, max(b.width, b.height) * 2.2
    box = (int(cx - size / 2), int(cy - size / 2), int(cx + size / 2), int(cy + size / 2))
    return im.crop(box).resize((240, 240), Image.LANCZOS), len(res.detections)

def detector():
    from mediapipe.tasks.python import vision, BaseOptions
    p = os.path.join(os.path.expanduser('~'), '.cache', 'pr-face', 'blaze_face_short_range.tflite')
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True); urllib.request.urlretrieve(FACE_MODEL_URL, p)
    return vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(base_options=BaseOptions(model_asset_path=p), min_detection_confidence=0.6))

def prep(rows=None, tag='pilot'):
    rows = rows or rcsv('photo-pilot.csv'); det = detector(); os.makedirs(CROPS, exist_ok=True)
    status = {}
    for r in rows:
        meta = json.load(open(os.path.join(CACHE, f"{r['id']}.json")))
        if not meta.get('ok'): status[r['id']] = meta.get('why', 'download failed'); continue
        im = Image.open(os.path.join(CACHE, f"{r['id']}.jpg")).convert('RGB')
        if is_monochrome(im): status[r['id']] = 'black-and-white or one-hue photo'; continue
        fc = face_crop(im, det)
        if not fc: status[r['id']] = 'no clear face found'; continue
        crop, faces = fc
        if faces > 1: status[r['id']] = 'several faces (could be someone else)'; continue
        crop.save(os.path.join(CROPS, f"{r['id']}.jpg"), 'JPEG', quality=92)
        status[r['id']] = 'ready' + (' (several faces)' if faces > 1 else '')
    json.dump(status, open(os.path.join(CACHE, f'prep-{tag}.json'), 'w'), indent=0)
    c = {}
    for v in status.values(): c[v] = c.get(v, 0) + 1
    print(tag, c)

def sheets(seed_a=541, seed_b=542):
    status = json.load(open(os.path.join(CACHE, 'prep-pilot.json')))
    ready = sorted(k for k, v in status.items() if v.startswith('ready'))
    cst = json.load(open(os.path.join(CACHE, 'prep-controls.json')))
    ctrl = {r['id']: r['tone'] for r in rcsv('photo-controls.csv') if cst.get(r['id'], '').startswith('ready')}
    light = sorted(k for k, v in ctrl.items() if v == 'light'); dark = sorted(k for k, v in ctrl.items() if v == 'darkbrown')
    plan = {}
    for name, seed in (('A', seed_a), ('B', seed_b)):
        rnd = random.Random(seed); ids = ready[:]; rnd.shuffle(ids)
        groups = [ids[i:i + CELLS] for i in range(0, len(ids), CELLS)]
        out = []
        for g, grp in enumerate(groups):
            cells = grp + rnd.sample(light, 2) + rnd.sample(dark, 2)
            rnd.shuffle(cells)
            path = os.path.join(CACHE, f'sheet-{name}{g + 1:02d}.png'); draw_sheet(cells, path)
            out.append({'sheet': os.path.basename(path), 'cells': cells})
        plan[name] = out
    json.dump({'plan': plan, 'controls': ctrl}, open(os.path.join(CACHE, 'sheets.json'), 'w'), indent=0)
    print({k: len(v) for k, v in plan.items()}, 'sheets per pass;', len(ready), 'players;', len(light), 'light and', len(dark), 'darkbrown controls')

def draw_sheet(cells, path, labels=None, cols=6):
    cw, ch = 240, 268; rows = (len(cells) + cols - 1) // cols
    sh = Image.new('RGB', (cols * cw + (cols + 1) * 6, rows * ch + (rows + 1) * 6), (255, 255, 255)); d = ImageDraw.Draw(sh)
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
    except Exception: f = None
    for i, pid in enumerate(cells):
        x, y = 6 + (i % cols) * (cw + 6), 6 + (i // cols) * (ch + 6)
        sh.paste(Image.open(os.path.join(CROPS, f'{pid}.jpg')), (x, y))
        d.text((x + 4, y + 242), labels[i] if labels else f'{i + 1}', fill=(0, 0, 0), font=f)
    sh.save(path)

def decide(fa, fb):
    """Answers: {"sheet-A01.png": {"1": {"one_person": "yes", "real_color_photo": "yes", "tone": "light"}, ...}, ...}"""
    meta = json.load(open(os.path.join(CACHE, 'sheets.json'))); ctrl = meta['controls']
    votes, bad_sheets = {}, []
    for name, f in (('A', fa), ('B', fb)):
        ans = json.load(open(f))
        for s in meta['plan'][name]:
            a = ans.get(s['sheet'], {})
            per = {pid: a.get(str(i + 1), {}) for i, pid in enumerate(s['cells'])}
            # a control given the opposite tone throws out the whole sheet ('unsure' on a control is caution, not an error)
            if any(per[c].get('tone') in ('light', 'darkbrown') and per[c].get('tone') != ctrl[c] for c in s['cells'] if c in ctrl):
                bad_sheets.append(s['sheet']); continue                 # a missed control throws out the whole sheet
            for pid, v in per.items():
                if pid in ctrl: continue
                ok = v.get('one_person') == 'yes' and v.get('real_color_photo') == 'yes' and v.get('tone') in ('light', 'darkbrown')
                votes.setdefault(pid, {})[name] = v.get('tone') if ok else None
    cstat = {'right': 0, 'wrong': 0, 'unsure': 0}
    for name, f in (('A', fa), ('B', fb)):
        ans = json.load(open(f))
        for s in meta['plan'][name]:
            for i, pid in enumerate(s['cells']):
                if pid in ctrl:
                    t = ans.get(s['sheet'], {}).get(str(i + 1), {}).get('tone')
                    cstat['right' if t == ctrl[pid] else 'unsure' if t not in ('light', 'darkbrown') else 'wrong'] += 1
    print('control answers:', cstat)
    rows = {r['id']: r for r in rcsv('photo-pilot.csv')}
    out = []
    for pid, v in votes.items():
        if v.get('A') and v.get('A') == v.get('B'):
            m = json.load(open(os.path.join(CACHE, f'{pid}.json'))); r = rows[pid]
            out.append({'id': pid, 'name': r['name'], 'tone': v['A'],
                        'evidence': f"Wikimedia Commons photo: {r['photo']} (version {m.get('last_modified', '')}, sha256 {m.get('sha256', '')[:16]}); two independent reviews agreed",
                        'source_url': r['commons_url']})
    os.makedirs(os.path.join(TONE, 'pending'), exist_ok=True)
    with open(os.path.join(TONE, 'pending', 'tones-photo.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['id', 'name', 'tone', 'evidence', 'source_url']); w.writeheader(); w.writerows(sorted(out, key=lambda x: x['id']))
    both = sum(1 for v in votes.values() if 'A' in v and 'B' in v)
    print(f'thrown-out sheets {bad_sheets}; players seen by both passes {both}; recorded {len(out)} '
          f"(light {sum(o['tone'] == 'light' for o in out)}, darkbrown {sum(o['tone'] == 'darkbrown' for o in out)})")
    # spot-check sheet: 40, at least half darkbrown
    rnd = random.Random(543)
    dk = [o for o in out if o['tone'] == 'darkbrown']; lt = [o for o in out if o['tone'] == 'light']
    pick = rnd.sample(dk, min(20, len(dk))); pick += rnd.sample(lt, min(40 - len(pick), len(lt)))
    rnd.shuffle(pick)
    draw_sheet([p['id'] for p in pick], os.path.join(CACHE, 'spot-check.png'), labels=[f"{i + 1}. {p['name'][:16]} - {p['tone']}" for i, p in enumerate(pick)], cols=8)
    print('spot-check sheet:', os.path.join(CACHE, 'spot-check.png'))

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'select': select()
    elif cmd == 'fetch': fetch(budget=float(sys.argv[2]) if len(sys.argv) > 2 else None)
    elif cmd == 'prep': prep()
    elif cmd == 'controls':
        rows = rcsv('photo-controls.csv'); fetch(rows); prep(rows, 'controls')
    elif cmd == 'sheets': sheets()
    elif cmd == 'decide': decide(sys.argv[2], sys.argv[3])
    else: print(__doc__)
