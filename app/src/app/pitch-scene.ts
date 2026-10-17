import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Era, figure, PairArt } from './art';
import { Call, countFor, OutcomeKey, PITCH_CAPTION, PitchKind, Trajectory } from './logic';

export type Motion = 'hit' | 'miss' | 'take' | 'hbp' | 'out' | 'look' | 'foul';

/** Which animation plays for the final pitch (plan 10 table; plan 11 adds called strike three). */
export function motionFor(o: OutcomeKey, finalKind: 'called' | 'swinging' | null = null): Motion {
  switch (o) {
    case 'k': return finalKind === 'called' ? 'look' : 'miss';
    case 'bb': return 'take';
    case 'hbp': return 'hbp';
    case 'oip': return 'out';
    default: return 'hit';
  }
}

/** Animation for a lead-up pitch in the count. */
export function leadMotion(k: PitchKind): Motion {
  return k === 'ball' ? 'take' : k === 'called' ? 'look' : k === 'swinging' ? 'miss' : 'foul';
}

export const SCENE_MS = 1600;
export const LEAD_SPEED = 0.6;   // lead-up pitches play at 60% of the full length
export const LEAD_MS = Math.round(SCENE_MS * LEAD_SPEED) + 150;

/** Plan 19 split scene timeline (seconds at full speed). Pitcher: set, hands up, kick, peak, stride, cock, release, follow. */
export const PITCHER_FRAMES: [number, number][] = [[0, 0], [0.25, 1], [0.45, 2], [0.6, 3], [0.75, 4], [0.9, 5], [1.05, 6], [1.2, 7]];
export const RELEASE_S = 1.05;
export const HANDOFF_S = 1.15;   // ball leaves the pitcher panel, enters the batter panel
export const ARRIVE_S = 1.4;     // ball reaches the plate; contact frame shows here
export const SPLIT_END_S = 2.4;
export const LEAD_START_S = 0.6;  // lead-up pitches come from the stretch: set, short leg lift, stride
/** Plan 21: stretch delivery for lead-up pitches (set, kick, stride, cock, release, follow). */
export const STRETCH_FRAMES: [number, number][] = [[0, 0], [0.66, 2], [0.75, 4], [0.9, 5], [1.05, 6], [1.2, 7]];
export const LEAD_DURATION = 0.8; // lead-up pitches take 80% of the remaining time
export const SPLIT_MS = SPLIT_END_S * 1000;
export const SPLIT_LEAD_MS = Math.round((SPLIT_END_S - LEAD_START_S) * LEAD_DURATION * 1000) + 150;

/** Batter frames by motion. Stance, load, stride, swing, contact, follow, take, bail. */
export function batterFrames(m: Motion): [number, number][] {
  switch (m) {
    case 'hit': case 'out': case 'foul': return [[0, 0], [1.0, 1], [1.2, 2], [1.3, 3], [ARRIVE_S, 4], [1.55, 5]];
    case 'miss': return [[0, 0], [1.0, 1], [1.2, 2], [1.3, 3], [1.45, 5]];
    case 'take': return [[0, 0], [ARRIVE_S, 6]];
    case 'look': return [[0, 0]];   // called strike: he never moves (the take frame draws its own ball)
    case 'hbp': return [[0, 0], [ARRIVE_S, 7]];
  }
}

export function frameAt(table: [number, number][], t: number): number {
  let f = table[0][1];
  for (const [s, x] of table) if (t >= s) f = x;
  return f;
}

export interface BallPos { panel: 'pit' | 'bat' | null; x: number; y: number; d: number; o: number; behind?: boolean; }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

