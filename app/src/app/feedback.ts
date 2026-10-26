import { Component, input, signal } from '@angular/core';
import { artNoteShownThisVisit } from './art-note';
import { capi } from './challenge-api';

/** Plan 30 reason keys and labels. Thumbs up asks what they like; thumbs down asks what would make it better. */
export const UP_REASONS: [string, string][] = [['oldtime', 'Old-time players'], ['friends', 'Playing friends'], ['quick', 'Quick games'], ['animation', 'The animation']];
export const DOWN_REASONS: [string, string][] = [['hard', 'Too hard'], ['confusing', 'Confusing'], ['slow', 'Too slow'], ['players', 'Want more players']];

const LAST_KEY = 'pr_fb_last', GAMES_KEY = 'pr_fb_games', SEEN_KEY = 'pr_fb_seen';
const WEEK_MS = 7 * 24 * 3600 * 1000;
let askedThisVisit = false;   // private mode: localStorage throws, so never ask twice in one visit

function read(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* fine */ } }

/** Counts a finished game once per game code (or practice pitch) and says whether to ask now. */
export function feedbackDue(gameKey: string, needed: number, now = Date.now()): boolean {
  if (artNoteShownThisVisit()) return false;
  if (askedThisVisit) return false;
  if (read(SEEN_KEY) !== gameKey) {
    write(SEEN_KEY, gameKey);
    write(GAMES_KEY, String((Number(read(GAMES_KEY)) || 0) + 1));
  }
  const games = Number(read(GAMES_KEY)) || 0;
  const last = Number(read(LAST_KEY)) || 0;
  return games >= needed && now - last >= WEEK_MS;
}

/** Tests only. */
export function resetFeedbackVisit() { askedThisVisit = false; }

export function markFeedbackAsked(now = Date.now()) { askedThisVisit = true; write(LAST_KEY, String(now)); }

/** One row: "Enjoying it?" thumbs up / down / dismiss, then a small sheet of four one-tap reasons. */
@Component({
  selector: 'pr-feedback',
  template: `
    @if (state() === 'ask') {
      <div class="fb-row" role="group" aria-label="Feedback">
        <span class="fb-q">Enjoying it?</span>
        <button type="button" class="fb-btn" (click)="vote('up')" aria-label="Yes"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z"/></svg></button>
        <button type="button" class="fb-btn" (click)="vote('down')" aria-label="No"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="transform: rotate(180deg)"><path fill="currentColor" d="M2 21h4V9H2v12zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-2z"/></svg></button>
        <button type="button" class="fb-x" (click)="dismiss()" aria-label="Not now">&times;</button>
      </div>
    } @else if (state() === 'thanks') {
      <div class="fb-row"><span class="fb-q">Thanks, I read every one.</span></div>
    }
    @if (state() === 'reasons') {
      <div class="fb-sheet" role="dialog" aria-modal="true" [attr.aria-label]="votedUp() ? 'What do you like?' : 'What would make it better?'">
        <p class="fb-title">{{ votedUp() ? 'What do you like?' : 'What would make it better?' }}</p>
        <div class="fb-chips">
          @for (r of (votedUp() ? up : down); track r[0]) {
            <button type="button" class="chip" [class.on]="picked().includes(r[0])" [attr.aria-pressed]="picked().includes(r[0])" (click)="toggle(r[0])">{{ r[1] }}</button>
          }
        </div>
        <div class="fb-actions">
          <button type="button" class="primary" (click)="send()" [disabled]="!picked().length">Send</button>
          <button type="button" (click)="state.set('thanks')">Skip</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; flex: none; }
    .fb-row { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 44px; }
    .fb-q { font-size: .92rem; color: var(--text-secondary); }
    .fb-btn { width: 44px; height: 40px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary); display: grid; place-items: center; cursor: pointer; }
    .fb-x { width: 36px; height: 40px; border: 0; background: none; color: var(--text-secondary); font-size: 1.4rem; cursor: pointer; }
    .fb-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; max-width: 440px; margin: 0 auto; background: var(--surface-0); border-top: 1px solid var(--border); border-radius: 16px 16px 0 0; padding: 16px 16px max(16px, env(safe-area-inset-bottom)); box-shadow: 0 -6px 24px rgb(0 0 0 / .18); }
    .fb-title { margin: 0 0 10px; font-weight: 600; }
    .fb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .fb-actions { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-top: 14px; }
    .fb-actions button { min-height: 44px; border-radius: 10px; }
  `,
  styleUrls: ['./challenge.css'],
})
export class Feedback {
  /** Where the game was played. */
  readonly where = input.required<'cpu' | 'friend' | 'practice'>();
  readonly level = input<number | null>(null);
  readonly result = input<'win' | 'loss' | 'draw' | null>(null);
  /** Plan 38: game mode, recorded with the vote. */
  readonly mode = input<'classic' | 'inning' | null>(null);
  protected readonly up = UP_REASONS;
  protected readonly down = DOWN_REASONS;
  protected readonly state = signal<'ask' | 'reasons' | 'thanks' | 'gone'>('ask');
  protected readonly votedUp = signal(true);
  protected readonly picked = signal<string[]>([]);
  private id: Promise<string | null> = Promise.resolve(null);

  constructor() { markFeedbackAsked(); }

  protected async vote(v: 'up' | 'down') {
    this.votedUp.set(v === 'up');
    this.state.set('reasons');
    this.id = capi.feedback({ vote: v, where: this.where(), level: this.level() ?? undefined, result: this.result() ?? undefined, mode: this.mode() ?? undefined });
  }

  protected toggle(k: string) { this.picked.update(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k])); }

  protected async send() {
    const reasons = this.picked();
    this.state.set('thanks');
    const id = await this.id;   // the vote may still be in flight
    if (id && reasons.length) await capi.feedbackReasons(id, reasons);
  }

  protected dismiss() { this.state.set('gone'); }
}
