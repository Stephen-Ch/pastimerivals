"""Plan 53: skin-tone facts from public data (Wikidata + English Wikipedia categories). Standard library only.
Runs on the laptop (the cloud workspace gets rate-limited). Resumable: each run works for about 150 s, then stops;
run `step` again until it says "all steps done", then `report`.

  python3 tools/tone-wiki-lookup.py step     # Wikidata ids -> articles, then categories, then intros of hits
  python3 tools/tone-wiki-lookup.py report   # writes data/tone/tones-wiki.csv, wiki-handcheck.csv, wiki-lookup.csv

Rule (only a sourced fact sets a tone): darkbrown if the article is in "African-American baseball players", or in
"20th/21st-century African-American sportsmen" plus any baseball category. Hits whose intro mentions biracial or
mixed heritage go to the hand-check list, untoned. Latin American birthplace or citizenship never sets a tone."""
import csv, glob, json, os, random, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TONE = os.path.join(ROOT, 'data', 'tone')
CACHE = os.path.join(TONE, '_wiki-cache')
UA = {'User-Agent': 'PastimeRivals-tone-research/1.0 (schurchville@gmail.com)'}
BUDGET = 150          # seconds per run
WDQS_GAP = 65         # the query service allows about 1 request a minute right now
CHUNK = 700
EXACT = 'African-American baseball players'
SPORTSMEN = {'20th-century African-American sportsmen', '21st-century African-American sportsmen'}
MIXED = ('biracial', 'bi-racial', 'mixed-race', 'mixed race', 'multiracial', 'multi-racial', 'white mother', 'white father', 'of mixed ')
# plan 53 v1.2: a sentence about a parent that names another heritage also sends the player to the hand-check list
PARENT = ('mother', 'father', 'parents', 'grandmother', 'grandfather')
HERITAGE = ('white', 'caucasian', 'japanese', 'korean', 'chinese', 'filipino', 'vietnamese', 'mexican', 'puerto ric', 'dominican', 'cuban',
            'panamanian', 'venezuelan', 'irish', 'italian', 'german', 'jewish', 'native american', 'cherokee', 'european', 'hispanic', 'latino', 'latina')
LATIN_QIDS = {'Q786', 'Q717', 'Q241', 'Q96', 'Q739', 'Q804', 'Q811', 'Q25279', 'Q21203', 'Q155', 'Q783', 'Q774', 'Q792', 'Q800', 'Q419', 'Q298', 'Q414', 'Q733', 'Q77', 'Q750', 'Q736', 'Q790'}
LATIN_WORDS = ('dominican republic', 'puerto ric', 'venezuel', 'cuba', 'mexic', 'panama', 'colombia', 'nicaragua', 'cura', 'aruba', 'brazil', 'hondura')
START = time.time()

def left(): return BUDGET - (time.time() - START)
def jload(p, d): return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else d
def jsave(p, v):
    tmp = p + '.tmp'; json.dump(v, open(tmp, 'w', encoding='utf-8')); os.replace(tmp, p)

def players():
    """Untoned players from the research batches (id -> row), minus anyone the manifest already tones."""
    tones = json.load(open(os.path.join(ROOT, 'app', 'public', 'art-manifest.json')))['tones']
    out = {}
    for f in sorted(glob.glob(os.path.join(TONE, 'research-batch-[0-9]*.csv'))):
        for r in csv.DictReader(open(f, encoding='utf-8-sig')):
            if r['id'] not in tones: out[r['id']] = r
    return out

def http(url, data=None, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **({'Content-Type': 'application/x-www-form-urlencoded'} if data else {}),
                                                                   'Accept': 'application/json, application/sparql-results+json'})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or k == tries - 1: raise
            wait = 10 * (k + 1)
            if left() < wait + 5: raise
            time.sleep(wait)

# ---- step A: Wikidata (Retrosheet id -> items, article, photo, citizenship) ----
def step_wikidata(ids):
    os.makedirs(CACHE, exist_ok=True)
    stamp = os.path.join(CACHE, 'wdqs-last.txt')
    chunks = [ids[i:i + CHUNK] for i in range(0, len(ids), CHUNK)]
    for n, ch in enumerate(chunks):
        path = os.path.join(CACHE, f'wikidata-{n:02d}.json')
        if os.path.exists(path) and jload(path, {}).get('ids') == ch: continue
        last = float(open(stamp).read()) if os.path.exists(stamp) else 0
        wait = max(0, WDQS_GAP - (time.time() - last))
        if left() < wait + 40: return False
        time.sleep(wait)
        vals = ' '.join(f'"{x}"' for x in ch)
        q = f'''SELECT ?rid ?item ?art ?img ?cit WHERE {{ VALUES ?rid {{ {vals} }} ?item wdt:P6976 ?rid .
          OPTIONAL {{ ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
          OPTIONAL {{ ?item wdt:P18 ?img }} OPTIONAL {{ ?item wdt:P27 ?cit }} }}'''
        open(stamp, 'w').write(str(time.time()))
        try: res = http('https://query.wikidata.org/sparql', urllib.parse.urlencode({'query': q}).encode(), tries=1)
        except urllib.error.HTTPError as e:
            print(f'wikidata chunk {n}: HTTP {e.code}, will retry next run'); return False
        rows = [{k: v['value'] for k, v in b.items()} for b in res['results']['bindings']]
        jsave(path, {'ids': ch, 'rows': rows})
        print(f'wikidata chunk {n + 1}/{len(chunks)}: {len(rows)} rows')
    return True

