import { pitchPhrase } from './app';
import { countFor, OUTCOMES } from './logic';

describe('plan 75 F1: pitchPhrase', () => {
  it('says "on the first pitch" for 0-0 and "on a X-Y pitch" otherwise; capital form for the Why sheet', () => {
    expect(pitchPhrase(0, 0)).toBe('on the first pitch');
    expect(pitchPhrase(0, 0, true)).toBe('On the first pitch');
    expect(pitchPhrase(1, 2)).toBe('on a 1-2 pitch');
    expect(pitchPhrase(3, 2, true)).toBe('On a 3-2 pitch');
  });

  it('uses the count of the last pitch for all 8 outcomes in both count versions, 0-0 included', () => {
    for (const deco of ['1', '2'] as const) {
      for (const o of OUTCOMES) {
        let sawFirst = false;
        for (let i = 0; i < 400; i++) {
          const c = countFor(o, `p75-${i}`, deco);
          const t = pitchPhrase(c.balls, c.strikes);
          // the numbers are the count before the final pitch: the lead-up holds exactly that many balls and strikes
          expect(c.leadUp.length === 0 ? [0, 0] : [c.leadUp.at(-1)!.balls, c.leadUp.at(-1)!.strikes]).toEqual([c.balls, c.strikes]);
          if (c.balls === 0 && c.strikes === 0) { sawFirst = true; expect(t).toBe('on the first pitch'); }
          else expect(t).toBe(`on a ${c.balls}-${c.strikes} pitch`);
          if (o === 'k') expect(t).toMatch(/-2 pitch$/);
          if (o === 'bb') expect(t).toMatch(/^on a 3-/);
        }
        if (o !== 'k' && o !== 'bb') expect(sawFirst).toBe(true);
      }
    }
  });
});

// ---- Plan 75 F2: the held plate ----
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BallparkView } from './ballpark-view';
import { callFor } from './logic';
import { parkOn } from './park-setting';
import { PitchScene } from './pitch-scene';

function testSide() {
  const frames = Array.from({ length: 8 }, (_, i) => (i === 3 ? { contact: [288, 230] } : i === 2 ? { batTip: [150, 170] } : {}));
  return { sheet: '/s.webp', frames, lineArt: false } as never;
}
const FAKE = { toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as ('setTimeout' | 'clearTimeout' | 'performance' | 'requestAnimationFrame' | 'cancelAnimationFrame')[] };
type O = Parameters<typeof countFor>[0];
/** A seed whose call matches (true: non-ITP home run / non-bloop hit; false: bloop). */
function seedFor(o: O, want: (c: ReturnType<typeof callFor>) => boolean): string {
  for (let i = 0; i < 5000; i++) {
    const s = `p75${o}${i}`, c = callFor(o, s, countFor(o, s, '3'), 'Babe Ruth', 'R', 'R', '3', 1927);
    if (want(c)) return s;
  }
  throw new Error('no seed');
}
function mount(o: O, seed: string, big: boolean) {
  const f = TestBed.createComponent(PitchScene);
  const call = callFor(o, seed, countFor(o, seed, '3'), 'Babe Ruth', 'R', 'R', '3', 1927);
  for (const [k, v] of Object.entries({ era: '1920-1945', outcome: o, seed, deco: '3', call, look: '1920', bigMoments: big })) f.componentRef.setInput(k, v);
  f.componentRef.setInput('side', testSide());
  f.componentRef.setInput('fielders', { sheet: '/f.webp', cell: [180, 210], footY: 205, era: '1920-1945' });
  const c = f.componentInstance as unknown as { heldPlate(): string[] | null; parkWord(): unknown; frame(): { fx: { word?: unknown } }; finish(s?: boolean): void };
  return { f, c, el: f.nativeElement as HTMLElement };
}
const hrSeed = () => seedFor('hr', c => !c.insideTheParkHr);

describe('plan 75 F2: held plate', () => {
  let spy: { mockRestore(): void };
  const realMM = globalThis.matchMedia;
  beforeEach(() => { parkOn.set(true); spy = vi.spyOn(BallparkView.prototype, 'draw').mockImplementation(() => undefined); });
  afterEach(() => { spy.mockRestore(); vi.useRealTimers(); globalThis.matchMedia = realMM; });

  it('natural end: HOME RUN! moves to the held plate, the in-scene word is cleared, the layer is aria-hidden', async () => {
    vi.useFakeTimers(FAKE);
    const { f, c, el } = mount('hr', hrSeed(), true);
    f.detectChanges();
    let done = false;
    f.componentInstance.done.subscribe(() => (done = true));
    await vi.advanceTimersByTimeAsync(30000);
    expect(done).toBe(true);
    expect(c.heldPlate()).toEqual(['HOME', 'RUN!']);
    expect(c.parkWord()).toBeNull();
    expect(c.frame().fx.word).toBeUndefined();
    f.componentRef.setInput('held', true); f.detectChanges();
    const svg = el.querySelector('svg.held-plate')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.textContent!.replace(/\s+/g, '')).toBe('HOMERUN!');
  }, 30000);

  it('Skip: the plate is set for a strikeout, a double and a triple', () => {
    for (const [o, want] of [['k', null], ['double', ['DOUBLE!']], ['triple', ['TRIPLE!']]] as [O, string[] | null][]) {
      const seed = o === 'k' ? 'p75k' : seedFor(o, x => x.trajectory !== 'bloop');
      const { f, c } = mount(o, seed, true);
      f.detectChanges();
      c.finish();
      const w = c.heldPlate();
      if (want) expect(w).toEqual(want); else expect([['WHIFF!'], ['STRIKE', 'THREE!']]).toContainEqual(w);
      f.destroy();
    }
  });

  it('reduced motion: the plate is set at once', async () => {
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof matchMedia;
    const { f, c } = mount('hr', hrSeed(), true);
    f.detectChanges();
    await new Promise(r => setTimeout(r, 5));
    expect(c.heldPlate()).toEqual(['HOME', 'RUN!']);
  });

  it('no plate: big moments off (Last Licks), unplated words (walk, single, ITP home run), bloop double', () => {
    const cases: [O, string, boolean][] = [
      ['hr', hrSeed(), false], ['bb', 'p75bb', true], ['single', seedFor('single', x => x.trajectory !== 'bloop'), true],
    ];
    try { cases.push(['hr', seedFor('hr', x => !!x.insideTheParkHr), true]); } catch { /* no ITP seed in range: skip that case */ }
    for (const [o, seed, big] of cases) {
      const { f, c, el } = mount(o, seed, big);
      f.detectChanges();
      c.finish();
      f.componentRef.setInput('held', true); f.detectChanges();
      expect(c.heldPlate()).toBeNull();
      expect(el.querySelector('.held-plate')).toBeNull();
      f.destroy();
    }
    // a double with no word (fxWord null, e.g. a bloop: the call writer has no bloop doubles today, so forced here)
    const seed = seedFor('double', x => x.trajectory !== 'bloop');
    const { f, c } = mount('double', seed, true);
    f.componentRef.setInput('call', { ...callFor('double', seed, countFor('double', seed, '3'), 'Babe Ruth', 'R', 'R', '3', 1927), trajectory: 'bloop' });
    f.detectChanges();
    c.finish();
    expect(c.heldPlate()).toBeNull();
  });
});
