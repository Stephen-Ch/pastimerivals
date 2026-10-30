import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { fielderArt, SideLook } from './art';
import { BallparkView } from './ballpark-view';
import { Call, callFor, countFor, OutcomeKey, PlayFacts } from './logic';
import { BASE1, BASE2, ballAt, buildPlay, cameraAt, dist, fielderAt, hasPark, MAX_TILT, MAX_TURN, ParkPlay, polar, project, wallDist, ZONE } from './park';
import { W, H } from './park-draw';
import { FINAL_TL, LEAD_TL, PitchScene, planPitch, SceneCue, motionFor } from './pitch-scene';

const LOOKS: SideLook[] = ['1901', '1920', '1956', '1990'];
const OUTS: PlayFacts[] = [
  { outType: 'ground', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'ground', doublePlay: true, sacFly: false, forceRunner: null },
  { outType: 'ground', doublePlay: false, sacFly: false, forceRunner: 'Ruth' },
  { outType: 'fly', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'fly', doublePlay: false, sacFly: true, forceRunner: null },
  { outType: 'line', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'line', doublePlay: true, sacFly: false, forceRunner: null },
  { outType: 'line', doublePlay: false, sacFly: false, forceRunner: null, tagged: true },
  { outType: 'pop', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'error', doublePlay: false, sacFly: false, forceRunner: null },
];
interface Case { outcome: OutcomeKey; call: Call; play: PlayFacts | null; seed: string; look: SideLook; }
function cases(n: number): Case[] {
  const out: Case[] = [];
  const hits: OutcomeKey[] = ['single', 'double', 'triple', 'hr'];
  for (let i = 0; i < n; i++) {
    const seed = `s${i}`, look = LOOKS[i % 4], bats = i % 3 === 0 ? 'L' : 'R';
    for (const o of [...hits, 'oip' as OutcomeKey]) {
      for (const deco of ['1', '2'] as const) {
        const call = callFor(o, seed, countFor(o, seed, deco), 'Babe Ruth', bats, 'R', deco, 1927);
        if (hasPark(o, call)) out.push({ outcome: o, call, play: null, seed, look });
      }
    }
    const pf = OUTS[i % OUTS.length];
    const call = callFor('oip', seed, countFor('oip', seed, '3'), 'Babe Ruth', bats, 'R', '3', 1927, pf);
    out.push({ outcome: 'oip', call, play: pf, seed, look });
    if (i % 5 === 0) out.push({ outcome: 'hr', call: { ...callFor('hr', seed, countFor('hr', seed, '2'), 'X', bats, 'R', '2', 1927), insideTheParkHr: true }, play: null, seed, look });
  }
  return out;
}
const ALL = cases(160);
const build = (c: Case) => buildPlay({ outcome: c.outcome, call: c.call, play: c.play, seed: c.seed, look: c.look });
const inZone = (p: ParkPlay) => {
  const z = ZONE[p.named!], [d, a] = polar(p.touch!);
  if (p.named === 'C') return dist(p.touch!, [0, 0]) <= 60;
  return a >= z.a[0] - 0.01 && a <= z.a[1] + 0.01 && d >= z.d[0] - 25 && d <= z.d[1];
};

