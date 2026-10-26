"""Plan 47: records announcer clips with ElevenLabs into the clip store _audio/el (ported from the Test 2 tools, same settings).
The old OpenAI mode is gone; this tool never reads _audio/clips or _audio/_old-openai-clips.
Usage (repo root, on the laptop):
  python3 tools/record-announcer.py credits                 -> remaining credits (User read)
  python3 tools/record-announcer.py import                  -> copies the Test 2 takes in use into _audio/el (no credits)
  python3 tools/record-announcer.py phrases classic|modern  -> records missing phrases (data/audio/spoken-phrases.json)
  python3 tools/record-announcer.py retake <voice> <key>... -> records those phrases again with a new seed (old take kept in _raw/rejected)
  python3 tools/record-announcer.py names [max_clips]       -> records name clips down data/audio/name-priority.csv
Store: _audio/el/<voice>/<key>.mp3, _audio/el/<voice>/names/<id>.mp3; raw takes in _audio/el/_raw. Resumable: existing clips are skipped.
Budget guard: before each batch of 200 clips the remaining credits are read; a batch that would leave under 300 is refused
(plan 48: estimate 0.5 credit per character, measured 0.4). Name clips must be 0.4-2.5 s (plan 48).
Skip list _audio/el/names-skip.txt (voice<TAB>id per line): names never re-cut or recorded (failed the Whisper check).
Key from secrets/deploy.local.json ("elevenKey"), never printed. Cost per clip to _audio/cost.log; clip details to _audio/el/build-log.jsonl."""
import json, math, os, re, subprocess, sys, time, threading, csv, shutil, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUD = os.path.join(ROOT, '_audio')
EL = os.path.join(AUD, 'el')
RAW = os.path.join(EL, '_raw')
T2 = os.path.join(AUD, 'test2')
COST = os.path.join(AUD, 'cost.log')
BLOG = os.path.join(EL, 'build-log.jsonl')
MODEL = 'eleven_v4'
SEED = 7
FLOOR = 300           # credits always left untouched (plan 48; was 1,500)
EST_PER_CHAR = 0.5    # plan 48: measured about 0.4 credit per character on eleven_v4
NAME_MAX = 2.5        # plan 48: longest name clip in seconds (was 2.0)
SKIP = os.path.join(AUD, 'el', 'names-skip.txt')
BATCH = 200
PARALLEL = 4
RETAKE_SHARE = 0.10   # phrases: 10% of the estimate held back for retakes
TAG = {'calm': '[matter-of-fact, steady radio play-by-play] ', 'rising': '[building excitement] ', 'excited': '[excited] '}
# One fixed gain per voice (model eleven_v4), set from Test 2 peaks so phrases sit at a median peak of about -3 dBFS
# (Test 2 medians: classic phrases -3.9, names -3.2; modern phrases -2.3, names -2.8).
GAIN_DB = {'classic': 0.9, 'modern': -0.7}
# Trim: keeps 60 ms before the first sound above -50 dB (Test 2's -45 dB / 20 ms cut the soft "G" of "Ground ball":
# Whisper heard "Round ball" in the trimmed clip and "Ground ball" in the raw take, 2026-10-25).
TRIM = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse")
_lock = threading.Lock()

def key():
    return json.load(open(os.path.join(ROOT, 'secrets', 'deploy.local.json')))['elevenKey']

def voice_ids():
    v = json.load(open(os.path.join(AUD, 'test1', 'voices.json')))
    return {'classic': v['des-classic'], 'modern': v['lib-modern']}

def phrase_text(k, p):
    return ('' if k.startswith('lead.') else TAG[p['m']]) + p['t']

def name_text(nm):
    return f'And now... {nm.upper()}!'

# ---------- budget ----------
def remaining():
    r = urllib.request.Request('https://api.elevenlabs.io/v1/user/subscription', headers={'xi-api-key': key()})
    d = json.load(urllib.request.urlopen(r, timeout=30))
    return int(d['character_limit']) - int(d['character_count'])

