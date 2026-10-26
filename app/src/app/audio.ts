import type { PbpLine } from './pbp';
import { AUDIO_PHRASES } from './pbp';

/** Plan 50: plays the recorded announcer clips and crowd sound under the text announcer. Plain class so it can be tested
 *  with a fake AudioContext, fetch and clock. Nothing in the game ever waits for audio; any failure just stays silent. */

export type Voice = 'classic' | 'modern';
export type LineKind = 'intro' | 'call' | 'delivery' | 'result' | 'recap';
export type Reaction = 'cheer' | 'swell' | 'groan' | 'boo';
export interface VoiceManifest {
  v: number;
  phrases: Record<string, Record<string, string>>;
  dur: Record<string, Record<string, number>>;
  names: Record<string, Record<string, string>>;
  crowd: Record<string, string>;
}

export const CALL_LIMIT_MS = 1350;     // plan 46 C (1.35 s, plan 50 A)
export const CACHE_MAX = 60;           // decoded clips kept (pinned ones not counted)
export const WAIT_MS: Partial<Record<LineKind, number>> = { result: 2000, intro: 1500 };
export const CALL_WAIT_S = 0.3;
export const BED_GAIN = 0.12, FX_GAIN = 0.35, FADE_S = 1, DUCK_S = 0.05;

/** Newest season of the matchup or game picks the voice (plan 43 C). */
export const voiceFor = (newestYear: number): Voice => (newestYear < 1960 ? 'classic' : 'modern');
/** Crowd bed by the same newest season (plan 50 E). */
export const bedFor = (y: number) => (y < 1920 ? 'bed-1901' : y < 1946 ? 'bed-1920' : y < 1980 ? 'bed-1956' : 'bed-1990');
/** Crowd reaction for a result (plan 45 G): never a team, only the play. */
export function reactionFor(outcome: string, o: { error?: boolean; walkOff?: boolean } = {}): Reaction | null {
  if (o.walkOff) return 'swell';
  if (outcome === 'single') return 'cheer';
  if (outcome === 'double' || outcome === 'triple' || outcome === 'hr') return 'swell';
  if (outcome === 'hbp') return 'boo';
  if (outcome === 'bb') return null;
  if (outcome === 'oip' && o.error) return 'cheer';
  return 'groan';   // k, oip (outs, force outs, sac flies, double plays)
}
const seedNum = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export interface VoiceDeps {
  makeContext: () => AudioContext | null;
  fetch: (url: string) => Promise<Response>;
  reduced: () => boolean;
  setTimeout: (fn: () => void, ms: number) => unknown;
}

type Item = { url: string };   // plan 50B: pauses add no time (Test 2: names join the lead-in directly)

