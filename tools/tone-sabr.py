"""Plan 55: skin tones from SABR BioProject biographies (only a stated family heritage counts).

  wikidata   -> birth year + SABR id for every still-blank player (700 ids per query, 65 s apart; resumable)
  fetch      -> SABR pages (id, else name slug, then -2/-3), 1 a second; keeps h1, Born line and body text only
  extract    -> identity check, blocking words, latin/birth-country check, heritage sentences with context
  controls   -> the same for known-tone players (built from batch files that cite SABR, and tones-wiki)
  packets    -> review packets: 40 players + 4 controls, numbers only
  decide <A.json> <B.json> -> data/tone/pending/tones-sabr.csv + spot-check list
Run from the repo root. Cache: data/tone/_sabr-cache/ (git-ignored)."""
import csv, glob, html, json, os, random, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TONE = os.path.join(ROOT, 'data', 'tone')
CACHE = os.path.join(TONE, '_sabr-cache')
UA = {'User-Agent': 'PastimeRivals-tone-research/1.0 (schurchville@gmail.com)'}

LIGHT = ['english', 'irish', 'scottish', 'scotch-irish', 'scots-irish', 'scotch', 'welsh', 'german', 'dutch', 'swedish', 'norwegian', 'danish',
         'finnish', 'polish', 'czech', 'bohemian', 'slovak', 'hungarian', 'austrian', 'swiss', 'french', 'italian', 'sicilian', 'croatian',
         'serbian', 'slovenian', 'lithuanian', 'latvian', 'ukrainian', 'greek', 'belgian', 'luxembourgish', 'icelandic', 'estonian']
DARK = ['african american', 'african-american', 'black']
BLOCK = [r'\bnative american', r'\bamerican indian', r'\bcherokee', r'\bchoctaw', r'\bcreek indian', r'\bseminole', r'\bpenobscot',
         r'\bsioux', r'\bojibwe', r'\bchippewa', r'\bmohawk', r'\bnavajo', r'\bapache', r'\bwinnebago', r'\bpawnee', r'\bshawnee', r'\bcreole',
         r'\bmulatto', r'\bcolored\b', r'\bcomplexion', r'\bmixed[- ]race', r'\bbiracial', r'\bmultiracial', r'\bof mixed', r'\bhispanic', r'\blatino',
         r'\bmexican', r'\bcuban', r'\bpuerto ric', r'\bdominican', r'\bvenezuelan', r'\bhawaiian', r'\bfilipino', r'\bchinese', r'\bjapanese',
         r'\bkorean', r'\bcape verde', r'\bportuguese', r'\bspanish', r'\barmenian', r'\bturkish', r'\blebanese', r'\bsyrian', r'\barab',
         r'\bindian heritage', r'\bpart indian', r'\bindian blood', r'\bfull[- ]blooded']
TEAMS = [r'white sox', r'black sox', r'black yankees', r'black barons', r'black diamonds', r'black crackers', r'black senators', r'black pelicans',
         r'cuban x-giants', r'cuban stars', r'cuban giants', r'chinese professional baseball league', r'mexican league', r'mexican pacific league',
         r'dominican (winter|summer|republic professional) league', r'venezuelan (winter|professional) league', r'puerto rican (winter )?league',
         r'cuban (winter )?league', r'japanese (professional|league)', r'korea baseball organization', r'ancestry\.com', r'irish twins?',
         r'hispanic heritage', r'korean war', r'spanish[- ]american war', r'spanish (flu|influenza)', r'sioux (city|falls)', r'shawnee (hawks|mission|\(oklahoma\))', r'seminoles', r'apache junction', r'navajo nation (arena)?', r'cleveland indians', r'(kansas city|indianapolis|seattle|spokane|tacoma|nashville|buffalo|sioux city|springfield|columbus|toledo) indians', r'black and white', r'white and black', r'black ink', r'blackball']
HERIT = re.compile(r'\b(ancestry|ancestors?|descent|descended|heritage|immigrant|immigrants|immigrated|emigrated|emigrant|came (over )?from|born in|'
                   r'native of|natives of|' + '|'.join(re.escape(w) for w in LIGHT + DARK) + r')\b', re.I)

def rcsv(p): return list(csv.DictReader(open(p, encoding='utf-8-sig'))) if os.path.exists(p) else []
def norm(s): return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).strip()
def slug(s): return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower())).strip('-')
def jload(p, d): return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
def jsave(p, v): tmp = p + '.tmp'; json.dump(v, open(tmp, 'w', encoding='utf-8')); os.replace(tmp, p)