def batch_allowed(left, estimate, floor=FLOOR):
    """Plan 47 C: refuse a batch when remaining credits minus its estimate would go under the floor."""
    return left - estimate >= floor

def est_chars(chars, share=0.0):
    return math.ceil(round(chars * EST_PER_CHAR * (1 + share), 6))

def fit_jobs(left, jobs, estimate_of, floor=FLOOR):
    """Jobs in order up to the first one that would take credits under the floor."""
    fit, s = [], 0
    for j in jobs:
        if left - (s + estimate_of(j)) < floor: break
        fit.append(j); s += estimate_of(j)
    return fit

def name_len_ok(d):
    return 0.4 <= d <= NAME_MAX

def skip_set():
    if not os.path.exists(SKIP): return set()
    return {tuple(l.rstrip('\n').split('\t')[:2]) for l in open(SKIP) if l.strip()}

# ---------- requests ----------
def post(path, body):
    req = urllib.request.Request('https://api.elevenlabs.io' + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'xi-api-key': key(), 'Content-Type': 'application/json'})
    for i in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as r: return r.read()
        except urllib.error.HTTPError as e:
            msg = e.read()[:300].decode(errors='replace')
            if e.code in (429, 500, 502, 503) and i < 5: time.sleep(5 * (i + 1)); continue
            raise RuntimeError(f'{path} -> {e.code} {msg}')
        except urllib.error.URLError:
            if i < 5: time.sleep(5); continue
            raise

def tts(voice, text, seed):
    return post(f'/v1/text-to-speech/{voice_ids()[voice]}?output_format=pcm_24000', {'text': text, 'model_id': MODEL, 'seed': seed})

def log(what, chars, **info):
    with _lock:
        open(COST, 'a').write(f'{time.strftime("%Y-%m-%dT%H:%M:%S")} plan47 {what} chars={chars}\n')
        rec = dict(date=time.strftime('%Y-%m-%dT%H:%M:%S'), model=MODEL, **info)
        open(BLOG, 'a').write(json.dumps(rec) + '\n')

# ---------- audio ----------
def sh(args, data=None):
    return subprocess.run(args, input=data, capture_output=True)

def dur(path):
    out = sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.decode().strip()
    try: return float(out)
    except ValueError: return 0.0

def encode(src_pcm_or_wav, out, voice, start=None):
    """Trim, fixed gain per voice, MP3 mono 24 kHz 32 kbps (Test 2 settings)."""
    os.makedirs(os.path.dirname(out), exist_ok=True)
    inp = ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', src_pcm_or_wav] if src_pcm_or_wav.endswith('.pcm') else ['-i', src_pcm_or_wav]
    ss = ['-ss', f'{start:.3f}'] if start is not None else []
    af = f'{TRIM},volume={GAIN_DB[voice]}dB'
    r = sh(['ffmpeg', '-y', '-loglevel', 'error'] + inp + ss + ['-af', af, '-ar', '24000', '-ac', '1', '-b:a', '32k',
            '-write_xing', '0', '-id3v2_version', '0', '-map_metadata', '-1', out + '.tmp.mp3'])
    if r.returncode: raise RuntimeError(r.stderr.decode()[:300])
    os.replace(out + '.tmp.mp3', out)
    return dur(out)

def name_cut(pcm):
    """Middle of the first silence after 0.25 s that is not the tail (proc2.py rule). None if no gap."""
    o = sh(['ffmpeg', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-']).stderr.decode()
    st = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', o)]; en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', o)]
    tot = os.path.getsize(pcm) / 48000
    g = [(s, e) for s, e in zip(st, en) if s > 0.25 and e < tot - 0.15]
    return (g[0][0] + g[0][1]) / 2 if g else None

