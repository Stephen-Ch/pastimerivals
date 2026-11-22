import { Directive, ElementRef, OnDestroy, OnInit, effect, inject, input, output, signal, untracked } from '@angular/core';
import { SEEN_KEY } from './art';

/**
 * Plan 51 / plan 76 A: the one-line art note. There is no pop-up any more: the line shows while the note is due and
 * counts as seen only after it was really on screen for 1 s without a break.
 */
const KEY = 'pr_art_note';
export const ART_NOTE_SEEN_MS = 1000;
/** The short form for tight spots (short landscape, Last Licks). */
export const ART_NOTE_SHORT = 'Generic drawings, not portraits.';

export type ArtArrival = 'home' | 'share' | 'challenge' | 'page';

let snapshot: boolean | null = null;   // pr_art_note unset at visit start (fixed for the visit)
const seen = signal(false);            // marked seen this visit
let arrival: ArtArrival = 'home';

function dueAtStart(): boolean {
  if (snapshot === null) {
    try { snapshot = localStorage.getItem(KEY) === null; } catch { snapshot = true; }
  }
  return snapshot;
}

/** The note is still due this visit (snapshot at visit start, not yet seen). Reactive. */
export function artNoteDue(): boolean { return !seen() && dueAtStart(); }

/** How the visit arrived (sent with art_note_shown). Set once by the app at start. */
export function setArtArrival(a: ArtArrival) { arrival = a; }
export function artArrival(): ArtArrival { return arrival; }

/** Sets pr_art_note and pr_seen (plan 51's one shared flag). Returns false if it was already marked this visit. */
export function markArtNoteShown(): boolean {
  if (seen()) return false;
  seen.set(true);
  try { localStorage.setItem(KEY, '1'); } catch { /* fine */ }
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* fine */ }
  return true;
}

/** The note was marked seen on this visit (the feedback ask holds back then). Reactive. */
export function artNoteShownThisVisit(): boolean { return seen(); }

/** Tests only: a fresh visit (module state carries over between unit tests). */
export function resetArtNoteVisit() { snapshot = null; seen.set(false); arrival = 'home'; }

/**
 * Plan 76 A: emits once when its element has been on screen (any part visible) for ART_NOTE_SEEN_MS without a break.
 * Hidden (display: none) or removed elements never count. No IntersectionObserver: never emits.
 */
@Directive({ selector: '[prArtNoteSeen]' })
export class ArtNoteSeen implements OnInit, OnDestroy {
  readonly seenNote = output<void>({ alias: 'prArtNoteSeen' });
  /** Covered by a sheet: the 1 s does not run (and restarts from zero when uncovered). */
  readonly paused = input(false, { alias: 'prArtNotePaused' });
  private onScreen = false;
  private readonly pauseWatch = effect(() => { this.paused(); untracked(() => this.update()); });
  private readonly onVis = () => this.update();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private io: IntersectionObserver | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    if (typeof IntersectionObserver !== 'function') return;
    this.io = new IntersectionObserver(entries => {
      this.onScreen = entries.some(e => e.isIntersecting && e.intersectionRatio > 0);
      this.update();
    });
    this.io.observe(this.el.nativeElement);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
  }

  ngOnDestroy(): void { this.stop(); }

  /** Counts only while on screen, not covered, and the tab is visible. */
  private update() {
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const on = !!this.io && this.onScreen && !this.paused() && visible;
    if (on && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.stop(); this.seenNote.emit(); }, ART_NOTE_SEEN_MS);
    else if (!on) this.clear();
  }
  private clear() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private stop() {
    this.clear(); this.io?.disconnect(); this.io = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVis);
  }
}
