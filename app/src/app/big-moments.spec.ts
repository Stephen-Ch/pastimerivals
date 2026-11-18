import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BallparkView } from './ballpark-view';
import { callFor, countFor, OutcomeKey } from './logic';
import { buildPlay } from './park';
import { parkOn } from './park-setting';
import { fxWord, LEAD_TL, motionFor, parkTiming, PitchScene, planPitch, plateBox, punchWave, ringAt, SceneCue, shakePx, shakeUnit, shakeWave, wordAt, WINDUP_S, windupFrameAt } from './pitch-scene';
import { sceneT, slowWindow, wallFor } from './scene-clock';

/** Same test art as the snapshot: contact at cell x 288 (real art), bat tip on frame 2. */
function testSide() {
  const frames = Array.from({ length: 8 }, (_, i) => (i === 3 ? { contact: [288, 230] } : i === 2 ? { batTip: [150, 170] } : {}));
  return { sheet: '/s.webp', frames, lineArt: false } as never;
}

const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as ('setTimeout' | 'clearTimeout' | 'performance' | 'requestAnimationFrame' | 'cancelAnimationFrame')[] };

function hrSeed(): string {
  for (let i = 0; i < 5000; i++) {
    const s = `b${i}`, c = callFor('hr', s, countFor('hr', s, '3'), 'Babe Ruth', 'R', 'R', '3', 1927);
    if (!c.insideTheParkHr) return s;
  }
  throw new Error('no seed');
}

function mount(o: OutcomeKey, seed: string, big: boolean, windup = false) {
  const f = TestBed.createComponent(PitchScene);
  const count = countFor(o, seed, '3');
  const call = callFor(o, seed, count, 'Babe Ruth', 'R', 'R', '3', 1927);
  for (const [k, v] of Object.entries({ era: '1920-1945', outcome: o, seed, deco: '3', call, look: '1920', bigMoments: big })) f.componentRef.setInput(k, v);
  f.componentRef.setInput('side', testSide());
  f.componentRef.setInput('fielders', { sheet: '/f.webp', cell: [180, 210], footY: 205, era: '1920-1945' });
  if (windup) f.componentRef.setInput('windup', { sheet: '/w.webp', mirror: false });
  // the scene's real final plan (contact from the test art: cell 288 -> panel 228)
  const pl = planPitch({ m: motionFor(o, count.finalKind), kind: null, isFinal: true, outcome: o, era: '1920-1945', bats: 'R', call,
    contact: { x: 228, y: 230 }, seed, index: count.leadUp.length, windup, tip: { x: 90, y: 170 }, ...(big ? { big: true } : {}) });
  const pk = parkTiming(pl, buildPlay({ outcome: o, call, play: null, seed, look: '1920' }))!;
  return { f, count, call, pl, pk };
}

