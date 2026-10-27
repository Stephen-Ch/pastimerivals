"""Plan 18 v2: export sprite sheets, matchup cards and the tone list for the app.
Writes app/public/art/<hashed files> and app/public/art-manifest.json. Run from the repo root."""
import csv, glob, hashlib, io, json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import known_bad   # plan 52: refuse the broken-bat card

OUT = 'app/public/art'
ERAS = {'1901': '1901-1919', '1920': '1920-1945', '1946': '1946-1969', '1970': '1970-1989', '1990': '1990-2025'}
SHEET_TONES = ('light', 'darkbrown')
CARD_TONES = SHEET_TONES + ('line',)   # plan 52
SHORT_OF = {era: short for short, era in ERAS.items()}
CELL_W, CELL_H, PADX = 360, 480, 2

def save_hashed(img, stem, quality):
    buf = io.BytesIO(); img.save(buf, 'WEBP', quality=quality, method=6)
    data = buf.getvalue(); h = hashlib.sha256(data).hexdigest()[:10]
    name = f'{stem}-{h}.webp'
    with open(os.path.join(OUT, name), 'wb') as f: f.write(data)
    return f'/art/{name}', len(data)

def tones():
    t = {}
    for f in sorted(glob.glob('data/tone/batch*.csv')):
        for r in csv.DictReader(open(f, encoding='utf-8-sig')):
            if r['category'] == 'White': t[r['id']] = 'light'
            elif r['category'] == 'African American': t[r['id']] = 'darkbrown'
    # Plan 52D: Negro Leagues 1933-1948 players, toned by league membership (segregated leagues); research below overrides
    for r in csv.DictReader(open('data/tone/tones-ngl.csv', encoding='utf-8-sig')):
        if r['tone'] not in ('light', 'olive', 'mediumbrown', 'darkbrown'): raise SystemExit(f"bad tone in tones-ngl.csv: {r}")
        t[r['id']] = r['tone']
    # Plan 53: Wikipedia category "African-American baseball players" (tools/tone-wiki-lookup.py); research below overrides
    if os.path.exists('data/tone/tones-wiki.csv'):
        for r in csv.DictReader(open('data/tone/tones-wiki.csv', encoding='utf-8-sig')):
            if r['tone'] != 'darkbrown': raise SystemExit(f"bad tone in tones-wiki.csv: {r}")
            t[r['id']] = r['tone']
    # Plan 54: Commons photo, two reviews agreed, Stephen's spot check (light or darkbrown only). Fill-only: never replaces a tone
    if os.path.exists('data/tone/tones-photo.csv'):
        for r in csv.DictReader(open('data/tone/tones-photo.csv', encoding='utf-8-sig')):
            if r['tone'] not in ('light', 'darkbrown'): raise SystemExit(f"bad tone in tones-photo.csv: {r}")
            t.setdefault(r['id'], r['tone'])
    for r in csv.DictReader(open('data/tone/tones-researched.csv', encoding='utf-8-sig')):
        t.pop(r['id'], None)
        if r['tone'] in ('light', 'olive', 'mediumbrown', 'darkbrown'): t[r['id']] = r['tone']
    return t

def export_card(role, short, tone, v):
    c = f'art/sprites/matchup/{role}/{short}-{tone}-{v}.webp'
    if not os.path.exists(c): raise FileNotFoundError(f'missing {c}')
    known_bad.check_source(c)
    card = Image.open(c).convert('RGB'); known_bad.check_image(card, c)
    return save_hashed(card, f'card-{role}-{short}-{tone}-{v}', 82)

def cards_only(keys):
    """Plan 52: save only the named cards (manifest keys like batter/1901-1919/line/a) and patch only those keys.
    No deletes; tones, sheets, side and fielder entries are left exactly as they are."""
    path = 'app/public/art-manifest.json'
    man = json.load(open(path))
    for k in keys:
        try: role, era, tone, v = k.split('/')
        except ValueError: raise SystemExit(f'bad key {k} (want role/era/tone/a|b)')
        if role not in ('pitcher', 'batter') or era not in SHORT_OF or tone not in CARD_TONES or v not in ('a', 'b'):
            raise SystemExit(f'bad key {k}')
        url, n = export_card(role, SHORT_OF[era], tone, v)
        old = man['cards'].get(k)
        man['cards'][k] = url
        print(f'{k} -> {url} ({n} bytes)' + (f' (was {old})' if old and old != url else ''))
    json.dump(man, open(path, 'w'), separators=(',', ':'))