describe('Plan 44: where the ball goes', () => {
  it('covers every kind of play', () => {
    const kinds = new Set(ALL.map(c => build(c).kind));
    for (const k of ['hr', 'itp', 'xbh', 'single', 'fly', 'line', 'pop', 'foul', 'ground', 'dp', 'force', 'error']) expect(kinds.has(k as never), k).toBe(true);
  });

  it('outs land inside the named fielder\'s zone, and the named fielder is the one at the ball', () => {
    for (const c of ALL) {
      if (c.outcome !== 'oip') continue;
      const p = build(c);
      expect(p.named, c.call.text).not.toBeNull();
      if (p.kind !== 'error') expect(inZone(p), `${c.call.text} ${p.touch}`).toBe(true);
      const f = p.fielders.find(x => x.pos === p.named)!;
      expect(dist(fielderAt(f, p.touchT).at, p.touch!), c.call.text).toBeLessThan(4);
      if (c.call.fielder && c.call.fielder !== 'P') expect(p.named).toBe(c.call.fielder === 'P' ? 'SS' : c.call.fielder);
    }
  });

  it('the pitcher never catches a pop; catcher pops and fouls straight back land 5-15 ft behind the plate', () => {
    for (const c of ALL) {
      const p = build(c);
      if (p.kind === 'pop' || p.kind === 'foul') expect(p.named).not.toBe('P');
      if (p.noTurn) { expect(p.named).toBe('C'); expect(p.touch![1]).toBeLessThanOrEqual(-5); expect(p.touch![1]).toBeGreaterThanOrEqual(-15); }
      if (p.kind === 'foul' && p.named !== 'C') expect(Math.abs(polar(p.touch!)[1])).toBeGreaterThan(45);   // foul ground
    }
  });

  it('home runs clear the wall; extra-base hits reach the wall; hits fall in front of the outfielder', () => {
    for (const c of ALL) {
      const p = build(c), end = ballAt(p, p.len), [d, a] = polar([end[0], end[1]]);
      if (p.kind === 'hr') { expect(d).toBeGreaterThan(wallDist(a) + 9); expect(d).toBeLessThan(wallDist(a) + 61); }
      if (p.kind === 'xbh' || p.kind === 'itp') expect(d).toBeGreaterThan(wallDist(a) - 15);
      if (p.kind === 'single') {
        expect(d).toBeGreaterThan(150);
        const of = p.fielders[0];
        expect(polar(p.touch!)[0]).toBeLessThan(polar(of.start)[0] + 1);
      }
    }
  });

  it('the right man covers first and second', () => {
    for (const c of ALL) {
      const p = build(c), at = (pos: string, t: number) => fielderAt(p.fielders.find(f => f.pos === pos)!, t).at;
      const last = p.segs[p.segs.length - 1].t0;
      if (p.kind === 'ground') {
        const cov = p.named === '1B' ? (p.fielders.length === 1 ? '1B' : 'P') : '1B';
        expect(dist(at(cov, last), BASE1), c.call.text).toBeLessThan(4);
      }
      if (p.kind === 'dp' && c.call.type === 'ground') {
        const cov = p.named === 'SS' || p.named === '3B' ? '2B' : 'SS';
        expect(p.fielders.some(f => f.pos === cov)).toBe(true);
        expect(dist(at('1B', p.len), BASE1), c.call.text).toBeLessThan(4);
        const t2 = p.segs.find(s => dist(s.b, BASE2) < 3)!.t1;
        expect(dist(at(cov, t2), BASE2), c.call.text).toBeLessThan(4);
      }
      if (p.kind === 'force') expect(p.fielders.some(f => f.pos === (p.named === 'SS' || p.named === '3B' ? '2B' : 'SS'))).toBe(true);
    }
  });

  it('only the fielders in the play are drawn', () => {
    for (const c of ALL) {
      const p = build(c), n = p.fielders.length;
      if (['hr', 'itp', 'xbh', 'single', 'fly', 'pop', 'foul', 'error'].includes(p.kind)) expect(n, p.kind).toBe(1);
      if (p.kind === 'line') expect(n).toBe(1);
      if (p.kind === 'ground' || p.kind === 'force') expect(n).toBeLessThanOrEqual(2);
      if (p.kind === 'dp') expect(n).toBeLessThanOrEqual(3);
      expect(new Set(p.fielders.map(f => f.pos)).size).toBe(n);
    }
  });

  it('same seed, same path; speed never below 1x', () => {
    for (const c of ALL.slice(0, 120)) { const a = build(c), b = build(c); expect(a).toEqual(b); expect(a.speed).toBeGreaterThanOrEqual(1); }
  });

  it('fixed scene lengths by play type', () => {
    const want: Record<string, number[]> = { hr: [2.4], itp: [2.2], xbh: [2.2], single: [1.6], fly: [2.2], pop: [2.6], foul: [2.2, 2.6], ground: [2.0], force: [2.0], error: [2.0], dp: [2.4, 1.6], line: [1.0, 1.6] };
    for (const c of ALL) { const p = build(c); expect(want[p.kind], p.kind).toContain(p.len); }
  });
});

