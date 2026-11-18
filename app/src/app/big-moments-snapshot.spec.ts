import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BallparkView } from './ballpark-view';
import { Call, callFor, countFor, OutcomeKey } from './logic';
import { Frame, FxWord, PitchScene, SceneCue } from './pitch-scene';
import { BIG_SNAPSHOT } from './big-moments-snapshot.data';

/** Plan 73 A7: wall-clock snapshot of today's scenes (cue times, end time, and a hash of every drawn value sampled
 *  every 10 ms of wall time). Taken on c5cbfdd before any Plan 73 change; after the change every case runs with
 *  bigMoments ON (except "hr-off") and must match exactly: the slow window touches only a non-ITP home run's final pitch. */
export const SNAP_BIG = true;

interface Case { name: string; outcome: OutcomeKey; seed: string; year: number; side: boolean; windup: boolean; big: boolean; leadOnly?: boolean; }

function hrSeed(year: number, itp: boolean): string {
  for (let i = 0; i < 5000; i++) {
    const s = `z${i}`, c = callFor('hr', s, countFor('hr', s, '3'), 'Babe Ruth', 'R', 'R', '3', year);
    if (!!c.insideTheParkHr === itp && countFor('hr', s, '3').leadUp.length >= 2) return s;
  }
  throw new Error('no seed');
}

export const SNAP_CASES: Case[] = [
  ...(['k', 'bb', 'hbp', 'single', 'double', 'triple', 'oip'] as OutcomeKey[]).map(o => ({ name: o, outcome: o, seed: `s-${o}`, year: 1927, side: true, windup: false, big: SNAP_BIG })),
  { name: 'hr-leadups', outcome: 'hr', seed: hrSeed(1927, false), year: 1927, side: true, windup: false, big: SNAP_BIG, leadOnly: true },
  { name: 'hr-itp', outcome: 'hr', seed: hrSeed(1910, true), year: 1910, side: true, windup: false, big: SNAP_BIG },
  { name: 'windup-double', outcome: 'double', seed: 's-wd', year: 1927, side: true, windup: true, big: SNAP_BIG },
  { name: 'windup-hr-leadups', outcome: 'hr', seed: hrSeed(1927, false), year: 1927, side: true, windup: true, big: SNAP_BIG, leadOnly: true },
  { name: 'text-only-hr', outcome: 'hr', seed: hrSeed(1927, false), year: 1927, side: false, windup: false, big: SNAP_BIG },
  { name: 'hr-off', outcome: 'hr', seed: hrSeed(1927, false), year: 1927, side: true, windup: false, big: false },
];

/** Timing and motion only: the word's text, color and plate change by design (Plan 73 A3), its motion must not. */
function pickWord(w: FxWord | null | undefined) { return w ? [w.x, w.y, w.size, w.rot, w.scale, w.o] : null; }
function pickFrame(f: Frame) { return [f.ball, f.batter, f.fx.lines, f.fx.burst ?? null, f.fx.smear ?? null, f.fx.shake, pickWord(f.fx.word)]; }

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Test art: 8 frames, the contact frame at cell x 288 (about where real art makes contact), bat tip on frame 2. */
export function testSide() {
  const frames = Array.from({ length: 8 }, (_, i) => (i === 3 ? { contact: [288, 230] } : i === 2 ? { batTip: [150, 170] } : {}));
  return { sheet: '/s.webp', frames, lineArt: false } as never;
}

export async function runCase(k: Case): Promise<{ cues: string[]; end: number; hash: string; n: number }> {
  const draws: number[] = [];
  const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(function (this: unknown, t: number) { draws.push(t); });
  try {
    const f = TestBed.createComponent(PitchScene);
    const count = countFor(k.outcome, k.seed, '3');
    const call: Call = callFor(k.outcome, k.seed, count, 'Babe Ruth', 'R', 'R', '3', k.year);
    const inputs: Record<string, unknown> = { era: '1920-1945', outcome: k.outcome, seed: k.seed, deco: '3', call, look: '1920' };
    if ('bigMoments' in (f.componentInstance as object)) inputs['bigMoments'] = k.big;
    for (const [n, v] of Object.entries(inputs)) f.componentRef.setInput(n, v);
    if (k.side) {
      f.componentRef.setInput('side', testSide());
      f.componentRef.setInput('fielders', { sheet: '/f.webp', cell: [180, 210], footY: 205, era: '1920-1945' });
      if (k.windup) f.componentRef.setInput('windup', { sheet: '/w.webp', mirror: false });
    }
    const t0 = performance.now();
    const cues: string[] = [];
    let end = -1;
    f.componentInstance.cue.subscribe((c: SceneCue) => cues.push(`${c.index}:${c.moment}:${Math.round(performance.now() - t0)}`));
    f.componentInstance.done.subscribe(() => { end = Math.round(performance.now() - t0); });
    f.detectChanges();
    const c = f.componentInstance as unknown as { frame(): unknown; windFrame(): number; parkFade(): number; parkWord(): unknown; parkShake(): number; board(): unknown; step(): number };
    const lead = count.leadUp.length;
    const samples: string[] = [];
    for (let ms = 0; ms < 15000 && end < 0; ms += 10) {
      await vi.advanceTimersByTimeAsync(10);
      if (k.leadOnly && c.step() >= lead) break;
      f.detectChanges();
      samples.push(JSON.stringify([c.step(), pickFrame(c.frame() as Frame), c.windFrame(), c.parkFade(), pickWord(c.parkWord() as FxWord | null), c.parkShake(), c.board(), draws.length ? draws[draws.length - 1] : null]));
    }
    if (k.leadOnly) { const i = cues.findIndex(x => x.startsWith(`${lead}:`)); if (i >= 0) cues.length = i; }
    f.destroy();
    return { cues, end: k.leadOnly ? -1 : end, hash: fnv(samples.join('|')), n: samples.length };
  } finally { spy.mockRestore(); }
}

describe('plan 73 snapshot (wall clock)', () => {
  it('every case matches the c5cbfdd snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const got: Record<string, unknown> = {};
      for (const k of SNAP_CASES) got[k.name] = await runCase(k);
      if (!BIG_SNAPSHOT) { expect(JSON.stringify(got)).toBe('RECORD ME'); return; }
      for (const k of SNAP_CASES) expect(got[k.name], k.name).toEqual(BIG_SNAPSHOT[k.name]);
    } finally { vi.useRealTimers(); }
  }, 120000);
});
