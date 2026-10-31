import { TestBed } from '@angular/core/testing';
import { Era, SideLook } from './art';
import { callFor, countFor, Deco, OUTCOMES, PlayFacts } from './logic';
import { buildPlay, hasPark } from './park';
import { LOOKS } from './park-draw';
import { leadMotion, motionFor, parkTiming, PitchScene, planPitch, WINDUP_S, ENTER_X, FOOT_Y, PANEL_H, PANEL_W, STAGE_MAX_ASPECT, StageFit, stageFit } from './pitch-scene';

describe('pitch scene', () => {
  it('maps every outcome to the planned motion', () => {
    expect(motionFor('k')).toBe('miss');
    expect(motionFor('k', 'called')).toBe('look');
    expect(motionFor('bb')).toBe('take');
    expect(motionFor('hbp')).toBe('hbp');
    expect(motionFor('oip')).toBe('out');
    for (const o of ['single', 'double', 'triple', 'hr'] as const) expect(motionFor(o)).toBe('hit');
    expect(leadMotion('ball')).toBe('take');
    expect(leadMotion('foul')).toBe('foul');
  });

  it('emits done only once, even when Skip is tapped twice', async () => {
    const f = TestBed.createComponent(PitchScene);
    f.componentRef.setInput('era', '1990-2025');
    f.componentRef.setInput('outcome', 'hr');
    f.componentRef.setInput('seed', 'x');
    let n = 0;
    f.componentInstance.done.subscribe(() => n++);
    await f.whenStable();
    const skip = (f.nativeElement as HTMLElement).querySelector('button.skip') as HTMLButtonElement;
    skip.click(); skip.click();
    f.componentInstance.finish();
    expect(n).toBe(1);
    expect((f.nativeElement as HTMLElement).querySelector('.scene button')).toBeNull();   // no nested buttons
  });

  it('goes straight to the result with reduced motion', async () => {
    const orig = globalThis.matchMedia;
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof matchMedia;
    try {
      const f = TestBed.createComponent(PitchScene);
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'k');
      let n = 0;
      f.componentInstance.done.subscribe(() => n++);
      await new Promise(r => setTimeout(r, 5));
      expect(n).toBe(1);
    } finally { globalThis.matchMedia = orig; }
  });
});

// Plan 59 Round 2a: the count leaves the scene for the shared scoreboard. It is sent once per change, at plate moments only.
describe('plan 59 r2a board output', () => {
  const make = () => {
    const f = TestBed.createComponent(PitchScene);
    f.componentRef.setInput('era', '1990-2025');
    f.componentRef.setInput('outcome', 'k');
    f.componentRef.setInput('seed', 'b');
    const got: string[] = [];
    f.componentInstance.boardChange.subscribe(b => got.push(`${b.balls}-${b.strikes}`));
    return { f, got };
  };
  it('setBoard sends each new count once; the same count again sends nothing', () => {
    const { f, got } = make();
    f.componentInstance.setBoard(1, 0, 'Ball');
    f.componentInstance.setBoard(1, 0, 'Ball');
    f.componentInstance.setBoard(1, 1, 'Foul');
    expect(got).toEqual(['1-0', '1-1']);
  });
  it('Skip sends nothing and never sets the board count', async () => {
    const { f, got } = make();
    const spy = vi.spyOn(f.componentInstance, 'setBoard');
    await f.whenStable();
    f.componentInstance.finish();
    expect(spy).not.toHaveBeenCalled();
    expect(got).toEqual([]);
  });
  it('reduced motion ends the scene without setting the board count', async () => {
    const orig = globalThis.matchMedia;
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof matchMedia;
    try {
      const f = TestBed.createComponent(PitchScene);
      const spy = vi.spyOn(f.componentInstance, 'setBoard');
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'k');
      f.componentRef.setInput('seed', 'b');
      let done = 0;
      f.componentInstance.done.subscribe(() => done++);
      const got: string[] = [];
      f.componentInstance.boardChange.subscribe(b => got.push(`${b.balls}-${b.strikes}`));
      await new Promise(r => setTimeout(r, 5));
      expect(done).toBe(1);
      expect(spy).not.toHaveBeenCalled();
      expect(got).toEqual([]);
    } finally { globalThis.matchMedia = orig; }
  });
});

