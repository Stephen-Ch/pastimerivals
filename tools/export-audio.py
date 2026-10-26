"""Plan 50 A: exports the recorded clips for the site (no credits, no network).
Usage (repo root): python3 tools/export-audio.py
Writes _audio/web/audio/{p/<voice>/<key>,n/<voice>/<id>,c/<name>}.<h8>.mp3 (h8 = first 8 hex of SHA-256; git-ignored)
and app/public/voice-manifest.json (in git). Phrases: only keys in data/audio/spoken-phrases.json.
Names: not in _audio/el/names-skip.txt and not in the low-score list (_audio/el/names-low-*.json) unless cleared in _audio/el/names-ok.txt.
Durations (ms) of the a.* calls go in the manifest; the app speaks a call's fallback when the clip is over 1.35 s (plan 46 C)."""
import glob, hashlib, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EL = os.path.join(ROOT, '_audio', 'el')
CROWD = os.path.join(ROOT, '_audio', 'test2', 'crowd')
OUT = os.path.join(ROOT, '_audio', 'web', 'audio')
MANIFEST = os.path.join(ROOT, 'app', 'public', 'voice-manifest.json')
VOICES = ('classic', 'modern')

def h8(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:8]

def dur_ms(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True).stdout.decode().strip()
    try: return int(round(float(out) * 1000))
    except ValueError: return 0

def pairs_file(path, cols=2):
    if not os.path.exists(path): return set()
    return {tuple(l.rstrip('\n').split('\t')[:cols]) for l in open(path, encoding='utf-8') if l.strip()}

def low_set(el=EL):
    s = set()
    for f in glob.glob(os.path.join(el, 'names-low-*.json')):
        s |= {(v, i) for v, i, *_ in json.load(open(f, encoding='utf-8'))}
    return s

def place(src, rel, out):
    """Copies src to out/rel.<h8>.mp3 if it is not there yet; returns h8."""
    h = h8(src)
    dst = os.path.join(out, f'{rel}.{h}.mp3')
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst + '.tmp'); os.replace(dst + '.tmp', dst)
    return h

def export(el=EL, crowd=CROWD, out=OUT, manifest=MANIFEST, keys=None, durf=dur_ms):
    if keys is None: keys = list(json.load(open(os.path.join(ROOT, 'data', 'audio', 'spoken-phrases.json'), encoding='utf-8')))
    skip, ok, low = pairs_file(os.path.join(el, 'names-skip.txt')), pairs_file(os.path.join(el, 'names-ok.txt')), low_set(el)
    m = {'v': 1, 'phrases': {}, 'dur': {}, 'names': {}, 'crowd': {}}
    report = {'missing_phrases': [], 'names_excluded': 0}
    for v in VOICES:
        m['phrases'][v], m['dur'][v], m['names'][v] = {}, {}, {}
        for k in sorted(keys):
            src = os.path.join(el, v, k + '.mp3')
            if not os.path.exists(src): report['missing_phrases'].append(f'{v} {k}'); continue
            m['phrases'][v][k] = place(src, f'p/{v}/{k}', out)
            if k.startswith('a.'): m['dur'][v][k] = durf(src)
        for src in sorted(glob.glob(os.path.join(el, v, 'names', '*.mp3'))):
            pid = os.path.basename(src)[:-4]
            if (v, pid) in skip or ((v, pid) in low and (v, pid) not in ok): report['names_excluded'] += 1; continue
            m['names'][v][pid] = place(src, f'n/{v}/{pid}', out)
    for src in sorted(glob.glob(os.path.join(crowd, '*.mp3'))):
        name = os.path.basename(src)[:-4]
        m['crowd'][name] = place(src, f'c/{name}', out)
    os.makedirs(os.path.dirname(manifest), exist_ok=True)
    text = json.dumps(m, separators=(',', ':'), sort_keys=True)
    if not os.path.exists(manifest) or open(manifest, encoding='utf-8').read() != text:
        open(manifest, 'w', encoding='utf-8').write(text)
    return m, report

def files_for(m):
    """Every file the manifest points at, relative to the audio folder (build-app.sh checks they exist)."""
    fs = [f'p/{v}/{k}.{h}.mp3' for v, d in m['phrases'].items() for k, h in d.items()]
    fs += [f'n/{v}/{i}.{h}.mp3' for v, d in m['names'].items() for i, h in d.items()]
    fs += [f'c/{n}.{h}.mp3' for n, h in m['crowd'].items()]
    return fs

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == 'check':
        m = json.load(open(MANIFEST, encoding='utf-8'))
        miss = [f for f in files_for(m) if not os.path.exists(os.path.join(sys.argv[2], f))]
        print(f'{len(miss)} missing' + (': ' + ', '.join(miss[:5]) if miss else '')); sys.exit(1 if miss else 0)
    m, rep = export()
    n = {v: len(m['names'][v]) for v in VOICES}; p = {v: len(m['phrases'][v]) for v in VOICES}
    long = {v: sorted(k for k, d in m['dur'][v].items() if d > 1350) for v in VOICES}
    print(f'phrases {p}; names {n}; crowd {len(m["crowd"])}; names excluded {rep["names_excluded"]}; missing phrases {rep["missing_phrases"][:5]}')
    print(f'calls over 1.35 s (fallback spoken): {long}')
