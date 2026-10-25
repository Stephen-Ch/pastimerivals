"""Plan 45/47 phrase check: a local Whisper model (offline, no credits) transcribes each phrase clip; it must match the
phrase text after normalising (case, punctuation, hyphens). Also reports duration and peak level.
Usage: python3 tools/check-phrases.py <el dir with classic/ modern/> <spoken-phrases.json> <out report.json>
Runs in the cloud workspace (needs faster-whisper)."""
import json, os, re, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel

el, phr, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
model = WhisperModel('small.en', device='cpu', compute_type='int8')

def norm(s):
    s = s.lower().replace('-', ' ').replace('’', "'")
    s = re.sub(r"[^a-z0-9' ]", ' ', s)
    s = s.replace("'s ", "s ").replace("'", '')
    return s.split()

def peak(p):
    e = subprocess.run(['ffmpeg', '-hide_banner', '-i', p, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = re.search(r'max_volume: (-?[\d.]+)', e)
    return float(m.group(1)) if m else None

rep = json.load(open(out)) if os.path.exists(out) else {}
for voice in ('classic', 'modern'):
    rep.setdefault(voice, {})
    for k, p in phr.items():
        f = os.path.join(el, voice, k + '.mp3')
        if not os.path.exists(f): rep[voice][k] = {'ok': False, 'why': 'missing'}; continue
        if k in rep[voice] and rep[voice][k].get('ok') is not None and rep[voice][k].get('mtime') == os.path.getmtime(f): continue
        audio = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True).stdout, np.int16).astype(np.float32) / 32768
        segs, info = model.transcribe(audio, language='en', beam_size=5, vad_filter=False)
        heard = ' '.join(s.text for s in segs).strip()
        ok = norm(heard) == norm(p['t'])
        rep[voice][k] = {'ok': ok, 'heard': heard, 'want': p['t'], 'dur': round(info.duration, 3), 'peak': peak(f), 'mtime': os.path.getmtime(f)}
        print(voice, k, 'OK' if ok else f'MISMATCH heard={heard!r}', flush=True)
    json.dump(rep, open(out, 'w'), indent=1)
bad = [(v, k) for v in rep for k in rep[v] if not rep[v][k]['ok']]
print('mismatches', len(bad))