describe('Plan 44: camera', () => {
  const frames = (p: ParkPlay) => Array.from({ length: Math.round(p.len * 30) + 1 }, (_, i) => Math.min(p.len, i / 30));
  it('turn never over 100 degrees, tilt never over 75; straight-back pops never turn', () => {
    for (const c of ALL) {
      const p = build(c);
      for (const t of frames(p)) {
        const cam = cameraAt(p, t, W / H);
        expect(Math.abs(cam.yaw)).toBeLessThanOrEqual(MAX_TURN);
        expect(cam.pitch).toBeLessThanOrEqual(MAX_TILT);
        if (p.noTurn) expect(cam.yaw).toBe(0);
      }
    }
  });

  it('the ball stays inside the frame from contact to the end (grid of seeds)', () => {
    for (const c of ALL) {
      const p = build(c);
      for (const t of frames(p)) {
        const b = ballAt(p, t), s = project(cameraAt(p, t, W / H), W, H, b[0], b[1], b[2]);
        expect(s, `${p.kind} t=${t}`).not.toBeNull();
        expect(s![0], `${p.kind} ${c.call.text} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![0]).toBeLessThanOrEqual(W);
        expect(s![1], `${p.kind} ${c.call.text} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![1]).toBeLessThanOrEqual(H);
      }
    }
  });

  it('the fielder is in frame at the catch or pick-up', () => {
    for (const c of ALL) {
      const p = build(c);
      if (!p.touch || !p.named || p.noTurn) continue;
      const f = fielderAt(p.fielders.find(x => x.pos === p.named)!, p.touchT);
      const s = project(cameraAt(p, p.touchT, W / H), W, H, f.at[0], f.at[1], 3);
      expect(s, p.kind).not.toBeNull();
      expect(s![0]).toBeGreaterThan(0); expect(s![0]).toBeLessThan(W);
      expect(s![1], `${p.kind} ${c.call.text}`).toBeGreaterThan(0); expect(s![1]).toBeLessThan(H);
    }
  });

  it('the wall base and the grass edge are the same points, so they meet at every zoom', () => {
    const p = build(ALL[0]);
    for (const fov of [70, 40, 22]) {
      const cam = { ...cameraAt(p, 1, W / H), fov };
      const a = project(cam, W, H, ...([0, wallDist(0)] as [number, number]), 0)!, b = project(cam, W, H, 0, wallDist(0), 0)!;
      expect(Math.abs(a[1] - b[1])).toBeLessThan(1);
    }
  });

  it('canvas is never larger than the panel x 2 in each direction', () => {
    expect(BallparkView.canvasSize(560, 354, 3)).toEqual([1120, 708]);
    expect(BallparkView.canvasSize(320, 202, 1)).toEqual([320, 202]);
  });
});

