import { Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Era, figure, PairArt } from './art';
import { countFor, OutcomeKey, PITCH_CAPTION, PitchKind } from './logic';

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

/** Plan 18: pitcher frames (seconds at full speed). Set, hands up, kick, peak, stride, cock, release, follow. */
export const PITCHER_FRAMES: [number, number][] = [[0, 0], [0.07, 1], [0.14, 2], [0.22, 3], [0.3, 4], [0.38, 5], [0.45, 6], [0.5, 7]];
/** Cut from the batter's-eye shot to the pitcher's-eye shot at release. */
export const CUT_S = 0.55;

/** Plan 18: batter frames by motion. Stance, load, stride, swing, contact, follow, take, bail. Contact lands on ball arrival (1.05 s). */
export function batterFrames(m: Motion): [number, number][] {
  switch (m) {
    case 'hit': case 'out': case 'foul': return [[CUT_S, 0], [0.7, 1], [0.8, 2], [0.9, 3], [1.05, 4], [1.2, 5]];
    case 'miss': return [[CUT_S, 0], [0.7, 1], [0.8, 2], [0.9, 3], [1.1, 5]];
    case 'take': case 'look': return [[CUT_S, 0], [0.9, 6]];
    case 'hbp': return [[CUT_S, 0], [1.0, 7]];
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
        <div [class]="'scene sprite m-' + motion() + ' shot-' + shot()" [style.--k]="speed()">
          <div class="pshot">
            <svg viewBox="0 0 300 190" width="100%" height="100%" aria-hidden="true">
              <defs><linearGradient id="sky2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#cfd9e3"/><stop offset="1" stop-color="#e9e3d2"/></linearGradient></defs>
              <rect width="300" height="190" fill="url(#sky2)"/>
              <path d="M0 110 Q150 90 300 110 L300 190 L0 190 Z" fill="#7d9a5f"/>
              <ellipse cx="150" cy="112" rx="34" ry="7" fill="#b48a5a"/>
            </svg>
            <div class="spr spit" [class.mirror]="a.pit.mirror" [style.background-image]="'url(' + a.pit.sheet + ')'" [style.--f]="pFrame()" aria-hidden="true"></div>
          </div>
          <div class="bshot" [class.mirror]="a.bat.mirror">
            <svg viewBox="0 0 300 190" width="100%" height="100%" aria-hidden="true">
              <rect width="300" height="190" fill="#c9d3c0"/>
              <path d="M0 120 L300 120 L300 190 L0 190 Z" fill="#7d9a5f"/>
              <ellipse cx="160" cy="176" rx="150" ry="22" fill="#b48a5a"/>
              <path d="M178 172 L194 172 L194 176 L186 180 L178 176 Z" fill="#fbf8f1" stroke="#2b2a28" stroke-width="1"/>
            </svg>
            <div class="spr sbat" [style.background-image]="'url(' + a.bat.sheet + ')'" [style.--f]="bFrame()" aria-hidden="true"></div>
            <svg class="ballsvg" viewBox="0 0 300 190" width="100%" height="100%" aria-hidden="true">
              <circle class="ball2" cx="186" cy="118" r="2.6" fill="#fbf8f1" stroke="#2b2a28" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>
          <div class="board"><span class="count" aria-label="Balls and strikes">{{ board().balls }}-{{ board().strikes }}</span></div>
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
    .sprite { background: #c9d3c0; }
    .pshot, .bshot { position: absolute; inset: 0; }
    .shot-pit .bshot, .shot-bat .pshot { display: none; }
    .bshot.mirror { transform: scaleX(-1); }
    .spr { position: absolute; aspect-ratio: 364 / 480; background-repeat: no-repeat; background-size: 800% 100%; background-position: calc(var(--f, 0) * 100% / 7) 0; }
    .spr.mirror { transform: scaleX(-1); }
    .spr.spit { height: 30%; left: 42.8%; bottom: 40%; }
    .spr.sbat { height: 86%; left: 22%; bottom: 5%; }
    .ballsvg { position: absolute; inset: 0; }
    .ball2 { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .shot-bat .ball2 { animation: in2 calc(.5s * var(--k, 1)) ease-in forwards; }
    .shot-bat.m-hit .ball2 { animation: in2 calc(.5s * var(--k, 1)) ease-in forwards, hit2 calc(.55s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-out forwards; }
    .shot-bat.m-out .ball2 { animation: in2 calc(.5s * var(--k, 1)) ease-in forwards, out2 calc(.5s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-out forwards; }
    .shot-bat.m-foul .ball2 { animation: in2 calc(.5s * var(--k, 1)) ease-in forwards, foul2 calc(.45s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-out forwards; }
    .shot-bat.m-miss .ball2, .shot-bat.m-look .ball2 { animation: in2 calc(.5s * var(--k, 1)) ease-in forwards, past2 calc(.3s * var(--k, 1)) calc(.5s * var(--k, 1)) ease-in forwards; }
    .shot-bat.m-take .ball2 { animation: wide2 calc(.6s * var(--k, 1)) ease-in forwards; }
    .shot-bat.m-hbp .ball2 { animation: inside2 calc(.5s * var(--k, 1)) ease-in forwards; }
    @keyframes in2 { 0% { opacity: 1; transform: translate(-36px, 60px) scale(3.5) } 100% { opacity: 1; transform: none } }
    @keyframes hit2 { 0% { opacity: 1; transform: none } 100% { opacity: 1; transform: translate(-90px, -100px) scale(4) } }
    @keyframes out2 { 0% { opacity: 1; transform: none } 100% { opacity: 1; transform: translate(10px, -90px) scale(1.6) } }
    @keyframes foul2 { 0% { opacity: 1; transform: none } 100% { opacity: 0; transform: translate(50px, -70px) scale(.5) } }
    @keyframes past2 { 0% { opacity: 1; transform: none } 100% { opacity: 0; transform: translate(4px, 14px) scale(.6) } }
    @keyframes wide2 { 0% { opacity: 1; transform: translate(-36px, 60px) scale(3.5) } 100% { opacity: 1; transform: translate(34px, 8px) scale(.9) } }
    @keyframes inside2 { 0% { opacity: 1; transform: translate(-36px, 60px) scale(3.5) } 100% { opacity: 1; transform: translate(-58px, -6px) scale(1.2) } }
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
  readonly done = output<void>();
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly count = computed(() => countFor(this.outcome(), this.seed()));
  /** Index into the lead-up pitches; equal to their length means the final pitch. */
  protected readonly step = signal(0);
  protected readonly board = signal<{ balls: number; strikes: number; caption: string }>({ balls: 0, strikes: 0, caption: '' });

  protected readonly shot = signal<'pit' | 'bat'>('pit');
  protected readonly pFrame = signal(0);
  protected readonly bFrame = signal(0);
  private frameTimers: ReturnType<typeof setTimeout>[] = [];

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

  private clearFrames() { this.frameTimers.forEach(clearTimeout); this.frameTimers = []; }

  /** Steps both sprites through their frames for the current pitch (sprite mode only). */
  private runFrames() {
    this.clearFrames();
    this.shot.set('pit'); this.pFrame.set(0); this.bFrame.set(0);
    if (!this.art()) return;
    const k = this.speed();
    const at = (sec: number, fn: () => void) => this.frameTimers.push(setTimeout(fn, sec * 1000 * k));
    for (const [t, f] of PITCHER_FRAMES) at(t, () => this.pFrame.set(f));
    at(CUT_S, () => this.shot.set('bat'));
    for (const [t, f] of batterFrames(this.motion())) at(t, () => this.bFrame.set(f));
  }

  private next() {
    if (this.finished) return;
    this.runFrames();
    if (this.isFinal()) { this.timer = setTimeout(() => this.finish(), SCENE_MS); return; }
    this.timer = setTimeout(() => {
      const p = this.count().leadUp[this.step()];
      this.board.set({ balls: p.balls, strikes: p.strikes, caption: PITCH_CAPTION[p.kind] });
      this.step.update(i => i + 1);
      this.next();
    }, LEAD_MS);
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
