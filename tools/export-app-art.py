"""Plan 18 v2: export sprite sheets, matchup cards and the tone list for the app.
Writes app/public/art/<hashed files> and app/public/art-manifest.json. Run from the repo root."""
import csv, glob, hashlib, io, json, os, sys
from PIL import Image

OUT = 'app/public/art'
ERAS = {'1901': '1901-1919', '1920': '1920-1945', '1946': '1946-1969', '1970': '1970-1989', '1990': '1990-2025'}
SHEET_TONES = ('light', 'darkbrown')
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
    for r in csv.DictReader(open('data/tone/tones-researched.csv', encoding='utf-8-sig')):
        t.pop(r['id'], None)
        if r['tone'] in ('light', 'olive', 'mediumbrown', 'darkbrown'): t[r['id']] = r['tone']
    return t

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
                for v in ('a', 'b'):
                    c = f'art/sprites/matchup/{role}/{short}-{tone}-{v}.webp'
                    if not os.path.exists(c): errors.append(f'missing {c}'); continue
                    url, n = save_hashed(Image.open(c).convert('RGB'), f'card-{role}-{short}-{tone}-{v}', 82); total += n
                    man['cards'][f'{role}/{era}/{tone}/{v}'] = url
    json.dump(man, open('app/public/art-manifest.json', 'w'), separators=(',', ':'))
    print(f"sheets {len(man['sheets'])}, cards {len(man['cards'])}, tones {len(man['tones'])}, art bytes {total}")
    if errors: print('ERRORS', errors); sys.exit(1)

if __name__ == '__main__':
    main()
