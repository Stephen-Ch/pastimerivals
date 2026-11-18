/** Plan 73 A2: the big-moment slow window. Scene time t is what the plans and the park play run on; wall time is what
 *  the viewer sees. Inside the window scene time runs at `rate` of wall time; outside it runs at full speed. Pure
 *  functions only, outside Plan/ParkPlay, so the goldens keep their inputs. */
import { OutcomeKey } from './logic';

export interface SlowWindow { from: number; to: number; rate: number; }
export const SLOW_RATE = 0.4, SLOW_BEFORE = 0.03, SLOW_AFTER = 0.35;

/** What the window needs to know about the pitch (a Plan has all of it). */
export interface SlowFacts { isFinal: boolean; outcome: OutcomeKey; motion: string; itp: boolean; tPark: number; }

/** The window for a non-ITP home run's final pitch, when big moments are on and the field view exists; else null. */
export function slowWindow(x: SlowFacts, bigMoments: boolean, hasField: boolean): SlowWindow | null {
  if (!bigMoments || !hasField || !x.isFinal || x.outcome !== 'hr' || x.motion !== 'hit' || x.itp) return null;
  return { from: x.tPark - SLOW_BEFORE, to: x.tPark + SLOW_AFTER, rate: SLOW_RATE };
}

/** Wall seconds the window adds (0 with no window). */
export function slowExtra(w: SlowWindow | null): number { return w ? (w.to - w.from) * (1 / w.rate - 1) : 0; }

/** Scene time at wall time `wall` (both from the same zero). */
export function sceneT(wall: number, w: SlowWindow | null): number {
  if (!w || wall <= w.from) return wall;
  const slowWall = (w.to - w.from) / w.rate;
  if (wall < w.from + slowWall) return w.from + (wall - w.from) * w.rate;
  return wall - slowExtra(w);
}

/** Wall time at scene time t (the inverse of sceneT). */
export function wallFor(t: number, w: SlowWindow | null): number {
  if (!w || t <= w.from) return t;
  if (t < w.to) return w.from + (t - w.from) / w.rate;
  return t + slowExtra(w);
}

/** A time that runs on wall time once it passes `start` (the shake and the big word keep today's speed in the window). */
export function wallRun(t: number, wall: number, start: number, w: SlowWindow | null): number {
  if (!w || t < start) return t;
  return start + (wall - wallFor(start, w));
}
