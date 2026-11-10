import { Component, DestroyRef, inject, signal } from '@angular/core';

/** Plan 59 Round 1a: hidden frame-time readout for real phones (BrowserStack DevTools could not run the measurement).
 *  Shown only with ?perf=1. No network, no storage. Frames are counted in plain JS; the display updates twice a second
 *  so the readout does not re-render on every frame it measures. */

export interface PerfStats { frames: number; p95: number; max: number; under20: number; }

/** p95 (nearest rank), max, and share of frames under 20 ms (the scorecard limit). */
export function perfStats(deltas: readonly number[]): PerfStats {
  if (!deltas.length) return { frames: 0, p95: 0, max: 0, under20: 0 };
  const s = [...deltas].sort((a, b) => a - b);
  const p95 = s[Math.ceil(0.95 * s.length) - 1];
  return { frames: s.length, p95, max: s[s.length - 1], under20: deltas.filter(d => d < 20).length / deltas.length };
}

export function perfFromSearch(search = typeof location !== 'undefined' ? location.search : ''): boolean {
  return new URLSearchParams(search).get('perf') === '1';
}

const WINDOW = 600;   // last 600 frames, about 10 s at 60 fps
const SHOW_MS = 500;

/** Page-load time (ms) from the navigation timing entry, or null. */
function loadMs(): number | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null;
  } catch { return null; }
}

@Component({
  selector: 'pr-perf-overlay',
  template: `<div class="perf" role="status" aria-label="Frame times">
      <span>p95 {{ s().p95.toFixed(1) }} ms</span> <span>max {{ s().max.toFixed(1) }} ms</span>
      <span>&lt;20 ms {{ (s().under20 * 100).toFixed(0) }}%</span> <span>n {{ s().frames }}</span>
      <span>load {{ load() ?? '-' }} ms</span>
      <button type="button" (click)="reset()">Reset</button>
    </div>`,
  styles: `.perf { position: fixed; left: 4px; bottom: 4px; z-index: 9999; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center;
      max-width: calc(100vw - 8px); padding: 4px 6px; font: 11px/1.3 ui-monospace, monospace; color: #fff; background: rgba(0, 0, 0, .78);
      border-radius: 4px; pointer-events: auto; }
    .perf button { font: inherit; color: inherit; background: #444; border: 0; border-radius: 3px; padding: 2px 6px; min-height: 0; }`,
})
export class PerfOverlay {
  protected readonly s = signal<PerfStats>(perfStats([]));
  protected readonly load = signal<number | null>(null);
  private deltas: number[] = [];
  private last = 0;
  private raf = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    if (typeof requestAnimationFrame === 'function') {
      const tick = (now: number) => {
        if (this.last) { this.deltas.push(now - this.last); if (this.deltas.length > WINDOW) this.deltas.shift(); }
        this.last = now;
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }
    this.timer = setInterval(() => { this.s.set(perfStats(this.deltas)); if (this.load() === null) this.load.set(loadMs()); }, SHOW_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.timer);
      if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    });
  }

  protected reset() { this.deltas = []; this.last = 0; this.s.set(perfStats([])); }
}
