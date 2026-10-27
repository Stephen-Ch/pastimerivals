import { NgTemplateOutlet } from '@angular/common';
import { AfterViewInit, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { announcerOn, setAnnouncer } from './announcer-setting';
import { parkOn, setPark } from './park-setting';
import { setVoice, voiceOn } from './voice-setting';

/** Plan 38/39: short info sheets over the current screen. */
export type InfoKind = 'how' | 'sim' | 'art' | 'artIntro' | 'blank';
export const ART_NOTE_TEXT = 'Real players\' faces belong to them and their families, so we chose not to draw them. Team uniforms and logos belong to the clubs, so ours are made up in the style of each era. Every matchup is built from the players\' real stats.';

/** Plan 52: blank-paper cards (wording approved by Stephen, Oct 27). */
export const BLANK_NOTE_TEXT = 'We don\'t guess a player\'s race or skin color. If we haven\'t found a reliable source for it, we leave it blank.';

export const RETROSHEET_NOTICE = 'The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.';

@Component({
  selector: 'pr-how-sim',
  template: `
    <div class="how-sheet" role="dialog" aria-modal="true" aria-labelledby="how-title" (keydown)="onKeydown($event)">
      <div #howCard class="how-card">
        @switch (kind()) {
          @case ('artIntro') {
            <h2 #title id="how-title" tabindex="-1">Why don't the players look like the real ones?</h2>
            <p>{{ artNote }}</p>
          }
          @case ('blank') {
            <h2 #title id="how-title" tabindex="-1">Why no face?</h2>
            <p>{{ blankNote }}</p>
          }
          @case ('sim') {
            <h2 #title id="how-title" tabindex="-1">Simulate 1,000</h2>
            <ul>
              <li>Plays this exact matchup 1,000 times with the same odds as one Pitch.</li>
              <li>Shows what usually happens: batting average, on-base, slugging, home runs, strikeouts and walks.</li>
              <li>One Pitch is a single roll of these odds, so it can surprise you. 1,000 show what usually happens.</li>
            </ul>
          }
          @case ('art') {
            <h2 #title id="how-title" tabindex="-1">About the art</h2>
            <ng-container *ngTemplateOutlet="art" />
          }
          @default {
            <h2 #title id="how-title" tabindex="-1">How the sim works</h2>
            <ul>
              <li>Every plate appearance comes from the two players' real season stats, played in one neutral modern league so any era can face any other.</li>
              <li>Base running uses modern MLB averages: taking the extra base, double plays, sacrifice flies.</li>
              <li>Errors happen about as often as they did in the pitcher's era.</li>
              <li>The newest player on the home team sets the rules: designated hitter or pitchers bat, and the runner on second in extra innings.</li>
              <li>When pitchers bat, they use their real batting line that season (or the average pitcher of their decade).</li>
              <li>Left-handed batters stand on the other side of the plate, so the view flips. Switch hitters usually bat from the side opposite the pitcher's arm.</li>
              <li>Not in this version: steals, bunts, pinch hitters and relief pitchers.</li>
              <li>Announcer voices are computer-generated, not real broadcasters. Not every player's name is recorded yet. Turn off silent mode if you hear nothing.</li>
            </ul>
            <h3>About the art</h3>
            <ng-container *ngTemplateOutlet="art" />
            <p class="pbp-switch">Announcer (play-by-play):
              <button type="button" class="toggle" role="switch" [attr.aria-checked]="on()" (click)="flip()">{{ on() ? 'On' : 'Off' }}</button></p>
            <p class="pbp-switch">Announcer voice:
              <button type="button" class="toggle" role="switch" [attr.aria-checked]="voiceIsOn()" (click)="flipVoice()">{{ voiceIsOn() ? 'On' : 'Off' }}</button></p>
            <p class="pbp-switch">Follow the ball:
              <button type="button" class="toggle" role="switch" [attr.aria-checked]="parkIsOn()" (click)="flipPark()">{{ parkIsOn() ? 'On' : 'Off' }}</button></p>
          }
        }
        <ng-template #art>
          <ul>
            <li>{{ artNote }}</li>
            <li>Uniforms, colors and caps are made up, in the styles of each era. They are not real team uniforms and carry no team names, logos or numbers.</li>
            <li>Statistics come from Retrosheet. {{ notice }}</li>
            <li>Pastime Rivals is an independent game. It is not affiliated with or endorsed by Major League Baseball, its teams, the players or their families.</li>
          </ul>
        </ng-template>
        @if (kind() === 'artIntro') {
          <button type="button" class="primary" (click)="close.emit()">Got it</button>
          <button type="button" class="link" (click)="more.emit()">More about the art</button>
        } @else {
          <button type="button" class="primary" (click)="close.emit()">Close</button>
        }
      </div>
    </div>`,
  imports: [NgTemplateOutlet],
  styles: [`
    .how-sheet { position: fixed; inset: 0; z-index: 20; background: rgba(0, 0, 0, .45); display: flex; align-items: flex-end; justify-content: center; }
    .how-card { box-sizing: border-box; width: 100%; max-width: 440px; max-height: 90%; overflow-y: auto; padding: 16px 16px 20px; border-radius: 16px 16px 0 0;
      background: var(--surface-0, #fbfaf7); color: var(--text-primary, #222); }
    h2 { margin: 0 0 8px; font-size: 1.1rem; }
    h2:focus { outline: none; }
    h3 { margin: 4px 0 6px; font-size: .95rem; }
    p { margin: 0 0 14px; font-size: .9rem; line-height: 1.4; }
    ul { margin: 0 0 14px; padding-left: 1.2em; display: grid; gap: 6px; font-size: .9rem; line-height: 1.4; }
    button { width: 100%; min-height: 44px; }
    .pbp-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 14px; font-size: .9rem; }
    .pbp-switch .toggle { width: auto; min-width: 72px; }
  `],
})
export class HowSim implements AfterViewInit {
  readonly kind = input<InfoKind>('how');
  readonly close = output<void>();
  readonly more = output<void>();
  protected readonly notice = RETROSHEET_NOTICE;
  protected readonly artNote = ART_NOTE_TEXT;
  protected readonly blankNote = BLANK_NOTE_TEXT;
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  private readonly card = viewChild<ElementRef<HTMLElement>>('howCard');
  protected readonly on = announcerOn;
  protected flip() { setAnnouncer(!announcerOn()); }
  protected readonly parkIsOn = parkOn;
  protected flipPark() { setPark(!parkOn()); }
  protected readonly voiceIsOn = voiceOn;
  protected flipVoice() { setVoice(!voiceOn()); }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.title()?.nativeElement.focus({ preventScroll: true }));
  }

  protected onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close.emit();
      return;
    }
    if (ev.key !== 'Tab') return;
    const root = this.card()?.nativeElement;
    if (!root) return;
    const all = Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(x => !x.hasAttribute('disabled'));
    if (!all.length) return;
    const first = all[0], last = all[all.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
  }
}
