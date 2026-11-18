import { signal } from '@angular/core';
import { prefersReducedMotion } from './pitch-scene';

/** Plan 73 Part D: the matchup card turns over when a new season changes the card picture. The old picture squeezes
 *  to nothing, the new one opens from the middle. If the new picture has not loaded by the middle, the card waits
 *  (at most FLIP_HOLD_MAX ms, then shows as today); a failed picture ends the flip at once. Never with reduced motion. */
export type FlipRole = 'pit' | 'bat';
export type FlipPhase = 'out' | 'hold' | 'in';
export interface FlipCard { card: string; mirror: boolean; }
export interface FlipState { role: FlipRole; phase: FlipPhase; old: FlipCard; }
export const FLIP_HALF = 225, FLIP_HOLD_MAX = 600;

/** Loads a picture; true when it loaded (no Image at all: true). */
export function loadImage(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise(res => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.src = url; });
}

/** A flip only when the card picture itself changes (art keys on player, era and hand, not the year). */
export function flipWanted(old: FlipCard | null | undefined, next: string | null | undefined): boolean {
  return !!old && !!next && old.card !== next;
}

export class CardFlip {
  readonly state = signal<FlipState | null>(null);
  private token = 0;
  constructor(private readonly load: (url: string) => Promise<boolean> = loadImage, private readonly reduced: () => boolean = prefersReducedMotion) {}

  /** Starts a flip from `old` to the picture at `next`; false (and nothing shown) when no flip is due. */
  start(role: FlipRole, old: FlipCard | null | undefined, next: string | null | undefined): boolean {
    const t = ++this.token;
    if (!flipWanted(old, next) || this.reduced()) { this.state.set(null); return false; }
    this.state.set({ role, phase: 'out', old: old! });
    let loaded: boolean | null = null;
    this.load(next!).then(ok => {
      loaded = ok;
      if (t === this.token && this.state()?.phase === 'hold') this.open(t, ok);
    });
    setTimeout(() => {
      if (t !== this.token) return;
      if (loaded !== null) { this.open(t, loaded); return; }
      this.state.update(s => s && { ...s, phase: 'hold' });
      setTimeout(() => { if (t === this.token && this.state()?.phase === 'hold') this.state.set(null); }, FLIP_HOLD_MAX);
    }, FLIP_HALF);
    return true;
  }

  private open(t: number, ok: boolean) {
    if (!ok) { this.state.set(null); return; }
    this.state.update(s => s && { ...s, phase: 'in' });
    setTimeout(() => { if (t === this.token) this.state.set(null); }, FLIP_HALF);
  }

  cancel() { this.token++; this.state.set(null); }
}