describe('plan 73 big moments: words', () => {
  it('HOME RUN! for a big non-ITP home run, DOUBLE!/TRIPLE! where CRACK! was, the rest unchanged', () => {
    expect(fxWord('hr', 'hit', 'fly', false, true)).toEqual(['HOME', 'RUN!']);
    expect(fxWord('hr', 'hit', 'line', true, true)).toEqual(['CRACK!']);
    expect(fxWord('double', 'hit', 'line', false, true)).toEqual(['DOUBLE!']);
    expect(fxWord('triple', 'hit', 'fly', false, true)).toEqual(['TRIPLE!']);
    expect(fxWord('double', 'hit', 'bloop', false, true)).toBeNull();
    expect(fxWord('single', 'hit', 'line', false, true)).toEqual(['CRACK!']);
    expect(fxWord('k', 'look', null, false, true)).toEqual(['STRIKE', 'THREE!']);
    expect(fxWord('hr', 'hit', 'fly', false)).toEqual(['GONE!']);
  });

  it('plate box: hand numbers', () => {
    expect(plateBox(['HOME', 'RUN!'], 88)).toEqual({ x: -(4 * 88 * 0.62 + 44) / 2, y: -88 * 0.035 - (88 * 2.07) / 2, w: 4 * 88 * 0.62 + 44, h: 88 * 2.07 });
    const b = plateBox(['DOUBLE!'], 62);
    expect(b.w).toBeCloseTo(7 * 62 * 0.62 + 31, 9);
    expect(b.h).toBeCloseTo(62 * 1.12, 9);
  });

  it('big HR word is 88 on a plate; K gets a plate and a punch; walks have no plate', () => {
    const { pl } = mount('hr', hrSeed(), true);
    const w = wordAt(pl, pl.exitT + 1, pl.exitT + 3)!;
    expect(w.lines).toEqual(['HOME', 'RUN!']);
    expect(w.size).toBe(88);
    expect(w.plate).toBeDefined();
    const k = mount('k', 'pk1', true).pl;
    const w0 = Math.max(k.p.tTarget + 0.2, k.exitT + 0.02);
    expect(punchWave(k, w0 + 0.06)).toBeCloseTo(1, 9);
    expect(punchWave(k, w0 + 0.13)).toBe(0);
    expect(wordAt(k, w0 + 0.06, w0 + 2)!.plate).toBeDefined();
    const bb = mount('bb', 'pb1', true).pl;
    expect(wordAt(bb, bb.exitT + 0.5, bb.exitT + 2)?.plate).toBeUndefined();
  });
});

