import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { announcerOn, setAnnouncer } from './announcer-setting';
import { parkOn, setPark } from './park-setting';

/** Plan 38/39: short info sheets over the current screen. */
export type InfoKind = 'how' | 'sim' | 'art';

export const RETROSHEET_NOTICE = 'The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.';

@Component({
  selector: 'pr-how-sim',
  template: `
    <div class="how-sheet" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <div class="how-card">
        @switch (kind()) {
          @case ('sim') {
            <h2 id="how-title">Simulate 1,000</h2>
            <ul>
              <li>Plays this exact matchup 1,000 times with the same odds as one Pitch.</li>
              <li>Shows what usually happens: batting average, on-base, slugging, home runs, strikeouts and walks.</li>
              <li>One Pitch is a single roll of these odds, so it can surprise you. 1,000 show what usually happens.</li>
            </ul>
          }
          @case ('art') {
            <h2 id="how-title">About the art</h2>
            <ng-container *ngTemplateOutlet="art" />
          }
          @default {
            <h2 id="how-title">How the sim works</h2>
            <ul>
              <li>Every plate appearance comes from the two players' real season stats, played in one neutral modern league so any era can face any other.</li>
              <li>Base running uses modern MLB averages: taking the extra base, double plays, sacrifice flies.</li>
              <li>Errors happen about as often as they did in the pitcher's era.</li>
              <li>The newest player on the home team sets the rules: designated hitter or pitchers bat, and the runner on second in extra innings.</li>
              <li>When pitchers bat, they use their real batting line that season (or the average pitcher of their decade).</li>
              <li>Left-handed batters stand on the other side of the plate, so the view flips. Switch hitters usually bat from the side opposite the pitcher's arm.</li>
              <li>Not in this version: steals, bunts, pinch hitters and relief pitchers.</li>
            </ul>
            <h3>About the art</h3>
            <ng-container *ngTemplateOutlet="art" />
            <p class="pbp-switch">Announcer (play-by-play):
              <button type="button" class="toggle" role="switch" [attr.aria-checked]="on()" (click)="flip()">{{ on() ? 'On' : 'Off' }}</button></p>
            <p class="pbp-switch">Follow the ball:
              <button type="button" class="toggle" role="switch" [attr.aria-checked]="parkIsOn()" (click)="flipPark()">{{ parkIsOn() ? 'On' : 'Off' }}</button></p>
          }
        }
        <ng-template #art>
          <ul>
            <li>The players are drawn as generic ballplayers, not portraits of the real people.</li>
            <li>Uniforms, colors and caps are made up, in the styles of each era. They are not real team uniforms and carry no team names, logos or numbers.</li>
            <li>Statistics come from Retrosheet. {{ notice }}</li>
            <li>Pastime Rivals is an independent game. It is not affiliated with or endorsed by Major League Baseball, its teams, the players or their families.</li>
          </ul>
        </ng-template>
        <button type="button" class="primary" (click)="close.emit()">Close</button>
      </div>
    </div>`,
  imports: [NgTemplateOutlet],
  styles: [`
    .how-sheet { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, .45); display: flex; align-items: flex-end; justify-content: center; }
    .how-card { box-sizing: border-box; width: 100%; max-width: 440px; max-height: 90%; overflow-y: auto; padding: 16px 16px 20px; border-radius: 16px 16px 0 0;
      background: var(--surface-0, #fbfaf7); color: var(--text-primary, #222); }
    h2 { margin: 0 0 8px; font-size: 1.1rem; }
    h3 { margin: 4px 0 6px; font-size: .95rem; }
    ul { margin: 0 0 14px; padding-left: 1.2em; display: grid; gap: 6px; font-size: .9rem; line-height: 1.4; }
    button { width: 100%; min-height: 44px; }
    .pbp-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; font-size: .9rem; }
    .pbp-switch .toggle { width: auto; min-width: 72px; }
  `],
})
export class HowSim {
  readonly kind = input<InfoKind>('how');
  readonly close = output<void>();
  protected readonly notice = RETROSHEET_NOTICE;
  protected readonly on = announcerOn;
  protected flip() { setAnnouncer(!announcerOn()); }
  protected readonly parkIsOn = parkOn;
  protected flipPark() { setPark(!parkOn()); }
}