def known_ids():
    ids = set(json.load(open(os.path.join(ROOT, 'app', 'public', 'art-manifest.json')))['tones'])
    for f in glob.glob(os.path.join(TONE, 'batch*.csv')): ids |= {r['id'] for r in rcsv(f)}
    for n in ('tones-ngl.csv', 'tones-wiki.csv', 'tones-photo.csv', 'pending/tones-photo.csv', 'tones-researched.csv', 'wiki-handcheck.csv'):
        ids |= {r['id'] for r in rcsv(os.path.join(TONE, n))}
    return ids

def blank_players():
    known = known_ids()
    return [r for r in rcsv(os.path.join(TONE, 'wiki-lookup.csv')) if r['id'] not in known and not r['skip']]

# ---------- Wikidata: birth year and SABR id ----------
def wikidata(rows, tag):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'wd-{tag}.json'); got = jload(path, {})
    todo = [r['id'] for r in rows if r['id'] not in got]
    for i in range(0, len(todo), 700):
        ch = todo[i:i + 700]
        q = 'SELECT ?rid ?dob ?sabr WHERE { VALUES ?rid { %s } ?item wdt:P6976 ?rid . OPTIONAL { ?item wdt:P569 ?dob } OPTIONAL { ?item wdt:P2482 ?sabr } }' % ' '.join(f'"{x}"' for x in ch)
        for k in range(4):
            try:
                req = urllib.request.Request('https://query.wikidata.org/sparql', data=urllib.parse.urlencode({'query': q}).encode(),
                                             headers={**UA, 'Accept': 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded'})
                res = json.load(urllib.request.urlopen(req, timeout=120))['results']['bindings']; break
            except urllib.error.HTTPError as e:
                if e.code != 429 or k == 3: raise
                time.sleep(70)
        for x in ch: got.setdefault(x, {'dob': [], 'sabr': []})
        for b in res:
            d = got[b['rid']['value']]
            if 'dob' in b and b['dob']['value'][:5] not in d['dob']: d['dob'].append(b['dob']['value'][:5].lstrip('+'))
            if 'sabr' in b and b['sabr']['value'] not in d['sabr']: d['sabr'].append(b['sabr']['value'])
        jsave(path, got); print(f'wikidata {tag}: {min(i + 700, len(todo))}/{len(todo)}', flush=True)
        if i + 700 < len(todo): time.sleep(65)
    return got

# ---------- SABR pages ----------
def get(url):
    for k in range(3):
        try: return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read().decode('utf-8', 'ignore')
        except urllib.error.HTTPError as e:
            if e.code == 404: return ''
            if e.code in (429, 503): time.sleep(30 * (k + 1)); continue
            return ''
        except Exception: time.sleep(5)
    return None

def parse(page):
    h1 = re.search(r'<h1[^>]*>\s*([^<]+)', page)
    born = re.search(r'\|Born\|[^A-Za-z]*([A-Z][a-z]+ \d{1,2}, (\d{4})[^|]*)', re.sub(r'<[^>]+>', '|', page))
    a = page.find('entry-content'); s = page.find('>Sources<', a); n = page.find('>Notes<', a)
    end = min([x for x in (s, n) if x > 0] or [len(page)])
    seg = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', page[a:end] if a > 0 else '')
    body = html.unescape(re.sub(r'<[^>]+>', ' ', seg))
    body = re.sub(r'\s+', ' ', body)
    return {'h1': html.unescape(h1.group(1)).strip() if h1 else '', 'born': born.group(1).strip() if born else '',
            'born_year': born.group(2) if born else '', 'body': body}

def fetch(rows, tag, budget=None):
    wd = jload(os.path.join(CACHE, f'wd-{tag}.json'), {})
    path = os.path.join(CACHE, f'pages-{tag}.json'); pages = jload(path, {}); t0 = time.time(); n = 0
    for r in rows:
        if r['id'] in pages: continue
        if budget and time.time() - t0 > budget: break
        dob = (wd.get(r['id']) or {}).get('dob', [])
        cands = [f"https://sabr.org/bioproj/person/{s}/" for s in (wd.get(r['id']) or {}).get('sabr', [])]
        base = slug(r['name']); cands += [f'https://sabr.org/bioproj/person/{base}/', f'https://sabr.org/bioproj/person/{base}-2/', f'https://sabr.org/bioproj/person/{base}-3/']
        res = {'status': 'no page'}
        for u in dict.fromkeys(cands):
            pg = get(u); time.sleep(1.0)
            if pg is None: res = {'status': 'fetch error'}; break
            if not pg or 'Page not found' in pg[:5000]: continue
            p = parse(pg)
            if norm(p['h1']) != norm(r['name']): res = {'status': 'name differs', 'h1': p['h1']}; continue
            if not dob or p['born_year'] not in [d[:4] for d in dob]: res = {'status': 'birth year differs', 'born': p['born'], 'dob': dob}; continue
            res = {'status': 'ok', 'url': u, **p}; break
        pages[r['id']] = res; n += 1
        if n % 50 == 0: jsave(path, pages); print(f'pages {tag}: {len(pages)}/{len(rows)}', flush=True)
    jsave(path, pages); print(f'pages {tag}: {len(pages)}/{len(rows)} done', flush=True)

# ---------- extraction ----------
SCRIPT_JUNK = re.compile(r'"mejs\.[^"]*"\s*:\s*"[^"]*",?|\{[^{}]{0,4000}"mejs\.[^{}]*\}')
def clean(text):
    t = SCRIPT_JUNK.sub(' ', text)
    for pat in TEAMS: t = re.sub(pat, ' ', t, flags=re.I)
    return t

def blocked(body):
    t = clean(body).lower()
    return sorted({re.sub(r'\\b', '', b) for b in BLOCK if re.search(b, t)})

def sentences(body):
    ss = re.split(r'(?<=[.!?])\s+(?=[A-Z"“(])', body)
    out = []
    for i, s in enumerate(ss):
        c = clean(s)
        if HERIT.search(c) and len(s) < 600:
            out.append(' '.join(ss[max(0, i - 1):i + 2])[:900])
        if len(out) >= 6: break
    return out

def has_tone_word(q):
    c = clean(q).lower()
    return any(re.search(r'\b' + re.escape(w) + r'\b', c) for w in LIGHT + DARK)

def extract(rows, tag):
    pages = jload(os.path.join(CACHE, f'pages-{tag}.json'), {})
    out, stat = {}, {}
    for r in rows:
        p = pages.get(r['id'])
        if not p or p['status'] != 'ok': k = 'no usable page' if not p else p['status']
        elif r.get('latin') == 'yes': k = 'born or citizen in Latin America'
        elif not re.search(r'\((USA|CAN|Canada|[A-Z][a-z]+)\)\s*$', p['born']) or not re.search(r'\((USA|CAN|Canada|Ireland|Germany|England|Scotland|Wales|Italy|Poland|Netherlands|Sweden|Norway|Denmark|Finland|Czech Republic|Czechoslovakia|Austria|Hungary|Switzerland|France|Belgium|Greece|Croatia|Slovakia|Lithuania|Ukraine|United Kingdom|UK|Russia)\)', p['born']): k = 'born outside US, Canada or Europe (or unknown)'
        elif blocked(p['body']): k = 'blocking word'
        else:
            ss = [s for s in sentences(p['body']) if has_tone_word(s)]
            if not ss: k = 'no heritage sentence'
            else: k = 'to review'; out[r['id']] = {'name': r['name'], 'url': p['url'], 'sentences': ss}
        stat[k] = stat.get(k, 0) + 1
    jsave(os.path.join(CACHE, f'review-{tag}.json'), out)
    print(tag, stat)
    return out

def packets(seed=551):
    rv = jload(os.path.join(CACHE, 'review-main.json'), {}); ct = jload(os.path.join(CACHE, 'review-controls.json'), {})
    ctone = {r['id']: r['tone'] for r in rcsv(os.path.join(TONE, 'sabr-controls.csv'))}
    ctrl = [k for k in ct if k in ctone]
    light = [k for k in ctrl if ctone[k] == 'light']; dark = [k for k in ctrl if ctone[k] == 'darkbrown']
    plan = {}
    for name, sd in (('A', seed), ('B', seed + 1)):
        rnd = random.Random(sd); ids = sorted(rv); rnd.shuffle(ids)
        plist = []
        for g in range(0, len(ids), 40):
            cells = ids[g:g + 40] + rnd.sample(light, min(2, len(light))) + rnd.sample(dark, min(2, len(dark)))
            rnd.shuffle(cells)
            txt = []
            for i, pid in enumerate(cells):
                src = rv.get(pid) or ct[pid]
                txt.append(f'=== Player {i + 1} ===\n' + '\n---\n'.join(src['sentences']))
            fn = f'packet-{name}{g // 40 + 1:02d}.txt'
            open(os.path.join(CACHE, fn), 'w', encoding='utf-8').write('\n\n'.join(txt) + '\n')
            plist.append({'packet': fn, 'cells': cells})
        plan[name] = plist
    jsave(os.path.join(CACHE, 'packets.json'), {'plan': plan, 'controls': {k: ctone[k] for k in ctrl}})
    print({k: len(v) for k, v in plan.items()}, 'packets per pass;', len(rv), 'players;', len(light), 'light /', len(dark), 'dark controls')

def ok_answer(v):
    return v.get('whole_family') == 'yes' and v.get('art') in ('light', 'darkbrown') and v.get('quote') and has_tone_word(v['quote'])

def decide(fa, fb):
    meta = jload(os.path.join(CACHE, 'packets.json'), {}); ctrl = meta['controls']
    rv = jload(os.path.join(CACHE, 'review-main.json'), {}); ct = jload(os.path.join(CACHE, 'review-controls.json'), {})
    votes, bad = {}, []
    for name, f in (('A', fa), ('B', fb)):
        ans = json.load(open(f))
        for pk in meta['plan'][name]:
            a = ans.get(pk['packet'], {})
            per = {pid: a.get(str(i + 1), {}) for i, pid in enumerate(pk['cells'])}
            # a control given the OPPOSITE tone throws out the packet; blank on a control is caution (several control
            # excerpts turned out not to state whole-family heritage, so blank was the right answer there)
            if any(per[c].get('art') in ('light', 'darkbrown') and per[c].get('art') != ctrl[c] for c in pk['cells'] if c in ctrl):
                bad.append(pk['packet']); continue
            for pid, v in per.items():
                if pid in ctrl: continue
                srcs = ' '.join(rv[pid]['sentences'])
                q = (v.get('quote') or '').strip()
                votes.setdefault(pid, {})[name] = (v['art'], q) if ok_answer(v) and q[:60] in srcs else None
    out = []
    for pid, v in votes.items():
        a, b = v.get('A'), v.get('B')
        if a and b and a[0] == b[0] and (a[1][:60] in b[1] or b[1][:60] in a[1]):
            out.append({'id': pid, 'name': rv[pid]['name'], 'tone': a[0], 'evidence': f'SABR BioProject: "{a[1][:300]}"', 'source_url': rv[pid]['url']})
    os.makedirs(os.path.join(TONE, 'pending'), exist_ok=True)
    with open(os.path.join(TONE, 'pending', 'tones-sabr.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['id', 'name', 'tone', 'evidence', 'source_url']); w.writeheader(); w.writerows(sorted(out, key=lambda x: x['id']))
    print(f'thrown-out packets {bad}; recorded {len(out)} (light {sum(o["tone"] == "light" for o in out)}, darkbrown {sum(o["tone"] == "darkbrown" for o in out)})')
    return out

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'wikidata': wikidata(blank_players(), 'main')
    elif cmd == 'fetch': fetch(blank_players(), 'main', float(sys.argv[2]) if len(sys.argv) > 2 else None)
    elif cmd == 'fetchpart':   # fetchpart k n: worker k of n, own cache file pages-main-k.json
        k, n = int(sys.argv[2]), int(sys.argv[3])
        wd = jload(os.path.join(CACHE, 'wd-main.json'), {}); jsave(os.path.join(CACHE, f'wd-main-{k}.json'), wd)
        fetch(blank_players()[k::n], f'main-{k}')
    elif cmd == 'merge':
        pages = jload(os.path.join(CACHE, 'pages-main.json'), {})
        for f in glob.glob(os.path.join(CACHE, 'pages-main-*.json')): pages.update(jload(f, {}))
        jsave(os.path.join(CACHE, 'pages-main.json'), pages); print('merged', len(pages))
    elif cmd == 'extract': extract(blank_players(), 'main')
    elif cmd == 'packets': packets()
    elif cmd == 'decide': decide(sys.argv[2], sys.argv[3])
    else: print(__doc__)