def tones_only(allow_changes):
    """Plan 52D: recompute the tone list and patch only manifest['tones']. Refuses removals or changes unless allowed."""
    path = 'app/public/art-manifest.json'
    man = json.load(open(path)); old = man['tones']; new = tones()
    added = [k for k in new if k not in old]
    removed = [k for k in old if k not in new]
    changed = [k for k in new if k in old and new[k] != old[k]]
    print(f'tones: {len(old)} -> {len(new)}; added {len(added)}, removed {len(removed)}, changed {len(changed)}')
    if (removed or changed) and not allow_changes: raise SystemExit(f'refused: removed {removed[:10]} changed {changed[:10]} (use --allow-changes)')
    man['tones'] = new
    json.dump(man, open(path, 'w'), separators=(',', ':'))

def main():
    os.makedirs(OUT, exist_ok=True)
    for old in glob.glob(os.path.join(OUT, '*.webp')): os.remove(old)
    man = {'cell': [CELL_W + 2 * PADX, CELL_H], 'frames': 8, 'sheets': {}, 'cards': {}, 'tones': tones()}
    errors, total = [], 0
    for role in ('pitcher', 'batter'):
        for short, era in ERAS.items():
            for tone in SHEET_TONES:
                p = f'art/sprites/{role}/{short}-{tone}.png'
                if not os.path.exists(p): errors.append(f'missing {p}'); continue
                src = Image.open(p).convert('RGBA')
                if src.size != (CELL_W * 8, CELL_H): errors.append(f'bad size {p} {src.size}'); continue
                sheet = Image.new('RGBA', ((CELL_W + 2 * PADX) * 8, CELL_H), (0, 0, 0, 0))
                for i in range(8):
                    sheet.paste(src.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H)), (i * (CELL_W + 2 * PADX) + PADX, 0))
                url, n = save_hashed(sheet, f'{role}-{short}-{tone}', 80); total += n
                man['sheets'][f'{role}/{era}/{tone}'] = url
    for role in ('pitcher', 'batter'):   # plan 52: cards loop on its own; 'line' = blank-paper card (no sheet)
        for short, era in ERAS.items():
            for tone in CARD_TONES:
                for v in ('a', 'b'):
                    try: url, n = export_card(role, short, tone, v)
                    except FileNotFoundError as e: errors.append(str(e)); continue
                    total += n; man['cards'][f'{role}/{era}/{tone}/{v}'] = url
    # Plan 32B: side-on batter sheets, added beside the old ones (the live scene keeps the old keys until 32C)
    sm = json.load(open('art/sprites/batter-side/side-meta.json'))
    side = {'cell': sm['cell'], 'footY': sm['footY'], 'sheets': {}, 'frames': {}}
    for look in ('1901', '1920', '1956', '1990'):
        for tone in SHEET_TONES + ('line',):   # line = pen-and-ink sheet for batters with no researched tone
            p = f'art/sprites/batter-side/{look}-{tone}.png'
            if not os.path.exists(p): errors.append(f'missing {p}'); continue
            for q in (80, 72, 64):   # stay under 200 KB per sheet (busy white uniforms need a lower quality)
                url, n = save_hashed(Image.open(p).convert('RGBA'), f'side-{look}-{tone}', q)
                if n < 200_000: break
                os.remove(os.path.join(OUT, url.rsplit('/', 1)[1]))
            total += n
            if n >= 200_000: errors.append(f'too big {p} {n}')
            side['sheets'][f'{look}/{tone}'] = url
            side['frames'][f'{look}/{tone}'] = sm['sheets'][f'{look}-{tone}']['frames']
    man['side'] = side
    # Plan 44: fielder sheets by the pitcher's era (hybrid look), at half size: fielders are always small on screen
    fm = json.load(open('art/sprites/fielder/fielder-meta.json'))
    fl = {'cell': [fm['cell'][0] // 2, fm['cell'][1] // 2], 'footY': fm['footY'] // 2, 'sheets': {}}
    for short, era in ERAS.items():
        p = f'art/sprites/fielder/{short}-hybrid.png'
        if not os.path.exists(p): errors.append(f'missing {p}'); continue
        im = Image.open(p).convert('RGBA')
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
        url, n = save_hashed(im, f'fielder-{short}', 80)
        total += n
        if n >= 120_000: errors.append(f'too big {p} {n}')
        fl['sheets'][era] = url
    man['fielder'] = fl
    json.dump(man, open('app/public/art-manifest.json', 'w'), separators=(',', ':'))
    print(f"sheets {len(man['sheets'])}, cards {len(man['cards'])}, tones {len(man['tones'])}, art bytes {total}")
    if errors: print('ERRORS', errors); sys.exit(1)

if __name__ == '__main__':
    if '--tones-only' in sys.argv: tones_only('--allow-changes' in sys.argv)
    elif '--cards-only' in sys.argv: cards_only(sys.argv[sys.argv.index('--cards-only') + 1:])
    elif '--full' in sys.argv: main()   # deletes every webp and rebuilds everything: banned until the fielder source is fixed (plan 52)
    else: print('usage: export-app-art.py --cards-only <manifest key>... | --full'); sys.exit(2)