// Plan 59 Round 1a: cue-time golden. The planned moments the audio and announcer follow (enter, plate, park, end,
// windup length) must not move. Not covered: the 60 ms gap between pitches inside the component's next().
describe('plan 59 cue golden', () => {
  const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const n = (x: number) => x.toFixed(6);
  const ERAS: Era[] = ['1901-1919', '1920-1945', '1946-1969', '1970-1989', '1990-2025'];
  const LOOKS: SideLook[] = ['1901', '1920', '1956', '1990'];
  const DECOS: Deco[] = ['1', '2', '3'];
  const TYPES = ['ground', 'fly', 'line', 'pop'] as const;

  function cueGolden(): { hash: string; pitches: number; parks: number } {
    const out: string[] = [`W${n(WINDUP_S)}`];
    let pitches = 0, parks = 0;
    for (let i = 0; i < 200; i++) for (const o of OUTCOMES) for (const deco of DECOS) {
      const seed = `c${i}`;
      const bats: 'L' | 'R' = i % 2 ? 'L' : 'R';
      const era = ERAS[i % 5];
      const count = countFor(o, seed, deco);
      const t = TYPES[i % 4];
      const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: false, sacFly: false, forceRunner: null } : null;
      const call = callFor(o, seed, count, 'Batter X', bats, 'R', deco, 1900 + (i % 125), facts);
      const windup = i % 3 !== 0;
      for (let k = 0; k <= count.leadUp.length; k++) {
        const isFinal = k === count.leadUp.length;
        const lead = isFinal ? null : count.leadUp[k];
        const m = isFinal ? motionFor(o, count.finalKind) : leadMotion(lead!.kind);
        const kind: 'ball' | 'strike' | null = lead ? (lead.kind === 'ball' ? 'ball' : 'strike') : o === 'bb' ? 'ball' : null;
        const pl = planPitch({ m, kind, isFinal, outcome: o, era, bats, call: isFinal ? call : null, contact: { x: 372, y: 200 }, seed, index: k, windup });
        const play = isFinal && (m === 'hit' || m === 'out') && hasPark(o, call) ? buildPlay({ outcome: o, call, play: facts, seed, look: LOOKS[i % 4] }) : null;
        const pk = parkTiming(pl, play);
        out.push([n(pl.p.enter), n(pl.p.tPlate), n(pl.p.tTarget), n(pl.tl.enter), n(pl.tl.end), n(pl.exitT), pk ? `${n(pk.tPark)}/${n(pk.end)}` : '-'].join(','));
        pitches++; if (pk) parks++;
      }
    }
    return { hash: fnv(out.join('|')), pitches, parks };
  }

  it('planned cue times for 200 seeds x 8 outcomes x 3 decos are unchanged', () => {
    const g = cueGolden();
    expect(g.parks).toBeGreaterThan(500);   // the park path is really exercised
    expect(g).toEqual({ hash: '7cf48e17', pitches: 18834, parks: 3000 });
  });
});

