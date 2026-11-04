// Team identity in Last Licks games (PLAN-2026-11-04-team-identity-v3, Part A): one color per side, away/home words,
// "you / they" on every play. Screen text only: nothing here feeds the voice.

/** Fill colors (2.9:1 apart, so they stay distinct in grayscale). Every pill also gets a ring in the board's text color. */
export const TEAM_BLUE = '#1f5fbf';
export const TEAM_ORANGE = '#f5a142';

/** Players: you = blue, them = orange. Spectators: home (side 0) = blue, away (side 1) = orange. */
export function sideColor(side: number, you: number | null): string {
  return (you === null ? side === 0 : side === you) ? TEAM_BLUE : TEAM_ORANGE;
}

/** Board order for a game: Last Licks shows AWAY (side 1) left and HOME (side 0) right; other games keep [0, 1]. */
export function boardOrder(inning: boolean): [number, number] {
  return inning ? [1, 0] : [0, 1];
}

export const awayHome = (side: number) => (side === 1 ? 'away' : 'home');

/** "(yours)" / "(theirs)" for players, nothing for spectators. */
export function ownTag(side: number, you: number | null): string {
  return you === null ? '' : side === you ? 'yours' : 'theirs';
}

/** First word of a generated nickname ("Bleacher 5012" -> "Bleacher"), for narrow boards. */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Header parts: "Top 1", "You bat", "(away)", "Batter 4". who and where are empty for spectators. */
export function headerParts(half: string, side: number, you: number | null, n: number): { half: string; who: string; where: string; batter: string } {
  return {
    half,
    who: you === null ? '' : side === you ? 'You bat' : 'They bat',
    where: you === null ? '' : `(${awayHome(side)})`,
    batter: `Batter ${n}`,
  };
}
