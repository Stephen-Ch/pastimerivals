import { lookOf, sideArt, ArtManifest } from './art';
import { Call, callFor, countFor, OUTCOMES } from './logic';
import {
  BALL_D, depthFor, ENTER_X, exitEdge, FINAL_TL, flightAt, frameAt, fxWord, LEAD_TL, makeFlight, makePitch, Motion, PANEL_W, pitchAt,
  pitchRand, pitchTypeFor, planPitch, PLATE_X, solidContact, trail, ZONE_BOTTOM, ZONE_TOP,
} from './pitch-scene';

const C = { x: 372, y: 200 };   // contact point in panel units (cell 432, 200)
const R8 = (k: number) => Array.from({ length: 8 }, (_, i) => ((k * 7 + i * 13) % 100) / 100);

describe('side-on scene (plan 32C)', () => {
  it('picks looks by year with the helmet dates', () => {
    expect([1910, 1919, 1920, 1955, 1956, 1989, 1990, 2020].map(lookOf)).toEqual(['1901', '1901', '1920', '1920', '1956', '1956', '1990', '1990']);
  });

  it('uses line art for batters with no researched tone', () => {
    const m = { side: { cell: [520, 480], footY: 470, sheets: { '1990/line': '/a.webp', '1990/darkbrown': '/b.webp' }, frames: { '1990/line': [], '1990/darkbrown': [] } },
      tones: { known1: 'darkbrown' } } as unknown as ArtManifest;
    expect(sideArt(m, 'known1', 1995)).toEqual({ sheet: '/b.webp', frames: [], lineArt: false });
    expect(sideArt(m, 'nobody', 1995)).toEqual({ sheet: '/a.webp', frames: [], lineArt: true });
  });

  it('has sliders rare before 1950 and common after', () => {
    let early = 0, late = 0;
    for (let i = 0; i < 1000; i++) { if (pitchTypeFor(i / 1000, '1920-1945') === 'slider') early++; if (pitchTypeFor(i / 1000, '1990-2025') === 'slider') late++; }
    expect(early).toBeLessThan(80); expect(late).toBeGreaterThan(150);
  });

  it('enters every pitch from the pitcher\'s edge and hits its target in or out of the zone', () => {
    for (let k = 0; k < 400; k++) {
      const r = pitchRand(`s${k}`, k % 7);
      for (const [m, kind] of [['take', 'ball'], ['take', 'strike'], ['look', null], ['miss', null], ['hit', null], ['hbp', null]] as [Motion, 'ball' | 'strike' | null][]) {
        const p = makePitch(m, kind, r, '1990-2025', C, FINAL_TL);
        expect(p.start.x).toBe(ENTER_X);
        expect(p.start.y).toBeGreaterThanOrEqual(19.9);
        const at = pitchAt(p, p.tTarget);
        expect(at.x).toBeCloseTo(p.target.x, 5); expect(at.y).toBeCloseTo(p.target.y, 5);
        if (m === 'take' && kind === 'strike' || m === 'look') { expect(p.target.y).toBeGreaterThan(ZONE_TOP); expect(p.target.y).toBeLessThan(ZONE_BOTTOM); }
        if (m === 'take' && kind === 'ball') { expect(p.target.y < ZONE_TOP || p.target.y > ZONE_BOTTOM).toBe(true); expect(p.target.y).toBeGreaterThan(100); }
        if (m === 'miss') expect(Math.abs(pitchAt(p, p.tSwing).y - C.y)).toBeGreaterThan(25);   // passes outside the bat line
        if (m === 'hit') expect(p.tSwing).toBeCloseTo(p.tTarget, 5);
      }
    }
  });

  it('shows a curve drop of at least 6 px on a 320 px phone', () => {
    const r = [0.95, 0, 0.5, 0.5, 0, 0, 0, 0];   // curve, smallest drop
    const p = makePitch('look', null, r, '1990-2025', C, FINAL_TL);
    expect(p.type).toBe('curve');
    expect(p.drop * (288 / PANEL_W)).toBeGreaterThanOrEqual(6);
  });

  it('flies each batted ball to the edge the table names, in its time', () => {
    for (let k = 0; k < 50; k++) {
      const r = R8(k);
      const e = (tr: Parameters<typeof makeFlight>[0], hr = false, deep = false, m: Motion = 'hit', depth = 0) => exitEdge(makeFlight(tr, m, true, hr, false, deep, depth, r), C);
      expect(e('line')).toBe('pitcher');
      expect(e('fly')).toBe('top');                // fly out 40-50
      expect(e('fly', true)).not.toBe('dirt');      // home run: top corner
      expect(e('fly', false, true)).toBe('top');    // doubles and triples in the air
      expect(e('pop', false, false, 'out')).toBe('top');
      expect(e('foul', false, false, 'out', 0)).toBe('top');
      expect(['top', 'pitcher']).toContain(e('bloop'));
      expect(e('ground')).toBe('pitcher');
    }
  });

  it('bounces every ground ball on the dirt before it leaves', () => {
    const f = makeFlight('ground', 'hit', true, false, false, false, 0, R8(3));
    let lowest = 0;
    for (let s = 0; s < f.time; s += 0.005) { const p = flightAt(f, C, s); if (p) lowest = Math.max(lowest, p.y); }
    expect(lowest).toBeGreaterThan(455);
  });

  it('home runs leave higher than line drives and faster than fly outs', () => {
    const r = R8(5);
    const hr = makeFlight('fly', 'hit', true, true, false, false, 0, r), fo = makeFlight('fly', 'out', true, false, false, false, 0, r);
    expect(hr.time).toBeLessThan(fo.time);
    expect(hr.angle).toBeGreaterThanOrEqual(26); expect(hr.angle).toBeLessThanOrEqual(30);
  });

  it('shrinks balls to the far side and grows them to the near side', () => {
    const lf: Call = { text: '', type: 'single', spot: 'left' }, rf: Call = { text: '', type: 'single', spot: 'right' };
    expect(depthFor(lf, 'R')).toBe(-1); expect(depthFor(rf, 'R')).toBe(1);
    expect(depthFor(lf, 'L')).toBe(1); expect(depthFor(rf, 'L')).toBe(-1);
    const f = makeFlight('line', 'hit', true, false, false, false, -1, R8(1));
    expect(flightAt(f, C, f.time * 0.9)!.d).toBeLessThan(BALL_D);
  });

  it('draws motion lines only behind the ball, touching its back edge', () => {
    const cur = { x: 300, y: 200, d: 16, o: 1 }, prev = { x: 320, y: 205 };   // moving left, slightly up
    for (const l of trail(cur, prev)) {
      expect(Math.hypot(l.x1 - cur.x, l.y1 - cur.y)).toBeLessThanOrEqual(cur.d / 2 + 2);
      expect(l.x2).toBeGreaterThan(l.x1);   // points back toward where it came from
    }
  });

  it('bursts only on solid contact, on the contact point, under the ball', () => {
    expect(solidContact('hit', 'line')).toBe(true);
    expect(solidContact('hit', 'bloop')).toBe(false);
    expect(solidContact('out', 'pop')).toBe(false);
    expect(solidContact('tip' as Motion, null)).toBe(false);
    const call: Call = { text: '', type: 'single', spot: 'center', trajectory: 'line' };
    const pl = planPitch({ m: 'hit', kind: null, isFinal: true, outcome: 'single', era: '1990-2025', bats: 'R', call, contact: C, seed: 'b', index: 0 });
    const f = frameAt(pl, pl.p.tTarget + 0.02);
    expect(f.fx.burst!.x).toBe(C.x); expect(f.fx.burst!.y).toBe(C.y);
    expect(frameAt(pl, pl.p.tTarget + 0.3).fx.burst).toBeUndefined();
  });

  it('names words per result and shows them only after the ball is gone', () => {
    expect(fxWord('hr', 'hit', 'fly', false)).toEqual(['GONE!']);
    expect(fxWord('hr', 'hit', 'line', true)).toEqual(['CRACK!']);
    expect(fxWord('single', 'hit', 'bloop', false)).toBeNull();
    expect(fxWord('oip', 'out', 'fly', false)).toBeNull();
    for (const [o, m] of [['k', 'miss'], ['bb', 'take'], ['hr', 'hit']] as const) {
      const call: Call | null = o === 'hr' ? { text: '', type: 'hr', spot: 'left', trajectory: 'fly' } : null;
      const pl = planPitch({ m, kind: o === 'bb' ? 'ball' : null, isFinal: true, outcome: o, era: '1990-2025', bats: 'R', call, contact: C, seed: 'w', index: 3 });
      for (let t = 0; t < FINAL_TL.end; t += 0.01) {
        const f = frameAt(pl, t);
        if (f.fx.word) expect(f.ball.o).toBe(0);
      }
      expect([...Array(190).keys()].some(i => !!frameAt(pl, i / 100).fx.word)).toBe(true);
    }
  });

  it('times the batter: load as the ball comes, contact frame on contact, stance again after a take', () => {
    const pl = planPitch({ m: 'take', kind: 'strike', isFinal: false, outcome: 'single', era: '1990-2025', bats: 'R', call: null, contact: C, seed: 't', index: 0 });
    expect(frameAt(planPitch({ m: 'take', kind: 'strike', isFinal: true, outcome: 'k', era: '1990-2025', bats: 'R', call: null, contact: C, seed: 't', index: 0 }), 0.05).batter).toBe(0);
    expect(frameAt(pl, pl.p.enter - 0.1).batter).toBe(1);   // leg kick before the ball appears
    expect(frameAt(pl, pl.p.enter + 0.1).batter).toBe(2);   // foot down while it travels
    expect(frameAt(pl, LEAD_TL.end - 0.05).batter).toBe(0);
    const hit = planPitch({ m: 'hit', kind: null, isFinal: true, outcome: 'double', era: '1990-2025', bats: 'R', call: { text: '', type: 'double', trajectory: 'line', spot: 'left' }, contact: C, seed: 't', index: 0 });
    expect(frameAt(hit, hit.p.tTarget).batter).toBe(3);
    expect(frameAt(hit, hit.p.tTarget + 0.3).batter).toBe(4);
    const walk = planPitch({ m: 'take', kind: 'ball', isFinal: true, outcome: 'bb', era: '1990-2025', bats: 'R', call: null, contact: C, seed: 't', index: 4 });
    expect(frameAt(walk, FINAL_TL.end - 0.1).batter).toBe(7);
  });

  it('draws every a2 call too', () => {
    for (let i = 0; i < 300; i++) for (const o of OUTCOMES) for (const year of [1910, 1995]) {
      const c = countFor(o, `q${i}`, '2'), a = callFor(o, `q${i}`, c, 'B', 'R', 'R', '2', year);
      const m: Motion = o === 'oip' ? 'out' : o === 'k' ? (c.finalKind === 'tip' ? 'tip' : c.finalKind === 'called' ? 'look' : 'miss') : o === 'bb' ? 'take' : o === 'hbp' ? 'hbp' : 'hit';
      const pl = planPitch({ m, kind: null, isFinal: true, outcome: o, era: '1990-2025', bats: 'R', call: a, contact: C, seed: `q${i}`, index: c.leadUp.length });
      for (let t = 0; t < FINAL_TL.end; t += 0.05) expect(() => frameAt(pl, t)).not.toThrow();
    }
  });

  it('ends a pitch he does not hit at the plate, and lets a hit-by-pitch reach him', () => {
    const take = planPitch({ m: 'take', kind: 'strike', isFinal: false, outcome: 'single', era: '1990-2025', bats: 'R', call: null, contact: C, seed: 'e', index: 0 });
    for (let t = 0; t < LEAD_TL.end; t += 0.005) { const f = frameAt(take, t); if (f.ball.o > 0) expect(f.ball.x).toBeGreaterThan(PLATE_X - 25); }
    const hbp = planPitch({ m: 'hbp', kind: null, isFinal: true, outcome: 'hbp', era: '1990-2025', bats: 'R', call: null, contact: C, seed: 'e', index: 0 });
    expect(frameAt(hbp, hbp.p.tTarget - 0.005).ball.o).toBe(1);
  });

  it('keeps the pitch on the plate line when taken', () => {
    const p = makePitch('look', null, R8(2), '1990-2025', C, FINAL_TL);
    expect(pitchAt(p, p.tPlate).x).toBeCloseTo(PLATE_X, 0);
  });
});
