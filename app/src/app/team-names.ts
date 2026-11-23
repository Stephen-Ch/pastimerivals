// Plan 79 A (server-made team names) and 79-A1 (typed names, reporting): screen text only, nothing here feeds the voice.
// planning/79-FRICTION-PLAN.md v3, planning/79-A1-TYPED-NAME-PLAN.md v6.
import type { CMine, CView } from './challenge-api';
import { firstWord } from './team';

type Names = Pick<CView, 'creatorName' | 'opponentName' | 'vsCpu' | 'creatorTeam' | 'opponentTeam' | 'creatorShort' | 'opponentShort'>;

/** "The Toledo Night Owls"; old games (no team name) keep the nickname; the computer keeps its name. */
export function sideLabel(v: Names | null | undefined, side: number): string {
  const team = side === 0 ? v?.creatorTeam : v?.opponentTeam;
  if (team) return `The ${team}`;
  if (side === 0) return v?.creatorName ?? 'Friend';
  return v?.vsCpu ? 'The Computer' : v?.opponentName ?? 'Friend';
}

/** Board short name: the server's short form (the noun, or the typed-name rule), else the nickname's first word. */
export function shortLabel(v: Names | null | undefined, side: number): string {
  const s = side === 0 ? v?.creatorShort : v?.opponentShort;
  return s || firstWord(sideLabel(v, side).replace(/^The /, ''));
}

/** Same cleaning as the server (NFKC, curly apostrophe, spaces, a leading "The "). The server decides; this only keeps the box honest. */
export function cleanTyped(raw: string): string {
  let s = raw.normalize('NFKC').replace(/\u2019/g, "'").trim().split(/ +/).filter(Boolean).join(' ');
  if (/^the /i.test(s)) s = s.slice(4).trimStart();
  return s;
}

const ALLOWED = /^[A-Za-z0-9 '\-.&\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]+$/;
/** Quick local check before asking the server (length 3-24 after cleaning, allowed characters only). */
export function typedLocalOk(raw: string): boolean {
  const s = cleanTyped(raw);
  return s.length >= 3 && s.length <= 24 && ALLOWED.test(s);
}

/** "Report name" shows under a TYPED name that is not yours (players and spectators). */
export function canReport(v: Pick<CView, 'you' | 'creatorTyped' | 'opponentTyped'> | null | undefined, side: number): boolean {
  if (!v) return false;
  const you = v.you === 'creator' ? 0 : v.you === 'opponent' ? 1 : null;
  return side !== you && !!(side === 0 ? v.creatorTyped : v.opponentTyped);
}

/** Your games rows: "You vs Erie Kingfishers", nicknames on old games. */
export function mineNames(m: CMine): string {
  if (m.vsCpu) return 'You vs the Computer';
  if (m.you === 'creator') { const o = m.opponentTeam ?? m.opponentName; return o ? `You vs ${o}` : 'Your challenge'; }
  return `${m.creatorTeam ?? m.creatorName} vs you`;
}