/** Stable 0..1 numbers for a pitch (plan 21): same seed and pitch index always give the same location. */
export function pitchRand(seed: string, index: number): [number, number, number] {
  let h = 2166136261;
  for (const c of `${seed}:${index}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000;
  return [next(), next(), next()];
}

/** Screen side a batted ball leaves toward, seen from the pitcher: left field is the viewer's right (+1). */
export function exitSide(call: Call | null): number {
  if (!call) return 0;
  const bySpot: Record<string, number> = { left: 1, 'left-center': 0.5, center: 0, 'right-center': -0.5, right: -1 };
  if (call.spot) return bySpot[call.spot];
  const byFielder: Record<string, number> = { '3B': 1, SS: 0.5, LF: 1, '2B': -0.5, '1B': -1, RF: -1, P: 0, C: 0, CF: 0 };
  return byFielder[call.fielder ?? ''] ?? 0;
}

/** Where the pitch crosses the plate, in % of the batter panel (screen space). */
export function pitchTarget(m: Motion, bats: string, rand: [number, number, number]): { x: number; y: number } {
  const dir = bats === 'L' ? -1 : 1;
  const batterX = 50 - 12 * dir, plateX = 50 + 20 * dir;
  const [a, b, c] = rand;
  switch (m) {
    case 'hit': case 'out': case 'foul': return { x: 50 + 15 * dir, y: 55 };   // the art's bat meets it here
    case 'hbp': return { x: batterX + 4 * dir, y: 50 };
    case 'look': return { x: batterX + (3 + a * 10) * dir, y: 50 + b * 14 };   // in the zone, just inside his front hip
    case 'miss': return { x: batterX + (3 + a * 10) * dir, y: 58 + b * 8 };    // under the bat line, so the swing misses
    case 'take': {                                                              // outside the zone: wide, high, low or inside
      if (c < 0.4) return { x: plateX + (8 + a * 8) * dir, y: 52 + b * 10 };
      if (c < 0.6) return { x: batterX + (4 + a * 8) * dir, y: 38 + b * 4 };
      if (c < 0.85) return { x: batterX + (4 + a * 8) * dir, y: 70 + b * 4 };
      return { x: batterX - (2 + a * 4) * dir, y: 52 + b * 6 };
    }
  }
}

/** Ball after contact, by trajectory. Things heading to the outfield come toward the camera (behind the pitcher) and grow. */
function flight(tr: Trajectory, side: number, from: { x: number; y: number }, dir: number, batterX: number, u: number): BallPos {
  const e = 1 - (1 - u) * (1 - u);
  const to = (x: number, y: number, d: number, o = 1): BallPos => ({ panel: 'bat', x: lerp(from.x, x, e), y: lerp(from.y, y, e), d: lerp(4.5, d, e), o });
  switch (tr) {
    case 'ground': return u < 0.35
      ? { panel: 'bat', x: lerp(from.x, from.x + side * 6, u / 0.35), y: lerp(from.y, 88, u / 0.35), d: 5, o: 1 }
      : { panel: 'bat', x: lerp(from.x + side * 6, 50 + side * 70, (u - 0.35) / 0.65), y: lerp(88, 97, (u - 0.35) / 0.65), d: lerp(5, 11, (u - 0.35) / 0.65), o: 1 };
    case 'line': return to(50 + side * 75, 42, 13);
    case 'bloop': return to(50 + side * 40, 8, 7);
    case 'pop': return to(from.x, -10, 4.5);
    case 'foul': return to(batterX - 10 * dir, -8, 2.5, 1 - u);   // back over his shoulder, away from the camera
    default: return to(50 + side * 45, -20, 11);                   // fly
  }
}

/** Where the ball is at scene time t, in % of the panel (x, y, diameter d as % of panel width, opacity o).
 *  Screen space: never mirrored. dir = side of the plate (+1 right for a right-handed batter seen from the mound). */
export function ballAt(t: number, m: Motion, throws: string, bats: string, rand: [number, number, number] = [0.5, 0.5, 0.5], tr: Trajectory | null = null, side = 0): BallPos {
  const none: BallPos = { panel: null, x: 0, y: 0, d: 0, o: 0 };
  if (t < HANDOFF_S) return none;   // the release frame draws the ball in the pitcher's hand
  const dir = bats === 'L' ? -1 : 1;
  const batterX = 50 - 12 * dir;
  const startX = 50 + (throws === 'L' ? -10 : 10);
  const end = pitchTarget(m, bats, rand);
  if (t < ARRIVE_S) {  // from behind the pitcher (bottom) toward the plate, shrinking
    const u = clamp01((t - HANDOFF_S) / (ARRIVE_S - HANDOFF_S)), e = u * u;
    return { panel: 'bat', x: lerp(startX, end.x, e), y: lerp(104, end.y, e), d: lerp(16, 4.5, e), o: 1 };
  }
  switch (m) {
    case 'hit': case 'out': case 'foul': {
      const HIDE = 0.1;   // the contact frame draws its own ball for a moment
      if (t < ARRIVE_S + HIDE) return { panel: 'bat', x: end.x, y: end.y, d: 4.5, o: 0 };
      const dur = tr === 'line' ? 0.4 : 0.55;
      return flight(tr ?? (m === 'foul' ? 'foul' : 'fly'), side, end, dir, batterX, clamp01((t - ARRIVE_S - HIDE) / dur));
    }
    case 'miss': case 'look': {   // past him to the catcher: behind his legs, shrinking
      const v = clamp01((t - ARRIVE_S) / 0.35);
      return { panel: 'bat', x: end.x, y: lerp(end.y, end.y + 5, v), d: lerp(4.5, 2.5, v), o: 1 - v, behind: true };
    }
    case 'take': {               // a ball: carries on past him and fades
      const v = clamp01((t - ARRIVE_S) / 0.3);
      return { panel: 'bat', x: end.x, y: end.y + 3 * v, d: lerp(4.5, 3, v), o: 1 - v, behind: true };
    }
    default: {                   // hbp: hits him, drops and fades (the bail frame's own ball was removed)
      const v = clamp01((t - ARRIVE_S) / 0.4);
      return { panel: 'bat', x: end.x + 3 * dir * v, y: end.y + 12 * v, d: 4.5, o: 1 - v };
    }
  }
}

export function prefersReducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Batter's-eye view of the whole at-bat: a short count for show, then the real result. */
@Component({
  selector: 'pr-pitch-scene',
  template: `
    @for (k of [step()]; track k) {
      @if (art(); as a) {
        <div class="split" [class.dim]="dim()">
          <div class="panel ppanel">
            <div class="spr" [class.mirror]="a.pit.mirror" [style.background-image]="'url(' + a.pit.sheet + ')'" [style.--f]="pFrame()" aria-hidden="true"></div>
            @if (ball().panel === 'pit') { <span class="sball" [style.left.%]="ball().x" [style.top.%]="ball().y" [style.width.%]="ball().d" [style.opacity]="ball().o"></span> }
          </div>
          <div class="panel bpanel">
            <div class="field" [class.mirror]="a.bat.mirror">
              <svg class="plate" viewBox="0 0 20 8" aria-hidden="true"><path d="M1 1 L19 1 L19 4 L10 7.5 L1 4 Z" fill="#fbf8f1" stroke="#2b2a28" stroke-width=".8"/></svg>
              <div class="spr" [style.background-image]="'url(' + a.bat.sheet + ')'" [style.--f]="bFrame()" aria-hidden="true"></div>
            </div>
            @if (ball().panel === 'bat') { <span class="sball" [class.behind]="ball().behind" [style.left.%]="ball().x" [style.top.%]="ball().y" [style.width.%]="ball().d" [style.opacity]="ball().o"></span> }
            <div class="board"><span class="count" aria-label="Balls and strikes">{{ board().balls }}-{{ board().strikes }}</span></div>
          </div>
        </div>
      } @else {
      <div class="scene" [class]="'scene m-' + motion()" [style.--k]="speed()">
        <svg viewBox="0 0 300 190" width="100%" height="100%" aria-hidden="true">
          <defs>
            <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#cfd9e3"/><stop offset="1" stop-color="#e9e3d2"/></linearGradient>
          </defs>
          <rect width="300" height="190" fill="url(#sky)"/>
          <path d="M0 110 Q150 90 300 110 L300 190 L0 190 Z" fill="#7d9a5f"/>
          <ellipse cx="150" cy="112" rx="34" ry="7" fill="#b48a5a"/>
          <g class="pitcher" [innerHTML]="pitcher()"></g>
          <g class="ball-path"><circle class="ball" cx="152" cy="84" r="2.2" fill="#fbf8f1" stroke="#2b2a28" stroke-width="1.2" vector-effect="non-scaling-stroke"/></g>
          <g [attr.transform]="bats() === 'L' ? 'translate(300 0) scale(-1 1)' : null"><g class="bat"><line x1="40" y1="200" x2="150" y2="150" stroke="#8a6a44" stroke-width="9" stroke-linecap="round"/></g></g>
        </svg>
        <div class="board"><span class="count" aria-label="Balls and strikes">{{ board().balls }}-{{ board().strikes }}</span></div>
      </div>
      }
    }
    <div class="under">
      <span class="caption" aria-live="polite">{{ board().caption }}</span>
      <button type="button" class="skip" (click)="finish()">Skip to result</button>
    </div>
  `,
  styles: `
    :host { display: block; margin-top: 14px; }
    .scene { position: relative; width: 100%; aspect-ratio: 300 / 190; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
    .board { position: absolute; top: 8px; right: 8px; background: #23312a; color: #f4efe2; border-radius: 8px; padding: 4px 10px; font: 600 1rem/1.2 ui-monospace, monospace; }
    .under { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; }
    .caption { font-weight: 600; min-height: 1.2em; }
    .skip { font: inherit; font-size: .9rem; cursor: pointer; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); padding: 10px 16px; min-height: 44px; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: min(460px, 75vh); margin: 0 auto; }
    @container (min-height: 1px) { .split { max-width: min(460px, calc((100cqh - 64px) * 4 / 3)); } }
    .panel { position: relative; isolation: isolate; aspect-ratio: 2 / 3; overflow: hidden; border: 1px solid var(--border); border-radius: 14px; transition: opacity .2s; }
    .ppanel { background: linear-gradient(#cfd9e3 0 58%, #7d9a5f 58% 100%); }
    .ppanel::after { content: ''; position: absolute; left: 10%; right: 10%; bottom: 0; height: 12%; border-radius: 50% 50% 0 0; background: #b48a5a; }
    .bpanel { background: linear-gradient(#c9d3c0 0 55%, #7d9a5f 55% 82%, #b48a5a 82% 100%); }
    .split.dim .ppanel { opacity: .55; }
    .field { position: absolute; inset: 0; z-index: 1; }
    .field.mirror { transform: scaleX(-1); }
    .plate { position: absolute; left: 36%; width: 20%; bottom: 4%; }
    .spr { position: absolute; z-index: 1; height: 90%; aspect-ratio: 364 / 480; bottom: 3%; left: 50%; transform: translateX(-50%);
      background-repeat: no-repeat; background-size: 800% 100%; background-position: calc(var(--f, 0) * 100% / 7) 0; }
    .spr.mirror { transform: translateX(-50%) scaleX(-1); }
    .bpanel .spr { left: 38%; }
    .sball { position: absolute; z-index: 2; aspect-ratio: 1; border-radius: 50%; background: #fbf8f1; border: 1.5px solid #2b2a28; transform: translate(-50%, -50%); }
    .sball.behind { z-index: 0; }
    .pitcher { animation: windup calc(.55s * var(--k, 1)) ease-in-out both; transform-origin: 150px 112px; }
    .ball-path { transform-box: view-box; }
    .ball { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .bat { transform-origin: 40px 200px; transform: rotate(-38deg); }
    .m-hit .ball  { animation: approach calc(.55s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards, fly-out calc(.55s * var(--k, 1)) calc(1.05s * var(--k, 1)) ease-out forwards; }
    .m-out .ball  { animation: approach calc(.55s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards, fly-short calc(.5s * var(--k, 1)) calc(1.05s * var(--k, 1)) ease-out forwards; }
    .m-miss .ball, .m-look .ball { animation: approach calc(.55s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards, past calc(.3s * var(--k, 1)) calc(1.05s * var(--k, 1)) ease-in forwards; }
    .m-foul .ball { animation: approach calc(.55s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards, foul-back calc(.45s * var(--k, 1)) calc(1.05s * var(--k, 1)) ease-out forwards; }
    .m-take .ball { animation: wide calc(.7s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards; }
    .m-hbp .ball  { animation: inside calc(.6s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards; }
    .m-hit .bat, .m-out .bat, .m-miss .bat, .m-foul .bat { animation: swing calc(.25s * var(--k, 1)) calc(.9s * var(--k, 1)) ease-out forwards; }
    .m-hbp svg { animation: shake .3s calc(1.05s * var(--k, 1)); }
    @keyframes windup { 0% { transform: translateY(0) } 40% { transform: translateY(-3px) rotate(-6deg) } 100% { transform: none } }
    @keyframes approach { 0% { opacity: 1; transform: translate(0, 0) scale(1) } 100% { opacity: 1; transform: translate(0, 46px) scale(13) } }
    @keyframes fly-out { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 1; transform: translate(90px, -70px) scale(.6) } }
    @keyframes fly-short { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 1; transform: translate(-60px, 30px) scale(1.2) } }
    @keyframes foul-back { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 0; transform: translate(-70px, -120px) scale(20) } }
    @keyframes past { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 0; transform: translate(0, 90px) scale(26) } }
    @keyframes wide { 0% { opacity: 1; transform: translate(0, 0) scale(1) } 100% { opacity: 1; transform: translate(95px, 40px) scale(12) } }
    @keyframes inside { 0% { opacity: 1; transform: translate(0, 0) scale(1) } 100% { opacity: 1; transform: translate(-85px, 70px) scale(16) } }
    @keyframes swing { from { transform: rotate(-38deg) } to { transform: rotate(32deg) } }
    @keyframes shake { 0%, 100% { transform: none } 25% { transform: translateX(-4px) } 75% { transform: translateX(4px) } }
  `,
})
export class PitchScene {
  readonly era = input.required<Era>();
  readonly throws = input<string>('R');
  /** Left-handed batters swing from the other side of the screen. */
  readonly bats = input<string>('R');
  readonly outcome = input.required<OutcomeKey>();
  readonly seed = input<string>('');
  /** Plan 18: comic art for both players, already preloaded; null keeps the drawn figures. */
  readonly art = input<PairArt | null>(null);
  /** Plan 21: the announcer call for the final pitch (trajectory and direction of a batted ball). */
  readonly call = input<Call | null>(null);
  readonly done = output<void>();
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly count = computed(() => countFor(this.outcome(), this.seed()));
  /** Index into the lead-up pitches; equal to their length means the final pitch. */
  protected readonly step = signal(0);
  protected readonly board = signal<{ balls: number; strikes: number; caption: string }>({ balls: 0, strikes: 0, caption: '' });

  protected readonly pFrame = signal(0);
  protected readonly bFrame = signal(0);
  protected readonly ball = signal<BallPos>({ panel: null, x: 0, y: 0, d: 0, o: 0 });
  protected readonly dim = signal(false);
  private raf = 0;

  protected readonly isFinal = computed(() => this.step() >= this.count().leadUp.length);
  protected readonly motion = computed<Motion>(() => {
    const c = this.count();
    return this.isFinal() ? motionFor(this.outcome(), c.finalKind) : leadMotion(c.leadUp[this.step()].kind);
  });
  protected readonly speed = computed(() => (this.isFinal() ? 1 : LEAD_SPEED));
  // Small pitcher on the mound, drawn with the same era figure as the scouting report.
  protected readonly pitcher = computed(() => this.sanitizer.bypassSecurityTrustHtml(
    figure(this.era(), 'pit', this.throws()).replace('<svg ', '<svg x="133" y="62" width="38" height="51" ')));

  private timer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { clearTimeout(this.timer); this.clearFrames(); });
    // Start after inputs are bound; reduced motion goes straight to the result (deferred, never during render).
    this.timer = setTimeout(() => (prefersReducedMotion() ? this.finish() : this.next()), 0);
  }

  private clearFrames() {
    if (this.raf) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this.raf as never); this.raf = 0; }
  }

  /** One clock per pitch (plan 19): both sprites and the ball are read from the same elapsed time. */
  private runFrames() {
    this.clearFrames();
    const a = this.art();
    if (!a) return;
    const final = this.isFinal(), m = this.motion();
    const t0 = final ? 0 : LEAD_START_S, rate = final ? 1 : 1 / LEAD_DURATION;
    const ptable = final ? PITCHER_FRAMES : STRETCH_FRAMES;
    const rand = pitchRand(this.seed(), this.step());
    const c = final ? this.call() : null;
    const tr: Trajectory | null = final ? (c?.trajectory ?? null) : m === 'foul' ? 'foul' : null;
    const side = exitSide(c);
    const throws = this.throws(), bats = this.bats() === 'L' ? 'L' : 'R';
    const start = performance.now();
    const frames = batterFrames(m);
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
    const tick = () => {
      const t = Math.min(SPLIT_END_S, t0 + ((performance.now() - start) / 1000) * rate);
      this.pFrame.set(frameAt(ptable, t));
      this.bFrame.set(frameAt(frames, t));
      this.ball.set(ballAt(t, m, throws, bats, rand, tr, side));
      this.dim.set(t >= HANDOFF_S);
      if (!this.finished && t < SPLIT_END_S) this.raf = raf(tick);
    };
    tick();
  }

  private next() {
    if (this.finished) return;
    this.runFrames();
    const sprite = !!this.art();
    if (this.isFinal()) { this.timer = setTimeout(() => this.finish(), sprite ? SPLIT_MS : SCENE_MS); return; }
    this.timer = setTimeout(() => {
      const p = this.count().leadUp[this.step()];
      this.board.set({ balls: p.balls, strikes: p.strikes, caption: PITCH_CAPTION[p.kind] });
      this.step.update(i => i + 1);
      this.next();
    }, sprite ? SPLIT_LEAD_MS : LEAD_MS);
  }

  /** Ends the scene once, whether by timer or the Skip button. */
  finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.clearFrames();
    this.done.emit();
  }
}
