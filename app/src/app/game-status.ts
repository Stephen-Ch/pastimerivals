import { DestroyRef, inject, Signal, signal } from '@angular/core';
import type { CMine } from './challenge-api';

/** Plan 69: one status line per "Your games" row. Computer games (stage null) keep their old words. */
export function stageWords(m: CMine): string {
  switch (m.stage) {
    case 'expired_late': return 'Expired · your friend tried to open it late · Send a new one';
    case 'expired': return 'Expired · Send a new one';
    case 'result': return 'Played! See who won';
    case 'done': return m.rematchSent ? 'Done · Rematch sent' : 'Done · Rematch';
    case 'picking': return 'Your friend started picking';
    case 'opened': return 'Opened · your friend is looking';
    case 'sent': return 'Sent · waiting for your friend';
    case 'unsent': return 'Not sent yet · Send';
    case 'you_played': return m.rematchSent ? 'You played · Rematch sent' : 'You played · Rematch?';
    case 'rematch_for_you': return 'Your friend wants a rematch · Play';
    default: return m.status === 'resolved' ? 'played' : m.status;
  }
}

/** Rows that light up the badge: a result the creator has not seen, or a rematch waiting for you. */
export function isWaiting(m: CMine): boolean { return m.stage === 'result' || m.stage === 'rematch_for_you'; }

export function waitingCount(list: readonly CMine[]): number { return list.filter(isWaiting).length; }

/** Waiting rows first, then open games, then the rest; newest first inside each group. */
export function orderMine(list: readonly CMine[]): CMine[] {
  const group = (m: CMine) => isWaiting(m) ? 0 : m.status === 'open' ? 1 : 2;
  return [...list].sort((a, b) => group(a) - group(b) || Date.parse(b.createdUtc) - Date.parse(a.createdUtc));
}

export function waitingText(n: number): string { return n === 1 ? '1 result waiting' : `${n} results waiting`; }

/** Duel home link (plan 69 A1). small = short portrait phones (How it works sits in the header as "Help"); portrait = other
 *  portrait sizes; wide = landscape, where the long form fits. */
export type LinkKind = 'small' | 'portrait' | 'wide';
export function gamesLinkText(total: number, waiting: number, kind: LinkKind): string {
  const name = kind === 'small' ? 'Games' : 'Your games';
  if (waiting <= 0) return `${name} (${total})`;
  return kind === 'wide' ? `Your games (${total}) · ${waitingText(waiting)}` : `${name} (${waiting} new)`;
}

export const MINE_PAGE = 4;

/** Plan 69 A1: fixed row height (px) of a games-list row; rows a page = whole rows that fit in the list box, 1 to 4. */
export const ROW_H = 62;
export function rowsFit(boxH: number, gap: number): number { return Math.max(1, Math.min(MINE_PAGE, Math.floor((boxH + gap) / (ROW_H + gap)))); }
/** The page that holds the anchor row (the first row of the page the player chose), so turning the phone keeps their place. */
export function pageForAnchor(anchor: number, per: number, total: number): number {
  return Math.min(pageCountBy(total, per) - 1, Math.max(0, Math.floor(anchor / per)));
}
export function pageCountBy(total: number, per: number): number { return Math.max(1, Math.ceil(total / per)); }

/** A media query as a signal (call in an injection context; the listener is removed on destroy). False where matchMedia is missing. */
export function mediaSignal(query: string): Signal<boolean> {
  const mq = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const s = signal(mq?.matches ?? false);
  if (mq) {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    mq.addEventListener('change', on);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
  }
  return s.asReadonly();
}