# ---------- jobs ----------
def run_batches(jobs, estimate_of):
    """jobs: list of callables with .chars. Batches of 200; credits read before each batch."""
    done = 0
    for i in range(0, len(jobs), BATCH):
        batch = jobs[i:i + BATCH]
        est = sum(estimate_of(j) for j in batch)
        left = remaining()
        if not batch_allowed(left, est):
            # Take only what fits, then stop.
            fit = fit_jobs(left, batch, estimate_of)
            print(f'BUDGET STOP: {left} credits left, batch needs {est}; recording {len(fit)} more, then stopping.', flush=True)
            batch = fit
        with ThreadPoolExecutor(PARALLEL) as ex:
            for res in ex.map(lambda j: j(), batch):
                done += 1
                if res: print(res, flush=True)
        if len(batch) < len(jobs[i:i + BATCH]): return done, True
    return done, False

def phrase_job(voice, k, p, seed=SEED, retake=False):
    out = os.path.join(EL, voice, k + '.mp3')
    raw = os.path.join(RAW, voice, k + '.pcm')
    text = phrase_text(k, p)
    def job():
        if os.path.exists(out) and not retake: return None
        os.makedirs(os.path.dirname(raw), exist_ok=True)
        if retake and os.path.exists(raw):
            rej = os.path.join(RAW, 'rejected', voice); os.makedirs(rej, exist_ok=True)
            os.replace(raw, os.path.join(rej, f'{k}.{int(time.time())}.pcm'))
        pcm = tts(voice, text, seed)
        open(raw + '.tmp', 'wb').write(pcm); os.replace(raw + '.tmp', raw)
        d = encode(raw, out, voice)
        log(f'{voice} {k}', len(text), voice=voice, voice_id=voice_ids()[voice], key=k, text=text, seed=seed, kind='phrase',
            source='retake' if retake else 'recorded', gain_db=GAIN_DB[voice], dur=round(d, 3))
        return f'{voice} {k} {d:.2f}s'
    job.chars = len(text)
    return job

def name_job(voice, pid, nm, seed=SEED):
    out = os.path.join(EL, voice, 'names', pid + '.mp3')
    raw = os.path.join(RAW, voice, 'names', pid + '.pcm')
    text = name_text(nm)
    def job():
        if os.path.exists(out): return None
        os.makedirs(os.path.dirname(raw), exist_ok=True)
        if not os.path.exists(raw):
            pcm = tts(voice, text, seed)
            open(raw + '.tmp', 'wb').write(pcm); os.replace(raw + '.tmp', raw)
            log(f'{voice} name {pid}', len(text), voice=voice, voice_id=voice_ids()[voice], key=pid, text=text, seed=seed, kind='name', gain_db=GAIN_DB[voice])
        cut = name_cut(raw)
        if cut is None: return fail(voice, pid, nm, 'NO GAP')
        d = encode(raw, out, voice, start=cut)
        if not name_len_ok(d):
            os.remove(out); return fail(voice, pid, nm, f'CUT FAIL {d:.2f}')
        return f'{voice} {pid} {d:.2f}s'
    job.chars = len(text)
    return job

def fail(voice, pid, nm, why):
    with _lock: open(os.path.join(EL, 'names-fail.txt'), 'a').write(f'{voice}\t{pid}\t{nm}\t{why}\n')
    return f'FAIL {voice} {pid} {why}'

def phrases():
    return json.load(open(os.path.join(ROOT, 'data', 'audio', 'spoken-phrases.json')))

def do_import(force=False):
    """Plan 47 A: copy the Test 2 takes in use into _audio/el. Where a retake exists, the shorter take is the one in use."""
    rep = json.load(open(os.path.join(T2, 'report.json')))
    P = phrases(); n = 0
    for voice in ('classic', 'modern'):
        for k, d0 in rep[voice].items():
            if not isinstance(d0, (int, float)): continue
            is_name = k.startswith('name-')
            if not is_name and k not in P: continue
            src_dir, take = voice, 'take'
            d1 = rep.get(voice + '-retake', {}).get(k)
            if isinstance(d1, (int, float)) and d1 < d0: src_dir, take = voice + '-retake', 'retake'
            src = os.path.join(T2, src_dir, k + '.pcm')   # raw take; trimmed here with this tool's TRIM
            if is_name: continue   # Test 2 names are keyed by name, not id; they are imported by name-priority (import-names)
            out = os.path.join(EL, voice, k + '.mp3')
            if os.path.exists(out) and not force: continue
            d = encode(src, out, voice)
            log(f'{voice} {k} import', 0, voice=voice, voice_id=voice_ids()[voice], key=k, text=phrase_text(k, P[k]), seed=SEED,
                kind='phrase', source=f'test2 {take}', gain_db=GAIN_DB[voice], dur=round(d, 3))
            n += 1
    print('imported', n)