describe('plan 73 big moments: slow window in the scene', () => {
  beforeEach(() => parkOn.set(true));
  afterEach(() => parkOn.set(true));

  it('end fires within [wallFor(end), +50 ms]; the field view draws scene time; the shake keeps wall speed; swell delay 0.875', async () => {
    vi.useFakeTimers(FAKE);
    const draws: [number, number][] = [];   // [play time drawn, performance.now() of that frame]
    const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(function (this: unknown, t: number) { draws.push([t, performance.now()]); });
    try {
      const seed = hrSeed(), { f, count, pl, pk } = mount('hr', seed, true);
      const w = slowWindow({ isFinal: true, outcome: 'hr', motion: 'hit', itp: false, tPark: pk.tPark }, true, true)!;
      expect(pl.p.tTarget - pk.tPark).toBeLessThan(0.03);   // real-art contact: at the plate (inside the window)
      const cues: SceneCue[] = [];
      let doneAt = -1;
      f.componentInstance.cue.subscribe(c => cues.push(c));
      f.componentInstance.done.subscribe(() => { doneAt = performance.now(); });
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
      const t0 = performance.now();   // the final pitch starts now (no windup)
      const c = f.componentInstance as unknown as { parkShake(): number; parkWord(): { lines: string[] } | null; fit(): unknown };
      // three hand-picked wall times inside and after the window: the drawn play time is sceneT(wall) - tPark
      for (const wallS of [pk.tPark + 0.2, pk.tPark + 0.6, pk.tPark + 1.5]) {
        await vi.advanceTimersByTimeAsync(Math.round((t0 + wallS * 1000) - performance.now()));
        f.detectChanges();
        const [drawn, at] = draws[draws.length - 1];
        expect(drawn).toBeCloseTo(Math.min(pk.play.len, sceneT((at - t0) / 1000, w) - pk.tPark), 6);
      }
      expect(draws[draws.length - 1][0]).toBeLessThan(1.5);   // slowed: 1.5 wall s after the park took over, less than 1.5 play s has passed
      const plate = cues.find(x => x.final && x.moment === 'plate')!;
      expect(plate.swellDelay).toBeCloseTo(0.875, 9);
      expect(c.parkWord()?.lines).toEqual(['HOME', 'RUN!']);
      // ends at wallFor(end) (within one 16 ms frame and a timer tick)
      await vi.advanceTimersByTimeAsync(10000);
      const expectEnd = t0 + wallFor(pk.end, w) * 1000;
      expect(doneAt).toBeGreaterThanOrEqual(expectEnd - 1);
      expect(doneAt).toBeLessThanOrEqual(expectEnd + 50);
      expect(wallFor(pk.end, w) - pk.end).toBeCloseTo(0.57, 9);
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  }, 30000);

  it('shake amplitude at wall tTarget + 0.1 equals today\'s at scene tTarget + 0.1', async () => {
    vi.useFakeTimers(FAKE);
    let lastFrame = 0;
    const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => { lastFrame = performance.now(); });
    try {
      const { f, count, pl, pk } = mount('hr', hrSeed(), true);
      const w = slowWindow({ isFinal: true, outcome: 'hr', motion: 'hit', itp: false, tPark: pk.tPark }, true, true)!;
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
      const t0 = performance.now();
      const at = t0 + (wallFor(pl.p.tTarget, w) + 0.1) * 1000;
      // step 1 ms at a time so the frame lands exactly on the target wall time
      while (performance.now() < at - 0.5) await vi.advanceTimersByTimeAsync(1);
      f.detectChanges();
      const c = f.componentInstance as unknown as { parkShake(): number };
      const wall = (lastFrame - t0) / 1000;   // the time of the frame on screen
      const want = shakePx(shakeWave(pl, pl.p.tTarget + (wall - wallFor(pl.p.tTarget, w))), shakeUnit(null));
      expect(c.parkShake()).toBeCloseTo(want, 6);
      expect(Math.abs(want)).toBeGreaterThan(0);
      expect(Math.abs(shakePx(shakeWave(pl, pl.p.tTarget + 0.1), shakeUnit(null)) - want)).toBeLessThan(0.6);   // same point of the wave (to one 16 ms frame)
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  }, 30000);

  it('windup frames are not slowed', async () => {
    vi.useFakeTimers(FAKE);
    const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined);
    try {
      const { f, count } = mount('hr', hrSeed(), true, true);
      f.detectChanges();
      const leadMs = (LEAD_TL.end - (LEAD_TL.enter - 0.03) + WINDUP_S) * 1000 + 60;
      await vi.advanceTimersByTimeAsync(count.leadUp.length * leadMs);
      const t0 = performance.now();
      const c = f.componentInstance as unknown as { windFrame(): number };
      for (const ms of [50, 200, 400, 550]) {
        await vi.advanceTimersByTimeAsync(Math.round(t0 + ms - performance.now()));
        f.detectChanges();
        expect(c.windFrame()).toBe(windupFrameAt((performance.now() - t0) / 1000));
      }
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  }, 30000);

  it('no window with Follow the ball off, or with big moments off: end at today\'s time', async () => {
    for (const [big, follow] of [[true, false], [false, true]] as [boolean, boolean][]) {
      vi.useFakeTimers(FAKE);
      parkOn.set(follow);
      const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined);
      try {
        const { f, count, pl, pk } = mount('hr', hrSeed(), big);
        let doneAt = -1;
        const cues: SceneCue[] = [];
        f.componentInstance.cue.subscribe(c => cues.push(c));
        f.componentInstance.done.subscribe(() => { doneAt = performance.now(); });
        f.detectChanges();
        await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
        const t0 = performance.now();
        await vi.advanceTimersByTimeAsync(10000);
        const end = follow ? pk.end : pl.tl.end;
        expect(doneAt - t0).toBeGreaterThanOrEqual(end * 1000 - 1);
        expect(doneAt - t0).toBeLessThanOrEqual(end * 1000 + 50);
        expect(cues.find(x => x.final && x.moment === 'plate')!.swellDelay).toBeUndefined();
      } finally { spy.mockRestore(); vi.useRealTimers(); parkOn.set(true); }
    }
  }, 30000);

  it('flash ring: from 0.12 to 0.24 play s after the park takes over, fading', () => {
    const ball = { x: 100, y: 50, r: 6 };
    expect(ringAt(0.11, ball)).toBeNull();
    expect(ringAt(0.24, ball)).toBeNull();
    expect(ringAt(0.12, ball)).toEqual({ x: 100, y: 50, r: 15, o: 1 });
    expect(ringAt(0.18, ball)!.o).toBeCloseTo(0.5, 9);
    expect(ringAt(0.18, null)).toBeNull();
  });

  it('the ring shows in the scene during its window, outside the park layer', async () => {
    vi.useFakeTimers(FAKE);
    const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined);
    const bs = vi.spyOn(BallparkView.prototype, 'ballScreen').mockImplementation(() => ({ x: 300, y: 200, r: 5, w: 640, h: 480 }));
    try {
      const { f, count, pk } = mount('hr', hrSeed(), true);
      const w = slowWindow({ isFinal: true, outcome: 'hr', motion: 'hit', itp: false, tPark: pk.tPark }, true, true)!;
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
      const t0 = performance.now();
      await vi.advanceTimersByTimeAsync(Math.round(wallFor(pk.tPark + 0.18, w) * 1000));
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('svg.ring circle')).not.toBeNull();
      expect(el.querySelector('.park svg.ring')).toBeNull();
      await vi.advanceTimersByTimeAsync(Math.round(t0 + wallFor(pk.tPark + 0.3, w) * 1000 - performance.now()));
      f.detectChanges();
      expect(el.querySelector('svg.ring')).toBeNull();
    } finally { spy.mockRestore(); bs.mockRestore(); vi.useRealTimers(); }
  }, 30000);

  it('Skip inside the slow window: ring cleared, done once, no late finish timer', async () => {
    vi.useFakeTimers(FAKE);
    const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined);
    const bs = vi.spyOn(BallparkView.prototype, 'ballScreen').mockImplementation(() => ({ x: 300, y: 200, r: 5, w: 640, h: 480 }));
    try {
      const { f, count, pk } = mount('hr', hrSeed(), true);
      const w = slowWindow({ isFinal: true, outcome: 'hr', motion: 'hit', itp: false, tPark: pk.tPark }, true, true)!;
      let done = 0;
      const cues: string[] = [];
      f.componentInstance.done.subscribe(() => done++);
      f.componentInstance.cue.subscribe(c => cues.push(c.moment));
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
      await vi.advanceTimersByTimeAsync(Math.round(wallFor(pk.tPark + 0.18, w) * 1000));
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('svg.ring')).not.toBeNull();
      f.componentInstance.finish();
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('svg.ring')).toBeNull();
      await vi.advanceTimersByTimeAsync(10000);
      expect(done).toBe(1);
      expect(cues.filter(m => m === 'end' || m === 'skipped')).toEqual(['skipped']);
    } finally { spy.mockRestore(); bs.mockRestore(); vi.useRealTimers(); }
  }, 30000);

  it('the even-scale word box is used only for plated words (CRACK! on a single keeps today\'s 760 x 480 box)', async () => {
    for (const [o, plated] of [['single', false], ['hr', true]] as [OutcomeKey, boolean][]) {
      vi.useFakeTimers(FAKE);
      const spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined);
      try {
        let seed = o === 'hr' ? hrSeed() : '';
        if (!seed) for (let i = 0; i < 500 && !seed; i++) { const s = `sg${i}`, c = callFor('single', s, countFor('single', s, '3'), 'Babe Ruth', 'R', 'R', '3', 1927); if (c.trajectory && c.trajectory !== 'bloop') seed = s; }
        const { f, count, pk } = mount(o, seed, true);
        f.detectChanges();
        (f.componentInstance as unknown as { stageSize: { set(v: [number, number]): void } }).stageSize.set([390, 506]);   // after the first render (jsdom measures 0)
        f.detectChanges();
        await vi.advanceTimersByTimeAsync(count.leadUp.length * (LEAD_TL.end * 1000 + 60));
        let vb: string | null = null;
        for (let k = 0; k < 400 && !vb; k++) { await vi.advanceTimersByTimeAsync(10); f.detectChanges(); vb = (f.nativeElement as HTMLElement).querySelector('.park svg.words')?.getAttribute('viewBox') ?? null; }
        expect(vb, o).not.toBeNull();
        if (plated) expect(vb).not.toBe('0 0 760 480'); else expect(vb).toBe('0 0 760 480');
        expect(pk).not.toBeNull();
      } finally { spy.mockRestore(); vi.useRealTimers(); }
    }
  }, 30000);
});
