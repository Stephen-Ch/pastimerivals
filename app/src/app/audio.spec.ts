import { bedFor, CACHE_MAX, loopRange, reactionFor, VoiceManifest, VoicePlayer, voiceFor } from './audio';
import { intro, PbpLine } from './pbp';

/** Plan 50 F: the voice player with a fake AudioContext, fetch and timers. */
class FakeParam { value = 0; setValueAtTime() { return this; } linearRampToValueAtTime() { return this; } cancelScheduledValues() { return this; } }
class FakeCtx {
  currentTime = 0; state = 'suspended'; destination = {};
  starts: { url?: string; t: number; dur: number }[] = [];
  nodes: any[] = [];
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return { gain: new FakeParam(), connect() { /* */ } }; }
  createBuffer(_c: number, len: number, sr: number) { return { duration: len / sr, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  createBufferSource() {
    const ctx = this;
    const n = { buffer: null as any, loop: false, loopStart: 0, loopEnd: 0, onended: null as any, connect() { /* */ },
      start(t = 0) { if (this.buffer?.url) ctx.starts.push({ url: this.buffer.url, t, dur: this.buffer.duration }); }, stop() { this.onended?.(); } };
    this.nodes.push(n);
    return n;
  }
  /** Ends every started clip that was not stopped (as the browser does at its end time). */
  endAll() { for (const n of this.nodes) if (n.buffer?.url && !n.ended) { n.ended = true; n.onended?.(); } }
  decodeAudioData(buf: ArrayBuffer) {
    const s = new TextDecoder().decode(buf);
    const [url, dur] = s.split('|');
    return Promise.resolve({ url, duration: Number(dur), sampleRate: 100, getChannelData: () => new Float32Array(10) } as any);
  }
}

const M: VoiceManifest = {
  v: 1,
  phrases: { classic: { 'lead.b.now': 'aa', 'r.k': 'bb', 'a.ball.1': 'cc', 'a.swing.2': 'dd', 'a.strike.2': 'ee', 'a.still': 'ff' }, modern: { 'r.k': 'bb' } },
  dur: { classic: { 'a.ball.1': 1100, 'a.swing.2': 1940, 'a.strike.2': 1320, 'a.still': 1700 }, modern: {} },
  names: { classic: { ruthb101: '11' }, modern: {} },
  crowd: { 'cheer-1': 'c1', 'cheer-2': 'c2', 'cheer-3': 'c3', 'bed-1920': 'b2' },
};

function setup(opts: { manifest?: string; reduced?: boolean; durs?: Record<string, number>; hold?: Set<string> } = {}) {
  const ctx = new FakeCtx();
  const fetched: string[] = [];
  const timers: (() => void)[] = [];
  const held = new Map<string, () => void>();
  const p = new VoicePlayer({
    makeContext: () => ctx as unknown as AudioContext,
    reduced: () => !!opts.reduced,
    setTimeout: (fn) => { timers.push(fn); return 0; },
    fetch: (url: string) => {
      fetched.push(url);
      if (url === '/voice-manifest.json') return Promise.resolve({ ok: true, text: () => Promise.resolve(opts.manifest ?? JSON.stringify(M)) } as Response);
      const body = new TextEncoder().encode(`${url}|${opts.durs?.[url] ?? 1}`).buffer;
      const res = { ok: true, arrayBuffer: () => Promise.resolve(body) } as Response;
      if (opts.hold?.has(url)) return new Promise<Response>(r => held.set(url, () => r(res)));
      return Promise.resolve(res);
    },
  });
  return { p, ctx, fetched, timers, held };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const L = (...segs: PbpLine['segs']): PbpLine => ({ segs, mood: 'calm' });
const INTRO = L({ p: 'lead.b.now' }, { pause: 0.2 }, { name: 'Babe Ruth', id: 'ruthb101' });
const RESULT = L({ p: 'r.k' });

describe('VoicePlayer (plan 50)', () => {
  it('fetches nothing before it is enabled, and a bad manifest means no voice and no error', async () => {
    const a = setup();
    expect(a.fetched).toEqual([]);
    const b = setup({ manifest: '<!doctype html><html>' });
    await b.p.enable(); b.p.ensure();
    expect(b.p.hasVoice()).toBe(false);
    expect(await b.p.say(RESULT, 'result', 'classic')).toBe(false);
  });

  it('unlock resumes the context', () => {
    const { p, ctx } = setup();
    p.ensure();
    expect(ctx.state).toBe('running');
  });

  it('plays a line clip by clip with its pause, and skips a line with a missing name', async () => {
    const { p, ctx } = setup();
    await p.enable(); p.ensure();
    p.prefetch([INTRO], 'classic', true); await flush();
    expect(await p.say(INTRO, 'intro', 'classic')).toBe(true);
    expect(ctx.starts.map(s => s.t)).toEqual([0, 1]);   // plan 50B: no added pause
    expect(await p.say(L({ p: 'lead.b.now' }, { name: 'Nobody', id: 'nobod001' }), 'intro', 'classic')).toBe(false);
  });

  it('plan 50B: a real intro line (PAUSE_NAME 350) plays the name right after the lead-in', async () => {
    const x = intro({ key: 'k', index: 0, batter: { id: 'ruthb101', name: 'Babe Ruth' }, pitcher: { id: 'nobod001', name: 'Nobody' }, showPitcher: false, pitchingSide: null, situation: null }, null);
    expect(x.batter.segs.some(s => 'pause' in s)).toBe(true);
    const key = (x.batter.segs[0] as { p: string }).p;
    const m2 = { ...M, phrases: { ...M.phrases, classic: { ...M.phrases['classic'], [key]: 'zz' } } };
    const b = setup({ manifest: JSON.stringify(m2) });
    await b.p.enable(); b.p.ensure();
    expect(b.p.items(x.batter, 'classic')?.length).toBe(2);   // the pause is not a clip
    b.p.prefetch([x.batter], 'classic', true); await flush();
    expect(await b.p.say(x.batter, 'intro', 'classic')).toBe(true);
    expect(b.ctx.starts.map(s => s.t)).toEqual([0, 1]);
  });

  it('plan 50B: a name counts as heard only when it played to the end', async () => {
    const a = setup();
    await a.p.enable(); a.p.ensure();
    a.p.prefetch([INTRO], 'classic', true); await flush();
    await a.p.say(INTRO, 'intro', 'classic');
    expect(a.p.nameHeard('classic', 'ruthb101')).toBe(false);
    a.p.stop();   // Pitch tapped before the end
    a.ctx.endAll();
    expect(a.p.nameHeard('classic', 'ruthb101')).toBe(false);
    await a.p.say(INTRO, 'intro', 'classic');
    a.ctx.endAll();
    expect(a.p.nameHeard('classic', 'ruthb101')).toBe(true);
  });

  it('plan 50C: sayLines plays lines in order once all are decoded, even when the second decodes first', async () => {
    const hold = new Set(['/audio/p/classic/lead.b.now.aa.mp3']);
    const { p, ctx, held } = setup({ hold });
    await p.enable(); p.ensure();
    p.prefetch([RESULT], 'classic', true); await flush();
    const said = p.sayLines([INTRO, RESULT], 'intro', 'classic');
    await flush();
    held.get('/audio/p/classic/lead.b.now.aa.mp3')!(); await flush();
    expect(await said).toBe(true);
    expect(ctx.starts.map(s => s.url)).toEqual(['/audio/p/classic/lead.b.now.aa.mp3', '/audio/n/classic/ruthb101.11.mp3', '/audio/p/classic/r.k.bb.mp3']);
    expect(ctx.starts.map(s => s.t)).toEqual([0, 1, 2]);
  });

  it('plan 50C: idle waits for the queue, ends at once on stop, and at maxMs at the latest', async () => {
    const { p, ctx, timers } = setup();
    await p.enable(); p.ensure();
    p.prefetch([RESULT], 'classic', true); await flush();
    await p.say(RESULT, 'result', 'classic');   // busy until 1 s
    let done = false;
    const w = p.idle(5000).then(() => { done = true; });
    timers.shift()!(); await flush();
    expect(done).toBe(false);
    ctx.currentTime = 1.01; timers.shift()!(); await w;
    expect(done).toBe(true);
    await p.say(RESULT, 'result', 'classic');
    let d2 = false; const w2 = p.idle(5000).then(() => { d2 = true; });
    p.stop(); timers.shift()!(); await w2; expect(d2).toBe(true);
    await p.say(RESULT, 'result', 'classic');
    let d3 = false; const w3 = p.idle(200).then(() => { d3 = true; });
    timers.shift()!(); await flush(); expect(d3).toBe(false);
    timers.shift()!(); await w3; expect(d3).toBe(true);   // frozen clock: ends at the cap (200 ms)
  });

  it('a missing name in one voice skips only that intro line', async () => {
    const { p } = setup();
    await p.enable(); p.ensure();
    expect(p.items(INTRO, 'modern')).toBeNull();
    expect(p.items(RESULT, 'modern')).not.toBeNull();
  });

  it('speaks a call fallback when the call clip is over 1.35 s, else the call itself', async () => {
    const { p } = setup();
    await p.enable();
    expect(p.callKey('a.ball.1', 'classic')).toBe('a.ball.1');
    expect(p.callKey('a.swing.2', 'classic')).toBe('a.strike.2');
    expect(p.callKey('a.still', 'classic')).toBeNull();   // its fallback a.fouloff is not in this manifest
    expect(p.callKey('a.ball.1', 'modern')).toBeNull();
  });

  it('queue: a call waits up to 0.3 s then is dropped; results wait; two voice clips never overlap', async () => {
    const { p, ctx } = setup();
    await p.enable(); p.ensure();
    p.prefetch([RESULT, INTRO], 'classic', true); await flush();
    await p.say(RESULT, 'result', 'classic');            // 0 - 1
    ctx.currentTime = 0.5;
    expect(await p.sayCall('a.ball.1', 'classic')).toBe(false);   // 0.5 s left: dropped
    ctx.currentTime = 0.8;
    expect(await p.sayCall('a.ball.1', 'classic')).toBe(true);    // 0.2 s left: waits
    expect(await p.say(RESULT, 'result', 'classic')).toBe(true);  // after the call
    const s = ctx.starts;
    for (let i = 1; i < s.length; i++) expect(s[i].t).toBeGreaterThanOrEqual(s[i - 1].t + s[i - 1].dur - 1e-9);
  });

  it('stop drops waiting lines and clears the queue', async () => {
    const hold = new Set(['/audio/p/classic/r.k.bb.mp3']);
    const { p, ctx, timers, held } = setup({ hold });
    await p.enable(); p.ensure();
    const said = p.say(RESULT, 'result', 'classic');
    p.stop();
    await flush();
    held.get('/audio/p/classic/r.k.bb.mp3')!(); await flush();
    timers.forEach(t => t());
    expect(await said).toBe(false);
    expect(ctx.starts.filter(s => s.url?.includes('r.k'))).toEqual([]);
  });

  it('an undecoded call is skipped; an undecoded result waits up to 2 s (reduced motion, early Skip)', async () => {
    const hold = new Set(['/audio/p/classic/r.k.bb.mp3', '/audio/p/classic/a.ball.1.cc.mp3']);
    const a = setup({ hold });
    await a.p.enable(); a.p.ensure();
    expect(await a.p.sayCall('a.ball.1', 'classic')).toBe(false);
    const late = a.p.say(RESULT, 'result', 'classic');
    await flush();
    a.held.get('/audio/p/classic/r.k.bb.mp3')!(); await flush();
    expect(await late).toBe(true);
    const b = setup({ hold: new Set(['/audio/p/classic/r.k.bb.mp3']) });
    await b.p.enable(); b.p.ensure();
    const never = b.p.say(RESULT, 'result', 'classic');
    await flush(); b.timers.forEach(t => t());
    expect(await never).toBe(false);
  });

  it('reduced motion: only result lines', async () => {
    const { p } = setup({ reduced: true });
    await p.enable(); p.ensure();
    p.prefetch([INTRO, RESULT], 'classic', true); await flush();
    expect(await p.say(INTRO, 'intro', 'classic')).toBe(false);
    expect(await p.say(RESULT, 'result', 'classic')).toBe(true);
  });

  it('keeps at most 60 decoded clips, and the pinned calls stay', async () => {
    const names: Record<string, string> = {};
    for (let i = 0; i < 90; i++) names['p' + String(i).padStart(7, '0')] = 'h' + i;
    const big = { ...M, names: { classic: names, modern: {} } };
    const { p } = setup({ manifest: JSON.stringify(big) });
    await p.enable(); p.ensure(); await flush();
    p.prefetch(Object.keys(names).map(id => L({ name: id, id })), 'classic', true); await flush();
    expect(p.cacheSize()).toBeLessThanOrEqual(CACHE_MAX);
    expect(await p.sayCall('a.ball.1', 'classic')).toBe(true);
  });

  it('crowd: reactions by outcome and seed; the bed by season', async () => {
    expect(reactionFor('single')).toBe('cheer'); expect(reactionFor('hr')).toBe('swell'); expect(reactionFor('k')).toBe('groan');
    expect(reactionFor('oip')).toBe('groan'); expect(reactionFor('oip', { error: true })).toBe('cheer'); expect(reactionFor('hbp')).toBe('boo');
    expect(reactionFor('bb')).toBeNull(); expect(reactionFor('single', { walkOff: true })).toBe('swell');
    expect(bedFor(1919)).toBe('bed-1901'); expect(bedFor(1920)).toBe('bed-1920'); expect(bedFor(1946)).toBe('bed-1956'); expect(bedFor(1980)).toBe('bed-1990');
    const { p, ctx } = setup();
    await p.enable(); p.ensure(); await flush();
    p.react('cheer', 'seed-1', 0.3);
    expect(ctx.starts.some(s => s.url?.startsWith('/audio/c/cheer-') && s.t === 0.3)).toBe(true);
    p.bedStart('bed-1920'); await flush();
    expect(p.bedName()).toBe('bed-1920');
    p.stopAll();
    expect(p.bedName()).toBeNull();
  });

  it('voice by the newest season', () => {
    expect(voiceFor(1959)).toBe('classic');
    expect(voiceFor(1960)).toBe('modern');
  });

  it('loop range cuts near-silent edges', () => {
    const d = new Float32Array(100); for (let i = 10; i < 90; i++) d[i] = 0.5;
    expect(loopRange({ getChannelData: () => d, sampleRate: 100, duration: 1 } as unknown as AudioBuffer)).toEqual([0.1, 0.9]);
  });
});
