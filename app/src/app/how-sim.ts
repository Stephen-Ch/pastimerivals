import { Component, output } from '@angular/core';

/** Plan 38: "How the sim works", a short sheet over the current screen (Home footer and the final screen). */
@Component({
  selector: 'pr-how-sim',
  template: `
    <div class="how-sheet" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <div class="how-card">
        <h2 id="how-title">How the sim works</h2>
        <ul>
          <li>Every plate appearance comes from the two players' real season stats, played in one neutral modern league so any era can face any other.</li>
          <li>Base running uses modern MLB averages: taking the extra base, double plays, sacrifice flies.</li>
          <li>Errors happen about as often as they did in the pitcher's era.</li>
          <li>The newest player on the home team sets the rules: designated hitter or pitchers bat, and the runner on second in extra innings.</li>
          <li>When pitchers bat, they use their real batting line that season (or the average pitcher of their decade).</li>
          <li>Not in this version: steals, bunts, pinch hitters and relief pitchers.</li>
        </ul>
        <button type="button" class="primary" (click)="close.emit()">Close</button>
      </div>
    </div>`,
  styles: [`
    .how-sheet { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, .45); display: flex; align-items: flex-end; justify-content: center; }
    .how-card { box-sizing: border-box; width: 100%; max-width: 440px; max-height: 90%; overflow-y: auto; padding: 16px 16px 20px; border-radius: 16px 16px 0 0;
      background: var(--surface-0, #fbfaf7); color: var(--text-primary, #222); }
    h2 { margin: 0 0 8px; font-size: 1.1rem; }
    ul { margin: 0 0 14px; padding-left: 1.2em; display: grid; gap: 6px; font-size: .9rem; line-height: 1.4; }
    button { width: 100%; min-height: 44px; }
  `],
})
export class HowSim {
  readonly close = output<void>();
}