export class VoicePlayer {
  private ctx: AudioContext | null = null;
  private manifest: VoiceManifest | null = null;
  private manifestP: Promise<VoiceManifest | null> | null = null;
  private readonly bytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | null>>();
  private readonly decoded = new Map<string, AudioBuffer>();   // insertion order = age (oldest first)
  private readonly pinned = new Map<string, AudioBuffer>();
  private readonly pins = new Set<string>();
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];
  private gen = 0;
  private sources: AudioBufferSourceNode[] = [];
  private fx: AudioBufferSourceNode[] = [];
  private busyUntil = 0;
  private readonly stopped = new WeakSet<AudioBufferSourceNode>();
  private readonly done = new Set<string>();
  private voiceGain: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private fxGain: GainNode | null = null;
  private bed: { name: string; src: AudioBufferSourceNode | null; token: number } | null = null;
  private bedToken = 0;
  /** Test hook (plan 50 F): every clip started, as its url. */
  readonly started: string[] = [];

  constructor(private readonly d: VoiceDeps) {}

  /** The audio context, made on first need (never for visitors with the voice off). */
  private context(): AudioContext | null {
    if (!this.ctx) {
      this.ctx = this.d.makeContext();
      if (this.ctx) {
        const g = (v: number) => { const n = this.ctx!.createGain(); n.gain.value = v; n.connect(this.ctx!.destination); return n; };
        this.voiceGain = g(1); this.bedGain = g(0); this.fxGain = g(FX_GAIN);
      }
    }
    return this.ctx;
  }

  running() { return this.ctx?.state === 'running'; }

  /** Unlock (plan 50 C): call as the FIRST synchronous step of a tap. Resumes the context and plays one silent sample. */
  ensure() {
    const c = this.context();
    if (!c) return;
    try { if (c.state !== 'running') void c.resume().catch(() => undefined); } catch { /* ignore */ }
    try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch { /* ignore */ }
  }

  /** Voice switched on: load the manifest once and decode the lead-up calls and crowd reactions (pinned). */
  enable(): Promise<VoiceManifest | null> {
    if (!this.manifestP) {
      this.manifestP = this.d.fetch('/voice-manifest.json')
        .then(r => (r.ok ? r.text() : ''))
        .then(t => { try { const m = JSON.parse(t) as VoiceManifest; return m && m.v === 1 && m.phrases && m.names ? m : null; } catch { return null; } })
        .catch(() => null)
        .then(m => {
          this.manifest = m;
          if (m && this.context()) {
            for (const v of Object.keys(m.phrases)) for (const k of Object.keys(m.phrases[v])) if (k.startsWith('a.')) this.pin(this.phraseUrl(v as Voice, k)!);
            for (const n of Object.keys(m.crowd)) if (!n.startsWith('bed-')) this.pin(this.crowdUrl(n)!);
          }
          return m;
        });
    }
    return this.manifestP;
  }

  hasVoice() { return !!this.manifest; }
  /** Plan 50B: this player's name clip has played to the end this visit (not cut by Pitch, Skip or leaving). */
  nameHeard(v: Voice, id: string) { const u = this.nameUrl(v, id); return !!u && this.done.has(u); }

  private phraseUrl(v: Voice, k: string) { const h = this.manifest?.phrases[v]?.[k]; return h ? `/audio/p/${v}/${k}.${h}.mp3` : null; }
  private nameUrl(v: Voice, id: string) { const h = this.manifest?.names[v]?.[id]; return h ? `/audio/n/${v}/${id}.${h}.mp3` : null; }
  private crowdUrl(n: string) { const h = this.manifest?.crowd[n]; return h ? `/audio/c/${n}.${h}.mp3` : null; }

  /** Plan 46 C: the call clip to speak for an audio call key, its fallback when the clip is over 1.35 s, or null. */
  callKey(key: string, v: Voice): string | null {
    const m = this.manifest;
    if (!m || !m.phrases[v]?.[key]) return null;
    const dur = m.dur[v] ?? {};
    if ((dur[key] ?? 0) <= CALL_LIMIT_MS) return key;
    const fb = AUDIO_PHRASES[key]?.fallback;
    return fb && m.phrases[v][fb] && (dur[fb] ?? 0) <= CALL_LIMIT_MS ? fb : null;
  }

  /** Clip list for a line, or null when any clip is missing (the whole line is skipped, plan 47 E). */
  items(line: PbpLine, v: Voice): Item[] | null {
    const out: Item[] = [];
    for (const s of line.segs) {
      if ('pause' in s) continue;
      const url = 'p' in s ? this.phraseUrl(v, s.p) : this.nameUrl(v, s.id);
      if (!url) return null;
      out.push({ url });
    }
    return out;
  }

  // ---------- loading ----------
  private slot(): Promise<void> {
    if (this.inFlight < 4) { this.inFlight++; return Promise.resolve(); }
    return new Promise(res => this.waiting.push(() => { this.inFlight++; res(); }));
  }
  private release() { this.inFlight--; const n = this.waiting.shift(); if (n) n(); }

  private load(url: string): Promise<ArrayBuffer | null> {
    let p = this.bytes.get(url);
    if (!p) {
      p = this.slot().then(() => this.d.fetch(url)).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null).finally(() => this.release());
      this.bytes.set(url, p);
      if (this.bytes.size > 400) this.bytes.delete(this.bytes.keys().next().value!);
    }
    return p;
  }

  private buffer(url: string): AudioBuffer | null {
    const b = this.pinned.get(url) ?? this.decoded.get(url) ?? null;
    if (b && this.decoded.has(url)) { this.decoded.delete(url); this.decoded.set(url, b); }   // newest
    return b;
  }

  private decode(url: string): Promise<AudioBuffer | null> {
    const have = this.buffer(url);
    if (have) return Promise.resolve(have);
    let p = this.decoding.get(url);
    if (!p) {
      p = this.load(url).then(buf => {
        const c = this.context();
        return buf && c ? c.decodeAudioData(buf.slice(0)) : null;
      }).then(b => {
        if (b) {
          if (this.pins.has(url)) this.pinned.set(url, b);
          else { this.decoded.set(url, b); while (this.decoded.size > CACHE_MAX) this.decoded.delete(this.decoded.keys().next().value!); }
        }
        return b;
      }).catch(() => null).finally(() => this.decoding.delete(url));
      this.decoding.set(url, p);
    }
    return p;
  }

  private pin(url: string) { this.pins.add(url); void this.decode(url); }

  /** Starts fetching these lines' clips (decode too when soon needed). */
  prefetch(lines: (PbpLine | null | undefined)[], v: Voice, decode = false) {
    if (!this.manifest) return;
    for (const l of lines) {
      if (!l) continue;
      for (const it of this.items(l, v) ?? []) void (decode ? this.decode(it.url) : this.load(it.url));
    }
  }

  /** Clip count in the decoded cache (test hook). */
  cacheSize() { return this.decoded.size; }

  // ---------- speaking ----------
  /** Speak a line under the queue rules (plan 43 C / 50 C). */
  say(line: PbpLine | null | undefined, kind: LineKind, v: Voice): Promise<boolean> {
    if (!line || !this.manifest || !this.ctx) return Promise.resolve(false);
    if (this.d.reduced() && kind !== 'result') return Promise.resolve(false);
    const its = this.items(line, v);
    if (!its) return Promise.resolve(false);
    const urls = its.map(i => i.url);
    const g = this.gen;
    if (urls.every(u => this.buffer(u))) return Promise.resolve(this.play(its, kind));
    const wait = WAIT_MS[kind] ?? 0;
    if (!wait) { urls.forEach(u => void this.decode(u)); return Promise.resolve(false); }
    const all = Promise.all(urls.map(u => this.decode(u)));
    const limit = new Promise<null>(res => this.d.setTimeout(() => res(null), wait));
    return Promise.race([all, limit]).then(() => g === this.gen && urls.every(u => this.buffer(u)) ? this.play(its, kind) : false);
  }

  /** Plan 50C: speak several lines in order. Every clip is decoded first (up to the line kind's wait); then the lines whose
   *  clips are ready are queued one after the other. Resolves true when anything was queued. */
  sayLines(lines: (PbpLine | null | undefined)[], kind: LineKind, v: Voice): Promise<boolean> {
    if (!this.manifest || !this.ctx || (this.d.reduced() && kind !== 'result')) return Promise.resolve(false);
    const sets = lines.filter((l): l is PbpLine => !!l).map(l => this.items(l, v)).filter((x): x is Item[] => !!x);
    const urls = sets.flat().map(i => i.url);
    if (!urls.length) return Promise.resolve(false);
    const g = this.gen;
    const all = Promise.all(urls.map(u => this.decode(u)));
    const limit = new Promise<null>(res => this.d.setTimeout(() => res(null), WAIT_MS[kind] ?? 0));
    return Promise.race([all, limit]).then(() => {
      if (g !== this.gen) return false;
      let any = false;
      for (const its of sets) if (its.every(i => this.buffer(i.url))) any = this.play(its, kind) || any;
      return any;
    });
  }

  /** Plan 50C: resolves when the voice queue is empty, when it was stopped, or after maxMs (checked every 100 ms). */
  idle(maxMs: number): Promise<void> {
    const g = this.gen, c = this.ctx;
    return new Promise(res => {
      let waited = 0;
      const tick = () => {
        if (!c || g !== this.gen || c.currentTime >= this.busyUntil || waited >= maxMs) { res(); return; }
        waited += 100; this.d.setTimeout(tick, 100);
      };
      tick();
    });
  }

  /** Speak a lead-up call by its audio key (alias applied). */
  sayCall(key: string | null | undefined, v: Voice): Promise<boolean> {
    const k = key ? this.callKey(key, v) : null;
    return k ? this.say({ segs: [{ p: k }], mood: 'calm' }, 'call', v) : Promise.resolve(false);
  }

  private play(its: Item[], kind: LineKind): boolean {
    const c = this.ctx;
    if (!c || !this.voiceGain) return false;
    const now = c.currentTime;
    const busy = this.busyUntil > now + 0.01;
    if (busy && kind === 'call' && this.busyUntil - now > CALL_WAIT_S) return false;
    let t = Math.max(now, this.busyUntil);
    const start = t;
    for (const it of its) {
      const b = this.buffer(it.url)!;
      const s = c.createBufferSource();
      s.buffer = b; s.connect(this.voiceGain); s.start(t);
      this.sources.push(s); this.started.push(it.url);
      s.onended = () => {
        this.sources = this.sources.filter(x => x !== s);
        if (!this.stopped.has(s)) this.done.add(it.url);   // plan 50B: played to the end
      };
      t += b.duration;
    }
    this.busyUntil = t;
    this.duck(start, t);
    return true;
  }

  /** The bed dips to half while a voice clip plays. */
  private duck(a: number, b: number) {
    const g = this.bedGain?.gain;
    if (!g || !this.bed) return;
    try {
      g.setValueAtTime(BED_GAIN, a); g.linearRampToValueAtTime(BED_GAIN / 2, a + DUCK_S);
      g.setValueAtTime(BED_GAIN / 2, b); g.linearRampToValueAtTime(BED_GAIN, b + DUCK_S);
    } catch { /* ignore */ }
  }

  /** Stops the voice queue at once (Pitch, Skip, Skip to final, leaving). Waiting lines are dropped. */
  stop() {
    this.gen++;
    for (const s of [...this.sources, ...this.fx]) { this.stopped.add(s); try { s.stop(); } catch { /* not started */ } }
    this.sources = []; this.fx = [];
    this.busyUntil = 0;
    const g = this.bedGain?.gain, c = this.ctx;
    if (g && c && this.bed) { try { g.cancelScheduledValues(c.currentTime); g.setValueAtTime(BED_GAIN, c.currentTime); } catch { /* ignore */ } }
  }

  /** Leaving the flow, voice off or page hidden: voice, reactions and bed. */
  stopAll() { this.stop(); this.bedStop(); }

  // ---------- crowd ----------
  bedStart(name: string) {
    const c = this.ctx, url = this.crowdUrl(name);
    if (!c || !url || !this.bedGain || (this.bed && this.bed.name === name)) return;
    if (this.bed) this.bedStop();
    const token = ++this.bedToken;
    this.bed = { name, src: null, token };
    void this.decode(url).then(b => {
      if (!b || !this.bed || this.bed.token !== token || !this.bedGain) return;
      const [a, z] = loopRange(b);
      const s = c.createBufferSource();
      s.buffer = b; s.loop = true; s.loopStart = a; s.loopEnd = z;
      s.connect(this.bedGain); s.start(c.currentTime, a);
      this.bed.src = s;
      const g = this.bedGain.gain;
      try { g.cancelScheduledValues(c.currentTime); g.setValueAtTime(0, c.currentTime); g.linearRampToValueAtTime(BED_GAIN, c.currentTime + FADE_S); } catch { /* ignore */ }
    });
  }

  bedStop() {
    const c = this.ctx, bed = this.bed;
    this.bed = null; this.bedToken++;
    if (!c || !bed?.src || !this.bedGain) return;
    const g = this.bedGain.gain, src = bed.src;
    try { g.cancelScheduledValues(c.currentTime); g.setValueAtTime(g.value, c.currentTime); g.linearRampToValueAtTime(0, c.currentTime + FADE_S); src.stop(c.currentTime + FADE_S); }
    catch { try { src.stop(); } catch { /* ignore */ } }
  }

  bedName() { return this.bed?.name ?? null; }

  /** A crowd reaction (variant by seed), after a delay in seconds. May overlap the voice. */
  react(r: Reaction | null, seed: string, delay = 0) {
    const c = this.ctx;
    if (!r || !c || !this.fxGain) return;
    const url = this.crowdUrl(`${r}-${1 + (seedNum(seed) % 3)}`);
    const b = url ? this.buffer(url) : null;
    if (!b || !url) return;
    const s = c.createBufferSource();
    s.buffer = b; s.connect(this.fxGain); s.start(c.currentTime + delay);
    this.fx.push(s); this.started.push(url);
    s.onended = () => { this.fx = this.fx.filter(x => x !== s); };
  }
}

/** Loop points with the near-silent edges (encoder padding) cut: first and last sample above -50 dB. */
export function loopRange(b: AudioBuffer): [number, number] {
  const ch = b.getChannelData(0), thr = 0.00316;
  let i = 0, j = ch.length - 1;
  while (i < ch.length && Math.abs(ch[i]) < thr) i++;
  while (j > i && Math.abs(ch[j]) < thr) j--;
  return j > i ? [i / b.sampleRate, (j + 1) / b.sampleRate] : [0, b.duration];
}

function browserDeps(): VoiceDeps {
  return {
    makeContext: () => {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const C = g.AudioContext ?? g.webkitAudioContext;
      if (!C) return null;
      try {
        const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (s) { try { s.type = 'ambient'; } catch { /* ignore */ } }
        return new C();
      } catch { return null; }
    },
    fetch: (u: string) => fetch(u),
    reduced: () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
}

/** The one player for the app. */
export const voice = new VoicePlayer(browserDeps());
// Plan 50 F: test hook (the browser check reads voice.started).
if (typeof window !== 'undefined') (window as unknown as { __prVoice?: VoicePlayer }).__prVoice = voice;