def do_import_names():
    """Test 2 name takes (already cut) for players in name-priority.csv, matched by full name."""
    rep = json.load(open(os.path.join(T2, 'report.json')))
    people = {r['id']: f"{r['first']} {r['last']}" for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'outall', 'people.csv'), encoding='utf-8'))}
    pri = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'audio', 'name-priority.csv'))))
    n = 0
    for row in pri:
        v, pid = row['voice'], row['id']; nm = people.get(pid, '')
        k = 'name-' + nm.replace(' ', '_').replace('.', '')
        if isinstance(rep.get(v, {}).get(k), (int, float)):
            out = os.path.join(EL, v, 'names', pid + '.mp3')
            if os.path.exists(out): continue
            src = os.path.join(T2, v, k + '.pcm'); cut = name_cut(src)
            if cut is None: fail(v, pid, nm, 'NO GAP (test2)'); continue
            d = encode(src, out, v, start=cut)
            log(f'{v} name {pid} import', 0, voice=v, voice_id=voice_ids()[v], key=pid, text=name_text(nm), seed=SEED, kind='name', source='test2 take', gain_db=GAIN_DB[v], dur=round(d, 3))
            n += 1
    print('imported names', n)

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'credits':
        print(remaining())
    elif cmd == 'import':
        do_import()
    elif cmd == 'reencode':
        # Free: re-encodes every recorded phrase from its raw take (after a TRIM or gain change), then the Test 2 imports.
        P = phrases(); n = 0
        for voice in ('classic', 'modern'):
            for k in P:
                raw = os.path.join(RAW, voice, k + '.pcm')
                if os.path.exists(raw): encode(raw, os.path.join(EL, voice, k + '.mp3'), voice); n += 1
        print('re-encoded', n); do_import(force=True)
    elif cmd == 'import-names':
        do_import_names()
    elif cmd == 'phrases':
        voice = sys.argv[2]; P = phrases()
        jobs = [phrase_job(voice, k, p) for k, p in P.items() if not os.path.exists(os.path.join(EL, voice, k + '.mp3'))]
        est = lambda j: est_chars(j.chars, RETAKE_SHARE)
        print(f'{voice}: {len(jobs)} phrases to record, about {sum(j.chars for j in jobs)} credits', flush=True)
        n, stopped = run_batches(jobs, est)
        print(f'done {n}; remaining credits {remaining()}' + ('; STOPPED by budget guard' if stopped else ''), flush=True)
    elif cmd == 'retake':
        voice = sys.argv[2]; P = phrases()
        jobs = [phrase_job(voice, k, P[k], seed=SEED + 1 + int(time.time()) % 1000, retake=True) for k in sys.argv[3:]]
        n, stopped = run_batches(jobs, lambda j: est_chars(j.chars))
        print(f'retaken {n}; remaining credits {remaining()}', flush=True)
    elif cmd == 'names':
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10 ** 9
        people = {r['id']: f"{r['first']} {r['last']}" for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'outall', 'people.csv'), encoding='utf-8'))}
        pri = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'audio', 'name-priority.csv'))))
        pri.sort(key=lambda r: int(r['rank']))
        skip = skip_set()
        jobs = [name_job(r['voice'], r['id'], people[r['id']]) for r in pri if (r['voice'], r['id']) not in skip
                and not os.path.exists(os.path.join(EL, r['voice'], 'names', r['id'] + '.mp3'))][:limit]
        n, stopped = run_batches(jobs, lambda j: est_chars(j.chars))
        print(f'done {n}; remaining credits {remaining()}' + ('; STOPPED by budget guard' if stopped else ''), flush=True)
    else:
        print(__doc__)