// Plan 59 Round 1b test 2: one scale for the side panel in any stage; the batter is big, panel x 0-560 always shows,
// the foot line sits at 92% of the stage height, and a lefty (mirrored panel) is anchored on his own side.
describe('plan 59 r1b: stageFit', () => {
  const BAT = 440, BAT_X: [number, number] = [-58, 298];   // side batter frames, panel units (all 12 sheets)
  const STAGES: [number, number][] = [[358, 506], [288, 341], [322, 250], [300, 222], [900, 540], [560, 300]];
  const shown = (f: StageFit, x: number, mirror: boolean) => f.left + (mirror ? PANEL_W - x : x) * f.s;
  it('batter at least 270 px at 358x506 and at least 40% of the stage height everywhere', () => {
    expect(BAT * stageFit(358, 506, false).s).toBeGreaterThanOrEqual(270);
    for (const [w, h] of STAGES) expect(BAT * stageFit(w, h, false).s / h, `${w}x${h}`).toBeGreaterThanOrEqual(0.4);
  });
  it('panel x 0-560 always visible, foot line at 92% of the stage height, panel inside the stage vertically', () => {
    for (const [w, h] of STAGES) for (const m of [false, true]) {
      const f = stageFit(w, h, m);
      expect(f.x0, `${w}x${h} ${m}`).toBeLessThanOrEqual(0); expect(f.x1).toBeGreaterThanOrEqual(560);
      for (const x of [0, 560]) { const d = shown(f, x, m); expect(d).toBeGreaterThanOrEqual(-1e-6); expect(d).toBeLessThanOrEqual(w + 1e-6); }
      expect(f.top + FOOT_Y * f.s).toBeCloseTo(0.92 * h, 6);
      expect(f.top).toBeGreaterThanOrEqual(0); expect(f.top + PANEL_H * f.s).toBeLessThanOrEqual(h);
    }
  });
  it('the batter stays inside the stage, righty and lefty, and wide stages center the panel', () => {
    for (const [w, h] of STAGES) for (const m of [false, true]) {
      const f = stageFit(w, h, m);
      for (const x of [Math.max(f.x0, BAT_X[0]), BAT_X[1]]) { const d = shown(f, x, m); expect(d, `${w}x${h} ${m} ${x}`).toBeGreaterThanOrEqual(-1e-6); expect(d).toBeLessThanOrEqual(w + 1e-6); }
      if (w / f.s >= PANEL_W) expect(f.left).toBeCloseTo((w - PANEL_W * f.s) / 2, 6);
    }
  });
});

// Review fix (Part A): the stage is never wider than STAGE_MAX_ASPECT x its height (CSS), so on the widest stage the pitch
// enters at the pitcher-side edge and an unhit pitch leaves at the catcher-side edge (x -20), not mid-stage.
describe('plan 59 r1b: widest stage', () => {
  it('the ball enters and leaves within 30 panel units of the stage edges, righty and lefty', () => {
    for (const h of [222, 254, 324, 480]) for (const m of [false, true]) {
      const f = stageFit(STAGE_MAX_ASPECT * h, h, m);
      expect(f.x1, `${h} ${m}`).toBeGreaterThanOrEqual(ENTER_X); expect(f.x1 - ENTER_X).toBeLessThanOrEqual(30);
      expect(f.x0).toBeLessThanOrEqual(-20); expect(-20 - f.x0).toBeLessThanOrEqual(30);
    }
  });
});

// Plan 59 Round 1b test 8: before the drawn backdrop is ready (and in jsdom, which has no canvas) the stage shows a flat
// silhouette in the park look's sky and grass colors, never a blank box, and nothing throws. The windup's CSS mound is gone.
describe('plan 59 r1b test 8: silhouette without a canvas', () => {
  it('stage and windup carry the look\'s sky and grass colors; backdrop canvas left empty; nothing throws', async () => {
    for (const look of ['1901', '1970', '1990'] as const) {
      const f = TestBed.createComponent(PitchScene);
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'k');
      f.componentRef.setInput('seed', 'sil');
      f.componentRef.setInput('look', look);
      f.componentRef.setInput('side', { sheet: '/s.webp', frames: Array.from({ length: 8 }, () => ({})), lineArt: false });
      f.componentRef.setInput('windup', { sheet: '/w.webp', mirror: false });
      expect(() => f.detectChanges()).not.toThrow();
      await f.whenStable();
      const el = f.nativeElement as HTMLElement, stage = el.querySelector('.stage') as HTMLElement;
      expect(stage.style.getPropertyValue('--sky'), look).toBe(LOOKS[look].sky[1]);
      expect(stage.style.getPropertyValue('--grass')).toBe(LOOKS[look].grass);
      const bg = stage.querySelector(':scope > canvas.bg') as HTMLCanvasElement | null;
      expect(bg).not.toBeNull();
      expect(bg!.dataset['key'], 'nothing drawn without a canvas context: the silhouette shows').toBeUndefined();
      f.destroy();
    }
  });
  it('the windup layer has the same silhouette and no CSS mound', () => {
    const css = ((PitchScene as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles ?? []).join('\n');
    expect(css).toMatch(/\.windup\[[^\]]*\]\s*\{[^}]*background:\s*linear-gradient\(var\(--(%NS%)?sky[^}]*var\(--(%NS%)?grass/);
    expect(css).not.toMatch(/windup[^{]*::after/);
  });
});
