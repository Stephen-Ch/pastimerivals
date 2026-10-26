import { Component } from '@angular/core';
import { voiceOn, setVoice } from './voice-setting';

/** Plan 50 B: speaker button beside Pitch (same switch as How it works). */
@Component({
  selector: 'pr-voice-button',
  template: `<button type="button" class="voice-btn" [attr.aria-pressed]="on()" [attr.aria-label]="on() ? 'Announcer voice on' : 'Announcer voice off'" (click)="flip()">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/>
      @if (on()) { <path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/> }
      @else { <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/> }
    </svg></button>`,
  styles: `:host { display: contents; } .voice-btn { flex: none; min-width: 40px; min-height: 40px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; background: none; border: 0; color: inherit; } .voice-btn[aria-pressed=false] { opacity: .6; }`,
})
export class VoiceButton {
  protected readonly on = voiceOn;
  protected flip() { setVoice(!voiceOn()); }
}