def wikidata_map(ids):
    """id -> {'items', 'title', 'img', 'cit'} (title None when missing; several items flagged)."""
    by = {i: {'items': set(), 'arts': set(), 'img': None, 'cit': set()} for i in ids}
    for p in sorted(glob.glob(os.path.join(CACHE, 'wikidata-*.json'))):
        for r in jload(p, {}).get('rows', []):
            d = by.get(r['rid'])
            if d is None: continue
            d['items'].add(r['item'].rsplit('/', 1)[1])
            if 'art' in r: d['arts'].add(urllib.parse.unquote(r['art'].rsplit('/wiki/', 1)[1]).replace('_', ' '))
            if 'img' in r and not d['img']: d['img'] = urllib.parse.unquote(r['img'].rsplit('/', 1)[1])
            if 'cit' in r: d['cit'].add(r['cit'].rsplit('/', 1)[1])
    out = {}
    for i, d in by.items():
        ok = len(d['items']) == 1 and len(d['arts']) == 1
        out[i] = {'items': sorted(d['items']), 'title': next(iter(d['arts'])) if ok else None, 'img': d['img'], 'cit': sorted(d['cit']),
                  'skip': None if ok else ('no wikidata item' if not d['items'] else 'several wikidata items' if len(d['items']) > 1 else 'no or several articles')}
    titles = [v['title'] for v in out.values() if v['title']]
    dup = {t for t in titles if titles.count(t) > 1}
    for v in out.values():
        if v['title'] in dup: v['skip'] = 'article shared with another id'; v['title'] = None
    return out

