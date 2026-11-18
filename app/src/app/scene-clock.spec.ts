import { sceneT, slowExtra, slowWindow, SlowFacts, wallFor, wallRun } from './scene-clock';

const HR: SlowFacts = { isFinal: true, outcome: 'hr', motion: 'hit', itp: false, tPark: 1.0 };

describe('plan 73 scene clock', () => {
  it('window for a final non-ITP home run with the field view and big moments on', () => {
    expect(slowWindow(HR, true, true)).toEqual({ from: 0.97, to: 1.35, rate: 0.4 });
  });

  it('no window: ITP, no field view, not final, big moments off, other outcomes', () => {
    expect(slowWindow({ ...HR, itp: true }, true, true)).toBeNull();
    expect(slowWindow(HR, true, false)).toBeNull();
    expect(slowWindow({ ...HR, isFinal: false }, true, true)).toBeNull();
    expect(slowWindow(HR, false, true)).toBeNull();
    for (const o of ['k', 'bb', 'hbp', 'single', 'double', 'triple', 'oip'] as const) expect(slowWindow({ ...HR, outcome: o }, true, true)).toBeNull();
  });

  it('hand-worked numbers (tPark 1.000)', () => {
    const w = slowWindow(HR, true, true);
    expect(slowExtra(w)).toBeCloseTo(0.57, 9);                  // 0.38 x (1/0.4 - 1)
    expect(wallFor(0.5, w)).toBeCloseTo(0.5, 9);                // before: unchanged
    expect(wallFor(1.20, w)).toBeCloseTo(1.545, 9);             // 0.97 + 0.23 / 0.4
    expect(wallFor(1.35, w)).toBeCloseTo(1.92, 9);              // 0.97 + 0.38 / 0.4
    expect(wallFor(3.0, w)).toBeCloseTo(3.57, 9);               // after: + 0.57
    expect(sceneT(1.545, w)).toBeCloseTo(1.20, 9);
    expect(sceneT(1.0, w)).toBeCloseTo(0.982, 9);               // 0.97 + 0.03 x 0.4
    expect(wallFor(1.35, w) - wallFor(1.0, w)).toBeCloseTo(0.875, 9);   // the swell delay
  });

  it('inverse over a grid, and no window is the identity', () => {
    const w = slowWindow(HR, true, true);
    for (let k = 0; k <= 400; k++) {
      const t = k * 0.01;
      expect(sceneT(wallFor(t, w), w)).toBeCloseTo(t, 9);
      expect(wallFor(t, null)).toBe(t);
      expect(sceneT(t, null)).toBe(t);
      if (k) expect(wallFor(t, w)).toBeGreaterThan(wallFor(t - 0.01, w));
    }
  });

  it('wallRun keeps wall speed after its start', () => {
    const w = slowWindow(HR, true, true);
    const start = 1.01, ws = wallFor(start, w);             // 0.97 + 0.04 / 0.4 = 1.07
    expect(ws).toBeCloseTo(1.07, 9);
    expect(wallRun(1.0, 1.045, start, w)).toBe(1.0);         // before its start: scene time
    expect(wallRun(sceneT(1.17, w), 1.17, start, w)).toBeCloseTo(1.11, 9);   // 0.1 wall s after start = start + 0.1
    expect(wallRun(1.2, 1.2, start, null)).toBe(1.2);
  });
});
