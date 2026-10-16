// Pure helpers for the game screen. No Angular here, so they are easy to test.

export type OutcomeKey = 'k' | 'bb' | 'hbp' | 'single' | 'double' | 'triple' | 'hr' | 'oip';
export const OUTCOMES: OutcomeKey[] = ['k', 'bb', 'hbp', 'single', 'double', 'triple', 'hr', 'oip'];

const LABELS: Record<OutcomeKey, string> = {
  k: 'Strikeout', bb: 'Walk', hbp: 'Hit by pitch', single: 'Single',
  double: 'Double', triple: 'Triple', hr: 'Home run', oip: 'Out in play',
};
// What each side did, in plain words: [batter verb, pitcher verb]
const VERBS: Record<OutcomeKey, [string, string]> = {
  k: ['struck out', 'struck batters out'], bb: ['walked', 'issued walks'], hbp: ['was hit by pitches', 'hit batters'],
  single: ['singled', 'allowed singles'], double: ['doubled', 'allowed doubles'], triple: ['tripled', 'allowed triples'],
  hr: ['homered', 'allowed home runs'], oip: ['made outs in play', 'got outs in play'],
};

export const label = (o: OutcomeKey) => LABELS[o];

export function percent(p: number): string {
  if (p > 0 && p < 0.0005) return '<0.1%';
  return `${(p * 100).toFixed(1)}%`;
}

export interface Pick { b: string; by: number; p: string; py: number; }

export function shareUrl(origin: string, pick: Pick, seed: string, version: string): string {
  const q = new URLSearchParams({ b: pick.b, by: String(pick.by), p: pick.p, py: String(pick.py), s: seed, v: version });
  return `${origin}/?${q.toString()}`;
}

export function parseShare(search: string): { pick: Pick; seed: string; version: string } | null {
  const q = new URLSearchParams(search);
  const b = q.get('b'), p = q.get('p'), by = Number(q.get('by')), py = Number(q.get('py')), s = q.get('s');
  if (!b || !p || !by || !py || !s) return null;
  return { pick: { b, by, p, py }, seed: s, version: q.get('v') ?? '' };
}

export function timesLeague(observed: number | null | undefined, league: number): string {
  if (observed == null || !(league > 0)) return 'n/a';
  return `${(observed / league).toFixed(1)}x`;
}

export interface StepLike {
  outcome: string; batterObserved: number | null; batterLeague: number;
  pitcherObserved: number | null; pitcherLeague: number; neutral: number; final: number;
}

/** One plain-English sentence on why this outcome had the odds it did. */
export function explain(o: OutcomeKey, step: StepLike, batter: string, pitcher: string): string {
  const [bv, pv] = VERBS[o];
  return `${batter} ${bv} at ${timesLeague(step.batterObserved, step.batterLeague)} his league's rate; ` +
    `${pitcher} ${pv} at ${timesLeague(step.pitcherObserved, step.pitcherLeague)} his. ` +
    `In a neutral 1990-2019 league that works out to ${percent(step.final)} per plate appearance.`;
}