# ---- step B: Wikipedia categories (complete lists only) ----
def step_categories(titles):
    path = os.path.join(CACHE, 'pages.json'); pages = jload(path, {})
    todo = [t for t in titles if t not in pages]
    for i in range(0, len(todo), 50):
        if left() < 20: jsave(path, pages); return False
        batch = todo[i:i + 50]
        p = {'action': 'query', 'prop': 'categories', 'titles': '|'.join(batch), 'cllimit': 'max', 'clshow': '!hidden',
             'format': 'json', 'formatversion': '2', 'redirects': '1'}
        cats, norm, redir = {}, {}, {}
        while True:   # follow every continue: the category list is only complete at the end
            r = http('https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(p))
            q = r.get('query', {})
            for n in q.get('normalized', []): norm[n['from']] = n['to']
            for n in q.get('redirects', []): redir[n['from']] = n['to']
            for pg in q.get('pages', []):
                cats.setdefault(pg['title'], {'missing': pg.get('missing', False), 'cats': []})
                cats[pg['title']]['cats'] += [c['title'].split(':', 1)[1] for c in pg.get('categories', [])]
            if 'continue' in r: p.update(r['continue']); time.sleep(0.3)
            else: break
        for t in batch:
            n = norm.get(t, t)
            if n in redir: pages[t] = {'status': 'redirect', 'to': redir[n], 'cats': []}; continue
            got = cats.get(n)
            pages[t] = {'status': 'missing' if not got or got['missing'] else 'ok', 'cats': sorted(set(got['cats'])) if got else []}
        time.sleep(0.3)
    jsave(path, pages); return True

def is_hit(cats):
    s = set(cats)
    if EXACT in s: return EXACT
    return None   # plan 53 v1.2: the broader 'African-American sportsmen' categories gave wrong hits (two white 1908 pitchers), so they no longer count

# ---- step C: intros of hits (biracial / mixed check) ----
def step_intros(titles):
    path = os.path.join(CACHE, 'fulltext.json'); intros = jload(path, {})
    todo = [t for t in titles if t not in intros]
    for i in range(0, len(todo), 1):   # full text comes one page per request
        if left() < 20: jsave(path, intros); return False
        batch = todo[i:i + 1]
        p = {'action': 'query', 'prop': 'extracts', 'explaintext': '1', 'exlimit': '1', 'titles': '|'.join(batch),
             'format': 'json', 'formatversion': '2'}
        got = {}
        while True:
            r = http('https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode(p))
            norm = {n['from']: n['to'] for n in r.get('query', {}).get('normalized', [])}
            for pg in r.get('query', {}).get('pages', []):
                if 'extract' in pg: got[pg['title']] = pg['extract']
            if 'continue' in r: p.update(r['continue']); time.sleep(0.3)
            else: break
        for t in batch:
            if norm.get(t, t) in got: intros[t] = got[norm.get(t, t)]
        time.sleep(0.3)
    jsave(path, intros)
    return all(t in intros for t in titles)

def mixed(text):
    t = (text or '').lower()
    found = [w.strip() for w in MIXED if w in t]
    for sent in re.split(r'(?<=[.!?])\s+', t):
        if any(p in sent for p in PARENT):
            found += [f'parent sentence: {h}' for h in HERITAGE if re.search(r'\b' + re.escape(h), sent)]
    return sorted(set(found))

def latin(info, cats):
    if set(info['cit']) & LATIN_QIDS: return True
    return any(('players from' in c.lower() or 'sportspeople from' in c.lower()) and any(w in c.lower() for w in LATIN_WORDS) for c in cats)

def step():
    ps = players(); ids = sorted(ps)
    print(f'{len(ids)} untoned players')
    if not step_wikidata(ids): print('stopped (time); run step again'); return
    wd = wikidata_map(ids)
    titles = sorted({v['title'] for v in wd.values() if v['title']})
    if not step_categories(titles): print('stopped (time) in categories; run step again'); return
    pages = jload(os.path.join(CACHE, 'pages.json'), {})
    hits = sorted(t for t in titles if pages.get(t, {}).get('status') == 'ok' and is_hit(pages[t]['cats']))
    if not step_intros(hits): print('stopped (time) in intros; run step again'); return
    print(f'all steps done: {len(titles)} articles, {len(hits)} category hits. Now run: report')

def report():
    ps = players(); ids = sorted(ps)
    wd = wikidata_map(ids)
    pages = jload(os.path.join(CACHE, 'pages.json'), {}); intros = jload(os.path.join(CACHE, 'fulltext.json'), {})
    tones, hand, look = [], [], []
    for i in ids:
        v = wd[i]; r = ps[i]; t = v['title']; pg = pages.get(t, {}) if t else {}
        cats = pg.get('cats', []) if pg.get('status') == 'ok' else []
        url = 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(t.replace(' ', '_')) if t else ''
        hit = is_hit(cats)
        mx = mixed(intros.get(t)) if hit else []
        skip = v['skip'] or (f"article {pg.get('status')}" if t and pg.get('status') != 'ok' else None)
        look.append({'id': i, 'name': r['name'], 'first_year': r['first_year'], 'enwiki': url, 'photo': v['img'] or '',
                     'latin': 'yes' if latin(v, cats) else 'no', 'matched': hit or '', 'skip': skip or ''})
        if not hit or skip: continue
        if mx: hand.append({'id': i, 'name': r['name'], 'first_year': r['first_year'], 'category': hit, 'intro_words': '; '.join(mx), 'source_url': url}); continue
        tones.append({'id': i, 'name': r['name'], 'tone': 'darkbrown', 'evidence': f'Wikipedia category: {hit}', 'source_url': url})
    def w(name, rows, cols):
        with open(os.path.join(TONE, name), 'w', newline='', encoding='utf-8') as f:
            wr = csv.DictWriter(f, fieldnames=cols); wr.writeheader(); wr.writerows(rows)
    w('tones-wiki.csv', tones, ['id', 'name', 'tone', 'evidence', 'source_url'])
    w('wiki-handcheck.csv', hand, ['id', 'name', 'first_year', 'category', 'intro_words', 'source_url'])
    w('wiki-lookup.csv', look, ['id', 'name', 'first_year', 'enwiki', 'photo', 'latin', 'matched', 'skip'])
    skips = {}
    for x in look:
        if x['skip']: skips[x['skip']] = skips.get(x['skip'], 0) + 1
    print(f'players {len(ids)}; toned {len(tones)}; hand-check (mixed heritage words in the article) {len(hand)}; latin {sum(x["latin"] == "yes" for x in look)}; '
          f'with photo {sum(bool(x["photo"]) for x in look)}; skipped {skips}')
    early = [x for x in tones if int(ps[x['id']]['first_year'] or 9999) < 1947]
    print(f'\nDEBUT BEFORE 1947 (look by hand, keep unless wrong): {len(early)}')
    for x in early: print(f"  {x['name']} ({ps[x['id']]['first_year']}) {x['source_url']}")
    random.seed(53)
    print('\nRANDOM 30:')
    for x in random.sample(tones, min(30, len(tones))): print(f"  {x['name']} ({ps[x['id']]['first_year']})")
    print('\nHAND-CHECK:')
    for x in hand: print(f"  {x['name']} ({x['first_year']}): {x['intro_words']}")

if __name__ == '__main__':
    {'step': step, 'report': report}.get(sys.argv[1] if len(sys.argv) > 1 else '', lambda: print(__doc__))()
