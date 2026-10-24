import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Report } from './api';
import { Era, figure } from './art';

/** Scouting report (plan 10). Not styled as a trading card: no border banner, numbers or rarity. */
@Component({
  selector: 'pr-report',
  template: `
    @let r = report();
    <article class="rep" [class.compact]="compact()" [class.back]="flipped()">
      @if (!flipped()) {
        @if (card(); as c) {
          <div class="art card"><img [src]="c" [class.mirror]="cardMirror()" [alt]="'Illustrated ' + (r.role === 'pit' ? 'pitcher' : 'batter') + ' in a ' + r.era + ' uniform'" width="480" height="720" decoding="async"/></div>
        } @else {
          <div class="art" [innerHTML]="art()"></div>
        }
        <div class="id">
          <h3>{{ r.name }}</h3>
          <p class="sub">{{ r.year }} · {{ r.position }} · {{ r.role === 'pit' ? 'Throws ' + hand(r.throws) : 'Bats ' + hand(r.bats) }}</p>
          @if (!compact()) { <p class="sub">{{ r.places.join(' / ') || 'Unknown team' }}</p> }
          @if (!compact() && r.bio) { <p class="sub bio">Career: {{ r.bio }}</p> }
        </div>
      } @else {
        <div class="facts">
          <h3>{{ r.name }} <span class="sub">{{ r.year }}</span></h3>
          <p class="line">{{ r.line }}</p>
          <ul class="ratios">
            @for (x of r.ratios; track x.label) {
              <li><span>{{ x.label }}</span>
                <span class="meter" [attr.aria-label]="x.label + ' ' + x.timesLeague.toFixed(1) + ' times his league'">
                  <span class="avg"></span><span class="fill" [style.width]="meter(x.timesLeague)"></span></span>
                <strong>{{ x.timesLeague.toFixed(1) }}x</strong></li>
            }
          </ul>
          <p class="sub">x = times his league's rate that season. The line marks league average.</p>
          @if (r.note) { <p class="sub">{{ r.note }}</p> }
          <dl>
            <dt>Age</dt><dd>{{ r.age ?? 'unknown' }}</dd>
            <dt>Height (listed)</dt><dd>{{ r.height ?? 'unknown' }}</dd>
            <dt>Weight (listed)</dt><dd>{{ r.weight ?? 'unknown' }}</dd>
            <dt>Team</dt><dd>{{ r.places.join(' / ') || 'unknown' }}</dd>
            <dt>Data</dt><dd>{{ gradeText(r.grade) }}</dd>
          </dl>
        </div>
      }
      @if (!compact() && card() && !flipped()) {
        <button type="button" class="wrong" (click)="reportLook()">{{ lookSent() ? 'Thanks, noted' : 'Wrong look? Tell us' }}</button>
      }
      @if (!compact()) {
        <button type="button" class="flip" (click)="flipped.set(!flipped())">{{ flipped() ? 'Show front' : 'Show stats' }}</button>
      }
    </article>
  `,
  styles: `
    .rep { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: grid; gap: 8px; color: var(--text-primary); }
    .art { background: var(--paper); border-radius: 8px; aspect-ratio: 3 / 4; display: grid; place-items: center; overflow: hidden; }
    .art :first-child { width: 100%; height: 100%; }
    .compact { padding: 8px; gap: 4px; }
    .art.card, .compact .art.card { aspect-ratio: 2 / 3; border: 3px solid #2b2a28; border-radius: 6px; background: #2b2a28; }
    .art.card img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .art.card img.mirror { transform: scaleX(-1); }
    .wrong { justify-self: start; font: inherit; font-size: .8rem; cursor: pointer; border: 0; background: none; color: var(--accent-text); text-decoration: underline; padding: 8px 0; min-height: 40px; }
    .compact .art { aspect-ratio: 1 / 1; }
    h3 { margin: 0; font-size: 1.05rem; }
    .compact h3 { font-size: .9rem; }
    .sub { margin: 2px 0 0; font-size: .8rem; color: var(--text-secondary); }
    .line { margin: 6px 0; font-size: .9rem; }
    .ratios { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 6px; font-size: .85rem; }
    .ratios li { display: grid; grid-template-columns: 7.5em 1fr 3em; gap: 8px; align-items: center; }
    .meter { position: relative; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
    .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); border-radius: 4px; }
    .avg { position: absolute; left: 33.3%; top: -2px; bottom: -2px; width: 2px; background: var(--text-secondary); z-index: 1; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: .85rem; margin: 6px 0 0; }
    dt { color: var(--text-secondary); } dd { margin: 0; }
    .flip { justify-self: start; font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); padding: 8px 12px; min-height: 40px; }
  `,
})
export class ReportView {
  readonly report = input.required<Report>();
  readonly compact = input(false);
  /** Plan 18: comic card image (null keeps the drawn figure). */
  readonly card = input<string | null>(null);
  readonly cardMirror = input(false);
  readonly wrongLook = output<string>();
  protected readonly lookSent = signal(false);
  protected reportLook() { if (!this.lookSent()) { this.lookSent.set(true); this.wrongLook.emit(this.report().id); } }
  protected readonly flipped = signal(false);
  private readonly sanitizer = inject(DomSanitizer);

  // Our own generated SVG from fixed parameters only, so it is safe to trust.
  protected readonly art = computed(() => {
    const r = this.report();
    return this.sanitizer.bypassSecurityTrustHtml(figure(r.era as Era, r.role, r.role === 'pit' ? r.throws : (r.bats === 'L' ? 'L' : 'R')));
  });

  protected hand(h: string) { return h === 'L' ? 'left' : h === 'R' ? 'right' : h === 'B' ? 'both' : 'unknown'; }
  // League average sits at one third of the bar; 3x league fills it.
  protected meter(x: number) { return `${Math.min(100, (x / 3) * 100).toFixed(0)}%`; }
  protected gradeText(g: string) {
    return g === 'A' ? 'Full play-by-play' : g === 'B' ? 'Box scores' : 'Partial (some stats estimated)';
  }
}
