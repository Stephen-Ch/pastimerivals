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

/** Duel home link. short = small phones and sideways ("Your games (1 new)"). */
export function gamesLinkText(total: number, waiting: number, short: boolean): string {
  if (waiting <= 0) return `Your games (${total})`;
  return short ? `Your games (${waiting} new)` : `Your games (${total}) · ${waitingText(waiting)}`;
}

export const MINE_PAGE = 4;

export function pageCount(n: number): number { return Math.max(1, Math.ceil(n / MINE_PAGE)); }
/** One page of rows (page clamped into range). */
export function pageOf<T>(list: readonly T[], page: number): T[] {
  const p = Math.min(pageCount(list.length) - 1, Math.max(0, page));
  return list.slice(p * MINE_PAGE, (p + 1) * MINE_PAGE);
}
