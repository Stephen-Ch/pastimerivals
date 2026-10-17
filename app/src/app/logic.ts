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

// ---- Plan 11: the at-bat count. Decoration only: the engine decides the result. ----
// Version c1 is frozen. A change adds a new version so old shared links replay the same count.
export type PitchKind = 'ball' | 'called' | 'swinging' | 'foul';
export interface CountPitch { kind: PitchKind; balls: number; strikes: number; }
export interface AtBatCount { leadUp: CountPitch[]; finalKind: 'called' | 'swinging' | null; balls: number; strikes: number; }

export const COUNT_VERSION = 'c1';
export const MAX_LEAD_UP = 6;
export const MAX_FOULS = 2;

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of `${COUNT_VERSION}:${seed}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {   // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A legal lead-up count that ends in the given result. Same seed, same count. */
export function countFor(o: OutcomeKey, seed: string): AtBatCount {
  const r = rng(seed);
  const int = (n: number) => Math.floor(r() * n);   // 0..n-1
  const balls = o === 'bb' ? 3 : int(4);
  const strikes = o === 'k' ? 2 : int(3);
  // Order the balls and strikes at random; any order of <=3 balls and <=2 strikes is legal.
  const kinds: ('b' | 's')[] = [...Array(balls).fill('b'), ...Array(strikes).fill('s')];
  for (let i = kinds.length - 1; i > 0; i--) { const j = int(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let fouls = 0;
  const leadUp: CountPitch[] = [];
  let b = 0, s = 0, extraTotal = 0;
  const strikeKind = (): PitchKind => {
    const x = r();
    if (x < 0.25 && fouls < MAX_FOULS) { fouls++; return 'foul'; }   // a foul before two strikes is a strike
    return x < 0.6 ? 'called' : 'swinging';
  };
  for (const k of kinds) {
    if (k === 'b') b++; else s++;
    leadUp.push({ kind: k === 'b' ? 'ball' : strikeKind(), balls: b, strikes: s });
    // Two-strike fouls keep the count; add while budget remains.
    // Budget counts the balls still to come, so the count is never cut short.
    while (s === 2 && fouls < MAX_FOULS && kinds.length + extraTotal < MAX_LEAD_UP && r() < 0.3) {
      extraTotal++;
      fouls++;
      leadUp.push({ kind: 'foul', balls: b, strikes: s });
    }
  }
  const last = leadUp.at(-1);
  return {
    leadUp,
    finalKind: o === 'k' ? (r() < 0.45 ? 'called' : 'swinging') : null,
    balls: last?.balls ?? 0, strikes: last?.strikes ?? 0,
  };
}

export const PITCH_CAPTION: Record<PitchKind, string> = { ball: 'Ball', called: 'Strike', swinging: 'Swing and miss', foul: 'Foul' };
