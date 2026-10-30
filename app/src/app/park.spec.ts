import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { fielderArt, SideLook } from './art';
import { BallparkView } from './ballpark-view';
import { Call, callFor, countFor, OutcomeKey, PlayFacts } from './logic';
import { BASE1, BASE2, ballAt, buildPlay, cameraAt, dist, fielderAt, hasPark, MAX_TILT, MAX_TURN, ParkPlay, PLATE_MID, polar, project, projectF, RUBBER, SIDE_F, sideCamera, skyOnly, wallDist, WINDUP_F, WINDUP_FOOT, windupCamera, windupSpriteH, ZONE } from './park';
import { W, H } from './park-draw';
import { FINAL_TL, FOOT_Y, LEAD_TL, PANEL_W, PitchScene, planPitch, PLATE_X, SceneCue, motionFor, stageFit } from './pitch-scene';

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

  it('plan 59 r1b test 3: fitScale is one uniform scale, painter height 480, width 480 x aspect', () => {
    for (const a of [0.6, 0.77, 1, 1.58, 2.2]) {
      const cssH = 400, cssW = cssH * a, f = BallparkView.fitScale(cssW, cssH);
      expect(f.h).toBe(480); expect(f.w).toBeCloseTo(480 * a, 9);
      expect(f.w * f.k).toBeCloseTo(cssW, 9); expect(f.h * f.k).toBeCloseTo(cssH, 9);
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

// Plan 59 Round 1b test 1 (characterize): at today's 760:480 panel the camera is unchanged. The card allowed changes on
// sky-only frames for a sky fix; none was needed (only pops and fouls go sky-only, and they are exempt), so every frame is hashed.
describe('plan 59 r1b: camera unchanged at the 760:480 panel', () => {
  const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  it('hash of cameraAt(p, t, 760/480) over every frame of the grid (no sky fix was built, so nothing may change)', () => {
    const out: string[] = [];
    let sky = 0, n = 0;
    for (const c of ALL) {
      const p = build(c);
      for (let i = 0; i <= Math.round(p.len * 30); i++) {
        const t = Math.min(p.len, i / 30), cam = cameraAt(p, t, W / H);
        n++;
        if (skyOnly(cam, W / H, p.look)) sky++;
        out.push(`${cam.yaw},${cam.pitch},${cam.fov}`);
      }
    }
    console.log(`plan 59 r1b test 1: ${n} frames, ${sky} sky-only`);
    expect({ hash: fnv(out.join('|')), kept: out.length }).toEqual({ hash: '1d9a19ad', kept: 114226 });   // hash taken on 72545a1's cameraAt
  });
});

// Plan 59 Round 1b test 5: no frame run of only sky over 0.3 s (pops and high fouls exempt: the ball wins), at a portrait
// stage (0.75) and today's panel (1.58), painter width 480 x aspect. Ball and fielder stay in frame at 0.75 too.
describe('plan 59 r1b: camera at any stage shape', () => {
  const MANY = cases(500).map(build);
  const frames = (p: ParkPlay) => Array.from({ length: Math.round(p.len * 30) + 1 }, (_, i) => Math.min(p.len, i / 30));
  it('no sky-only run over 0.3 s except pops and fouls, aspects 0.75 and 1.58', { timeout: 30_000 }, () => {
    const bad: string[] = [];
    for (const aspect of [0.75, 760 / 480]) for (const p of MANY) {
      if (p.kind === 'pop' || p.kind === 'foul') continue;
      let run = 0, worst = 0;
      for (const t of frames(p)) { run = skyOnly(cameraAt(p, t, aspect), aspect, p.look) ? run + 1 : 0; worst = Math.max(worst, run); }
      if (worst / 30 > 0.3) bad.push(`${aspect.toFixed(2)} ${p.kind} ${(worst / 30).toFixed(2)}s`);
    }
    expect(bad.length, bad.slice(0, 8).join('; ')).toBe(0);
  });
  it('the ball stays inside the frame at 0.75 (painter 360 x 480)', () => {
    const w = 480 * 0.75;
    for (const c of ALL) {
      const p = build(c);
      for (const t of frames(p)) {
        const b = ballAt(p, t), s = project(cameraAt(p, t, 0.75), w, 480, b[0], b[1], b[2]);
        expect(s, `${p.kind} t=${t}`).not.toBeNull();
        expect(s![0], `${p.kind} ${c.call.text} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![0], `${p.kind} t=${t}`).toBeLessThanOrEqual(w);
        expect(s![1], `${p.kind} ${c.call.text} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![1]).toBeLessThanOrEqual(480);
      }
    }
  });
  it('the fielder is in frame at the catch or pick-up at 0.75', () => {
    const w = 480 * 0.75;
    for (const c of ALL) {
      const p = build(c);
      if (!p.touch || !p.named || p.noTurn) continue;
      const f = fielderAt(p.fielders.find(x => x.pos === p.named)!, p.touchT);
      const s = project(cameraAt(p, p.touchT, 0.75), w, 480, f.at[0], f.at[1], 3);
      expect(s, p.kind).not.toBeNull();
      expect(s![0], `${p.kind} ${c.call.text}`).toBeGreaterThan(0); expect(s![0]).toBeLessThan(w);
      expect(s![1], `${p.kind} ${c.call.text}`).toBeGreaterThan(0); expect(s![1]).toBeLessThan(480);
    }
  });
});

// Review fix (Part A): on narrow stages the lens never goes past 70 degrees vertical or 80 horizontal (no fisheye on pops
// hit straight back); the camera turns a little instead, so the ball stays in frame (Stephen: on pops the ball wins).
describe('plan 59 r1b: lens limits on narrow stages', () => {
  const frames = (p: ParkPlay) => Array.from({ length: Math.round(p.len * 30) + 1 }, (_, i) => Math.min(p.len, i / 30));
  const vdeg = (fov: number, a: number) => 2 * Math.atan(Math.tan((fov * Math.PI) / 360) / a) * 180 / Math.PI;
  it('vertical at most 70, horizontal at most 80, ball in frame, at aspects 0.6, 0.75 and 1.5834', { timeout: 30_000 }, () => {
    for (const a of [0.6, 0.75, 1.5834]) {
      const w = 480 * a;
      for (const c of ALL) {
        const p = build(c);
        for (const t of frames(p)) {
          const cam = cameraAt(p, t, a), b = ballAt(p, t), s = project(cam, w, 480, b[0], b[1], b[2]);
          expect(cam.fov, `${a} ${p.kind} t=${t}`).toBeLessThanOrEqual(80 + 1e-9);
          expect(vdeg(cam.fov, a), `${a} ${p.kind} t=${t}`).toBeLessThanOrEqual(70 + 1e-9);
          expect(s, `${a} ${p.kind} t=${t}`).not.toBeNull();
          expect(s![0], `${a} ${p.kind} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![0], `${a} ${p.kind} t=${t}`).toBeLessThanOrEqual(w);
          expect(s![1], `${a} ${p.kind} t=${t}`).toBeGreaterThanOrEqual(0); expect(s![1], `${a} ${p.kind} t=${t}`).toBeLessThanOrEqual(480);
        }
      }
    }
  });
});

// Plan 59 Round 1b test 4: view cameras for the backdrops. Through stageFit the side camera puts the plate on the panel's
// (PLATE_X, FOOT_Y), righty and lefty; the windup camera puts the rubber on the windup foot line; the side view's horizon
// sits in the top third of the stage on phones. (The windup camera's horizon is set by its own numbers: 20 ft back,
// 5.5 ft up, 6.5 degrees, sprite feet at 92%; it lands near 32% of the stage and is not part of the top-third check.)
describe('plan 59 r1b test 4: view cameras', () => {
  const sidePlace = (w: number, h: number, m: boolean) => {
    const f = stageFit(w, h, m), cam = sideCamera(m);
    return { f, cam, F: SIDE_F * f.s, cx: f.left + 380 * f.s, cy: f.top + 240 * f.s };
  };
  it('side camera: the plate within 2% of (PLATE_X, FOOT_Y) at 358x506, 288x341 and 900x540, righty and lefty', () => {
    for (const [w, h] of [[358, 506], [288, 341], [900, 540]]) for (const m of [false, true]) {
      const { f, cam, F, cx, cy } = sidePlace(w, h, m);
      const p = projectF(cam, F, cx, cy, PLATE_MID.x, PLATE_MID.y, PLATE_MID.z)!;
      const ex = f.left + (m ? PANEL_W - PLATE_X : PLATE_X) * f.s, ey = f.top + FOOT_Y * f.s;
      expect(Math.abs(p[0] - ex), `${w}x${h} ${m} x`).toBeLessThanOrEqual(0.02 * w);
      expect(Math.abs(p[1] - ey), `${w}x${h} ${m} y`).toBeLessThanOrEqual(0.02 * h);
    }
  });
  it('lefties get the third-base-side view (a real view, not a mirror): the camera stands at x < 0', () => {
    expect(sideCamera(false).pos!.x).toBeGreaterThan(30);
    expect(sideCamera(true).pos!.x).toBeLessThan(-30);
  });
  it('windup camera: the rubber within 2% of the windup foot line, centered, at 358x506, 288x313 and 437x324', () => {
    for (const [w, h] of [[358, 506], [288, 313], [437, 324]]) {
      const p = projectF(windupCamera(), WINDUP_F * h, w / 2, h / 2, RUBBER.x, RUBBER.y, RUBBER.z)!;
      expect(Math.abs(p[1] - WINDUP_FOOT * h), `${w}x${h}`).toBeLessThanOrEqual(0.02 * h);
      expect(Math.abs(p[0] - w / 2)).toBeLessThanOrEqual(0.02 * w);
    }
    const body = windupSpriteH() * (468 - 61) / 480;   // standing pose: cell y 61 to 468
    expect(body).toBeGreaterThanOrEqual(0.62); expect(body).toBeLessThanOrEqual(0.76);
  });
  it('side view horizon in the top third of the stage at 390x844 (stage 358x506) and 320x568 (stage 288x313)', () => {
    for (const [w, h] of [[358, 506], [288, 313]]) for (const m of [false, true]) {
      const { cam, F, cy } = sidePlace(w, h, m);
      expect(cy + F * Math.tan((cam.pitch * Math.PI) / 180), `${w}x${h} ${m}`).toBeLessThan(h / 3);
    }
  });
});
