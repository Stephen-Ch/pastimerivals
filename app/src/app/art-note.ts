import { SEEN_KEY } from './art';

const KEY = 'pr_art_note';
let shownThisVisit = false;

export function artNoteDue(): boolean {
  if (shownThisVisit) return false;
  try { return localStorage.getItem(KEY) === null; } catch { return true; }
}

export function markArtNoteShown() {
  shownThisVisit = true;
  try { localStorage.setItem(KEY, '1'); } catch { /* fine */ }
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* fine */ }
}

export function artNoteShownThisVisit(): boolean { return shownThisVisit; }

/** Tests only. */
export function resetArtNoteVisit() { shownThisVisit = false; }

