import { CAtBat, CGame, CPlayer, CSlot } from './challenge-api';
import { PlayFacts, ServerOutType } from './logic';

/** Plan 38: helpers for inning games (base line, half labels, line score, lineup rules). Pure functions, no Angular. */

export const BASE_NAMES = ['first', 'second', 'third'] as const;

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

/** "Top 1" for the visitors (side 1), "Bottom 1" for home (side 0). */
export function halfLabel(inning: number, battingSide: number): string {
  return `${battingSide === 1 ? 'Top' : 'Bottom'} ${inning}`;
}

/** Player names by id from both stored lineups. */
export function namesOf(game: CGame | null): Map<string, string> {
  const m = new Map<string, string>();
  game?.lineups?.forEach(side => side.forEach(p => m.set(p.id, p.name)));
  game?.atBats?.forEach(a => { m.set(a.batter.id, a.batter.name); m.set(a.pitcher.id, a.pitcher.name); });
  return m;
}

/** Short last name for base lines ("Ruth"); the full name when there is no space. */
export function shortName(full: string | undefined, id: string): string {
  if (!full) return id;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** The runner the a3 call names on a force at second (batter safe at first, one runner out, no double play). */
export function forceRunner(ab: CAtBat, names: Map<string, string>): string | null {
  if (ab.outcome !== 'oip' || ab.outType !== 'ground' || ab.doublePlay) return null;
  const outs = ab.runnersOut ?? [];
  if (outs.length !== 1 || (ab.basesAfter?.[0] ?? null) !== ab.batter.id) return null;
  return shortName(names.get(outs[0]), outs[0]);
}

/** Facts the a3 call needs, from the stored play. */
export function playFacts(ab: CAtBat, names: Map<string, string>): PlayFacts {
  const line = ab.outcome === 'oip' && ab.outType === 'line';
  const scored = (ab.scored ?? []).length > 0;
  const before = ab.basesBefore ?? [null, null, null], after = ab.basesAfter ?? [null, null, null];
  const movedUp = before.some((id, i) => !!id && after.some((x, j) => x === id && j > i));
  const thrownOut = (ab.runnersOut ?? []).length > 0 && !ab.doublePlay;
  return {
    outType: (ab.outType ?? null) as ServerOutType | null, doublePlay: !!ab.doublePlay,
    // Rule 9.08(d): a run scoring on a fly or a line drive caught by an outfielder is a sacrifice fly.
    sacFly: !!ab.sacFly || (line && scored && !ab.doublePlay),
    forceRunner: forceRunner(ab, names),
    tagged: line && (scored || movedUp || thrownOut),
  };
}

/**
 * Where a runner thrown out on the play was out, set by the play (matches BaseRunning.Apply): single, runner from second
 * out at home and from first out at third; double, runner from first out at home; ground ball, out at second (force);
 * fly or line out, the runner from third out at home on the tag.
 */
export function outAt(ab: CAtBat, from: number): string {
  if (ab.outcome === 'single') return from === 1 ? 'home' : from === 0 ? 'third' : 'home';
  if (ab.outcome === 'double') return 'home';
  if (ab.outcome === 'oip' && ab.outType === 'ground') return 'second';
  if (ab.outcome === 'oip' && (ab.outType === 'fly' || ab.outType === 'line')) return from === 2 ? 'home' : BASE_NAMES[Math.min(2, from + 1)];
  return from >= 2 ? 'home' : BASE_NAMES[from + 1];
}

/** "Runners on first and third." / "Bases loaded." / "Bases empty." */
export function basesPhrase(bases: (string | null)[]): string {
  const on = bases.map((b, i) => (b ? BASE_NAMES[i] : null)).filter((x): x is typeof BASE_NAMES[number] => !!x);
  if (on.length === 0) return 'Bases empty.';
  if (on.length === 3) return 'Bases loaded.';
  return on.length === 1 ? `Runner on ${on[0]}.` : `Runners on ${on[0]} and ${on[1]}.`;
}

/**
 * Plan 38: one plain line after each plate appearance, built only from the stored play: runs, outs on the bases, then
 * where runners are and how many out. Last play of the game: "Game over."
 */
export function baseLine(ab: CAtBat, names: Map<string, string>, lastOfGame: boolean): string {
  const parts: string[] = [];
  const scored = ab.scored ?? [];
  if (scored.length >= 4) parts.push(`${scored.length} runs score.`);
  else if (scored.length) parts.push(`${list(scored.map(id => shortName(names.get(id), id)))} ${scored.length === 1 ? 'scores' : 'score'}.`);
  const named = forceRunner(ab, names);
  if (ab.doublePlay) parts.push('Double play.');
  else for (const id of ab.runnersOut ?? []) {
    const from = (ab.basesBefore ?? []).indexOf(id);
    if (named && from === 0) continue;   // the call already said "<runner> out at second"
    parts.push(`${shortName(names.get(id), id)} out at ${outAt(ab, Math.max(0, from))}.`);
  }
  const outs = ab.outsAfter ?? 0;
  if (lastOfGame) parts.push('Game over.');
  else if (outs >= 3) parts.push('Side retired.');
  else parts.push(`${basesPhrase(ab.basesAfter ?? [null, null, null])} ${outs} out.`);
  return parts.join(' ');
}

/** "Middle of the 1st: A 2, B 0" after a top half; "End of the 1st" after a bottom half. Null when the half goes on or the game is over. */
export function halfChange(ab: CAtBat, next: CAtBat | null, score: [number, number], name: (side: number) => string, capped: boolean): string | null {
  if (!next || ab.inning === undefined) return null;
  if (next.inning === ab.inning && next.battingSide === ab.battingSide) return null;
  const when = ab.battingSide === 1 ? `Middle of the ${ordinal(ab.inning)}` : `End of the ${ordinal(ab.inning)}`;
  return `${when}: ${name(1)} ${score[1]}, ${name(0)} ${score[0]}.` + (capped && (ab.outsAfter ?? 0) < 3 ? ' That half was stopped after 30 batters.' : '');
}

/** Result line for the final screen. */
export function inningResult(game: CGame, you: number | null, name: (side: number) => string): string {
  const [h, v] = game.totals;
  if (game.winner === -1) return `Tied after ${(game.innings ?? 4) - 1} extra innings`;
  const last = game.atBats[game.atBats.length - 1];
  const walkOff = game.winner === 0 && last?.battingSide === 0 && (last?.points ?? 0) > 0 && h - (last?.points ?? 0) <= v;
  const hi = Math.max(h, v), lo = Math.min(h, v);
  const tail = `${hi}-${lo}${walkOff ? ' on a walk-off' : ''}`;
  if (you === null) return `${name(game.winner)} wins ${tail}`;
  return game.winner === you ? `You win ${tail}` : `You lose ${lo}-${hi}${walkOff ? ' on a walk-off' : ''}`;
}

/** Plays grouped by half for the final list. */
export function halves(game: CGame): { label: string; plays: CAtBat[] }[] {
  const out: { label: string; plays: CAtBat[] }[] = [];
  for (const a of game.atBats) {
    const label = halfLabel(a.inning ?? 1, a.battingSide);
    if (!out.length || out[out.length - 1].label !== label) out.push({ label, plays: [] });
    out[out.length - 1].plays.push(a);
  }
  return out;
}

export const CAP_NOTE = 'A half inning was stopped after 30 batters.';
export const isClashNote = (n: string) => n.includes('was picked by both sides');

// ---- Lineup rules while the home side picks (plan 38 stage C, section 2) ----

/** Row of the batter with the oldest season among rows 1..n (ties: the lowest row). Never the newest, who set the rules. */
export function oldestRow(rows: (CSlot | null)[]): number {
  let best = -1, year = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const y = rows[i]?.choices[0]?.year;
    if (y !== undefined && y < year) { year = y; best = i; }
  }
  return best;
}

/** Takes the oldest-season batter out of a full 9-batter lineup; the rows below him move up. */
export function sitOut(rows: (CSlot | null)[]): { rows: (CSlot | null)[]; out: CSlot | null } {
  const i = oldestRow(rows);
  if (i < 1) return { rows, out: null };
  const kept = rows.filter((_, k) => k !== i);
  return { rows: [...kept.map((s, k) => (s ? { ...s, slot: k } : null)), null], out: rows[i] };
}

/** Key of the rows the app will send (pitcher plus the first n batters), to match an /era answer to them. */
export function rowsKey(rows: (CSlot | null)[], batters: number): string {
  return rows.slice(0, batters + 1).map(s => (s ? `${s.choices[0].id}:${s.choices[0].year}` : '-')).join(',');
}

export function playerLabel(p: CPlayer | undefined): string { return p ? `${p.name} ${p.year}` : ''; }
