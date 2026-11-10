// Plan 59 Round 1a: the hidden ?perf=1 frame-time readout.
import { perfFromSearch, perfStats } from './perf-overlay';

describe('perf overlay', () => {
  it('perfStats: p95, max and share of frames under 20 ms', () => {
    const d = [...Array(95).fill(10), 25, 30, 35, 40, 60];
    const s = perfStats(d);
    expect(s.frames).toBe(100);
    expect(s.p95).toBe(10);
    expect(s.max).toBe(60);
    expect(s.under20).toBeCloseTo(0.95, 6);
  });

  it('perfStats: p95 uses the nearest-rank value', () => {
    expect(perfStats([5, 15, 25, 35]).p95).toBe(35);
    expect(perfStats([16.7]).p95).toBe(16.7);
  });

  it('perfStats: no frames gives zeros', () => {
    expect(perfStats([])).toEqual({ frames: 0, p95: 0, max: 0, under20: 0 });
  });

  it('perfFromSearch: on only for perf=1', () => {
    expect(perfFromSearch('?perf=1')).toBe(true);
    expect(perfFromSearch('?vs=cpu&perf=1')).toBe(true);
    expect(perfFromSearch('')).toBe(false);
    expect(perfFromSearch('?perf=0')).toBe(false);
    expect(perfFromSearch('?perf=true')).toBe(false);
  });
});