describe('Plan 44: art and scene', () => {
  it('fielders use the sheet for the pitcher\'s era', () => {
    const m = { cell: [1, 1] as [number, number], frames: 8, sheets: {}, cards: {}, tones: {}, fielder: { cell: [180, 210] as [number, number], footY: 205, sheets: { '1920-1945': '/f20.webp', '1990-2025': '/f90.webp' } } };
    expect(fielderArt(m, '1920-1945')?.sheet).toBe('/f20.webp');
    expect(fielderArt(m, '1990-2025')?.sheet).toBe('/f90.webp');
    expect(fielderArt(m, '1970-1989')).toBeNull();
    expect(fielderArt(null, '1990-2025')).toBeNull();
  });

  function mount(outcome: OutcomeKey, seed: string, opts: { side?: boolean; fielders?: boolean } = {}) {
    const f = TestBed.createComponent(PitchScene);
    const frames = Array.from({ length: 8 }, () => ({}));
    const call = callFor(outcome, seed, countFor(outcome, seed, '3'), 'Babe Ruth', 'R', 'R', '3', 1927);
    f.componentRef.setInput('era', '1990-2025');
    f.componentRef.setInput('outcome', outcome);
    f.componentRef.setInput('seed', seed);
    f.componentRef.setInput('deco', '3');
    f.componentRef.setInput('call', call);
    f.componentRef.setInput('look', '1956');
    if (opts.side !== false) f.componentRef.setInput('side', { sheet: '/s.webp', frames, lineArt: false });
    if (opts.fielders !== false) f.componentRef.setInput('fielders', { sheet: '/f.webp', cell: [180, 210], footY: 205, era: '1990-2025' });
    return { f, call };
  }

  it('park view takes over at the plate cue, ends at the formula time, and fires park after plate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const seed = 'g7', { f, call } = mount('hr', seed);
      const cues: SceneCue['moment'][] = [];
      let done = 0;
      f.componentInstance.cue.subscribe(c => { if (c.final) cues.push(c.moment); });
      f.componentInstance.done.subscribe(() => done++);
      f.detectChanges();
      const count = countFor('hr', seed, '3');
      const lead = count.leadUp.length;
      const leadMs = LEAD_TL.end * 1000 + 60;
      const pl = planPitch({ m: motionFor('hr', count.finalKind), kind: null, isFinal: true, outcome: 'hr', era: '1990-2025', bats: 'R', call, contact: { x: 372, y: 200 }, seed, index: lead });
      const play = buildPlay({ outcome: 'hr', call, play: null, seed, look: '1956' });
      const total = lead * leadMs + Math.max(FINAL_TL.end, pl.p.tPlate + play.len) * 1000;
      await vi.advanceTimersByTimeAsync(total - 40);
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('.park')).not.toBeNull();
      expect(done).toBe(0);
      await vi.advanceTimersByTimeAsync(80);
      expect(done).toBe(1);
      expect(cues.indexOf('park')).toBeGreaterThan(cues.indexOf('plate'));
    } finally { vi.useRealTimers(); }
  });

  it('impact word shows on the park view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const { f } = mount('hr', 'w3');
      f.detectChanges();
      const count = countFor('hr', 'w3', '3');
      await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60) + 1500);
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('.park .words text')?.textContent).toContain('GONE!');
    } finally { vi.useRealTimers(); }
  });

  it('no park view without the batter art, without fielder art, or on a strikeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      for (const [o, opts] of [['hr', { side: false }], ['hr', { fielders: false }], ['k', {}]] as [OutcomeKey, { side?: boolean; fielders?: boolean }][]) {
        const { f } = mount(o, 'n1', opts);
        f.detectChanges();
        await vi.advanceTimersByTimeAsync(12000);
        f.detectChanges();
        expect((f.nativeElement as HTMLElement).querySelector('.park')).toBeNull();
        f.destroy();
      }
    } finally { vi.useRealTimers(); }
  });
});

// Plan 59 Round 1a: determinism golden. Same seed, same pitch plan and same park play (camera, fielders, ball path).
// Later rounds may not add random draws to camera or backdrop code.
describe('plan 59 determinism golden', () => {
  const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const ERAS = ['1901-1919', '1920-1945', '1946-1969', '1970-1989', '1990-2025'] as const;
  const DECOS = ['1', '2', '3'] as const;
  const TYPES = ['ground', 'fly', 'line', 'pop'] as const;

  function determinismGolden(): { hash: string; plays: number } {
    const out: string[] = [];
    let plays = 0;
    for (let i = 0; i < 2000; i++) {
      const o: OutcomeKey = (['k', 'bb', 'hbp', 'single', 'double', 'triple', 'hr', 'oip'] as const)[i % 8];
      const deco = DECOS[i % 3], seed = `d${i}`, bats: 'L' | 'R' = i % 2 ? 'L' : 'R';
      const count = countFor(o, seed, deco);
      const t = TYPES[(i >> 3) % 4];
      const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: i % 7 === 0 && t === 'ground', sacFly: false, forceRunner: null } : null;
      const call = callFor(o, seed, count, 'Batter X', bats, 'R', deco, 1900 + (i % 125), facts);
      const m = motionFor(o, count.finalKind);
      const pl = planPitch({ m, kind: o === 'bb' ? 'ball' : null, isFinal: true, outcome: o, era: ERAS[i % 5], bats, call, contact: { x: 372, y: 200 }, seed, index: count.leadUp.length, windup: i % 2 === 0 });
      out.push(JSON.stringify(pl));
      if (hasPark(o, call)) { out.push(JSON.stringify(buildPlay({ outcome: o, call, play: facts, seed, look: LOOKS[i % 4] }))); plays++; }
    }
    return { hash: fnv(out.join('|')), plays };
  }

  it('planPitch and buildPlay over 2,000 seeds are unchanged', { timeout: 20_000 }, () => {
    const t0 = performance.now();
    const g = determinismGolden();
    const ms = performance.now() - t0;
    console.log(`plan 59 determinism golden: ${ms.toFixed(0)} ms`);
    expect(g).toEqual({ hash: '45e17105', plays: 1250 });
    expect(ms).toBeLessThan(5000);
  });
});
