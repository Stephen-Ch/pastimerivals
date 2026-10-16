import { Component, computed, effect, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Era, figure } from './art';
import { OutcomeKey } from './logic';

export type Motion = 'hit' | 'miss' | 'take' | 'hbp' | 'out';

/** Which animation plays for each sim outcome (plan 10 table). */
export function motionFor(o: OutcomeKey): Motion {
  switch (o) {
    case 'k': return 'miss';
    case 'bb': return 'take';
    case 'hbp': return 'hbp';
    case 'oip': return 'out';
    default: return 'hit';
  }
}

export const SCENE_MS = 1600;

export function prefersReducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Batter's-eye view: windup, the ball grows toward you, then a swing or a take. Tap to skip. */
@Component({
  selector: 'pr-pitch-scene',
  template: `
    <button type="button" class="scene" [class]="'scene m-' + motion()" (click)="done.emit()" aria-label="Skip animation">
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
    </button>
  `,
  styles: `
    :host { display: block; margin-top: 14px; }
    .scene { display: block; width: 100%; aspect-ratio: 300 / 190; padding: 0; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: none; cursor: pointer; }
    .pitcher { animation: windup .55s ease-in-out both; transform-origin: 150px 112px; }
    .ball-path { transform-box: view-box; }
    .ball { transform-box: fill-box; transform-origin: center; opacity: 0; }
    .bat { transform-origin: 40px 200px; transform: rotate(-38deg); }
    .m-hit .ball  { animation: approach .55s .5s ease-in forwards, fly-out .55s 1.05s ease-out forwards; }
    .m-out .ball  { animation: approach .55s .5s ease-in forwards, fly-short .5s 1.05s ease-out forwards; }
    .m-miss .ball { animation: approach .55s .5s ease-in forwards, past .3s 1.05s ease-in forwards; }
    .m-take .ball { animation: wide .7s .5s ease-in forwards; }
    .m-hbp .ball  { animation: inside .6s .5s ease-in forwards; }
    .m-hit .bat, .m-out .bat, .m-miss .bat { animation: swing .25s .9s ease-out forwards; }
    .m-hbp svg { animation: shake .3s 1.05s; }
    @keyframes windup { 0% { transform: translateY(0) } 40% { transform: translateY(-3px) rotate(-6deg) } 100% { transform: none } }
    @keyframes approach { 0% { opacity: 1; transform: translate(0, 0) scale(1) } 100% { opacity: 1; transform: translate(0, 46px) scale(13) } }
    @keyframes fly-out { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 1; transform: translate(90px, -70px) scale(.6) } }
    @keyframes fly-short { 0% { opacity: 1; transform: translate(0, 46px) scale(13) } 100% { opacity: 1; transform: translate(-60px, 30px) scale(1.2) } }
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
  readonly done = output<void>();
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly motion = computed(() => motionFor(this.outcome()));
  // Small pitcher on the mound, drawn with the same era figure as the scouting report.
  protected readonly pitcher = computed(() => this.sanitizer.bypassSecurityTrustHtml(
    figure(this.era(), 'pit', this.throws()).replace('<svg ', '<svg x="133" y="62" width="38" height="51" ')));

  constructor() {
    effect((onCleanup) => {
      this.outcome();
      const t = setTimeout(() => this.done.emit(), prefersReducedMotion() ? 0 : SCENE_MS);
      onCleanup(() => clearTimeout(t));
    });
  }
}
