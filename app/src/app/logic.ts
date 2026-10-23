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

export function shareUrl(origin: string, pick: Pick, seed: string, version: string, deco: Deco = DECORATION_VERSION): string {
  const q = new URLSearchParams({ b: pick.b, by: String(pick.by), p: pick.p, py: String(pick.py), s: seed, v: version, d: deco });
  return `${origin}/?${q.toString()}`;
}

export function parseShare(search: string): { pick: Pick; seed: string; version: string; deco: string } | null {
  const q = new URLSearchParams(search);
  const b = q.get('b'), p = q.get('p'), by = Number(q.get('by')), py = Number(q.get('py')), s = q.get('s');
  if (!b || !p || !by || !py || !s) return null;
  return { pick: { b, by, p, py }, seed: s, version: q.get('v') ?? '', deco: q.get('d') ?? '1' };
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
/** Plan 32A: 'tip' = struck out on a foul tip (c2 only). */
export type FinalKind = 'called' | 'swinging' | 'tip';
export interface AtBatCount { leadUp: CountPitch[]; finalKind: FinalKind | null; balls: number; strikes: number; }

/** Plan 32A: decoration versions. 1 = count c1 + call a1 (frozen); 2 = c2 + a2. Travels in share links as d. */
export type Deco = '1' | '2' | '3';
export const DECORATION_VERSION: Deco = '2';
/** '3' (plan 38) is for inning games only: the server stores it; new classic games still send DECORATION_VERSION '2'. */
const KNOWN_DECO: Deco[] = ['1', '2', '3'];
/** Missing = 1. Unknown (newer than this app) = replay with the newest known, and say a refresh would help. */
export function resolveDeco(d: string | number | null | undefined): { deco: Deco; unknown: boolean } {
  if (d === null || d === undefined || d === '') return { deco: '1', unknown: false };
  const k = String(d) as Deco;
  return KNOWN_DECO.includes(k) ? { deco: k, unknown: false } : { deco: DECORATION_VERSION, unknown: true };
}

export const COUNT_VERSION = 'c1';   // kept for reference: the c1 stream name, frozen
export const MAX_LEAD_UP = 6;
export const MAX_FOULS = 2;          // c1
export const MAX_FOULS_C2 = 3;       // c2: whole lead-up, any count

function rng(version: string, seed: string): () => number {
  let h = 2166136261;
  for (const ch of `${version}:${seed}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {   // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A legal lead-up count that ends in the given result. Same seed and version, same count. */
export function countFor(o: OutcomeKey, seed: string, deco: Deco = '1'): AtBatCount {
  return deco === '2' || deco === '3' ? countC2(o, seed) : countC1(o, seed);
}

/** Version c1, frozen (plan 11). Do not change: old links and games replay it. */
function countC1(o: OutcomeKey, seed: string): AtBatCount {
  const r = rng('c1', seed);
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

/** Plan 32A: counts a ball in play comes on. Weights per [balls][strikes]; 3-0 is rare (hitters take 3-0). Estimates. */
const IN_PLAY_COUNT_WEIGHTS: number[][] = [[12, 9, 6], [9, 9, 8], [5, 7, 9], [0.7, 4, 7]];

/** Version c2 (plan 32A, expert review 33): more fouls, fewer called third strikes, foul-tip strikeouts, rare 3-0 in play. */
function countC2(o: OutcomeKey, seed: string): AtBatCount {
  const r = rng('c2', seed);
  const int = (n: number) => Math.floor(r() * n);
  let balls: number, strikes: number;
  if (o === 'bb') { balls = 3; strikes = int(3); }
  else if (o === 'k') { balls = int(4); strikes = 2; }
  else if (o === 'hbp') { balls = int(4); strikes = int(3); }   // not the batter's choice, so not weighted
  else {
    const total = IN_PLAY_COUNT_WEIGHTS.flat().reduce((x, y) => x + y, 0);
    let x = r() * total; balls = 0; strikes = 0;
    outer: for (let bb = 0; bb < 4; bb++) for (let ss = 0; ss < 3; ss++) { x -= IN_PLAY_COUNT_WEIGHTS[bb][ss]; if (x < 0) { balls = bb; strikes = ss; break outer; } }
  }
  const kinds: ('b' | 's')[] = [...Array(balls).fill('b'), ...Array(strikes).fill('s')];
  for (let i = kinds.length - 1; i > 0; i--) { const j = int(i + 1); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let fouls = 0, b = 0, s = 0, extra = 0;
  const leadUp: CountPitch[] = [];
  const strikeKind = (): PitchKind => {
    const x = r();
    if (x < 0.40 && fouls < MAX_FOULS_C2) { fouls++; return 'foul'; }
    return x < 0.75 ? 'called' : 'swinging';
  };
  for (const k of kinds) {
    if (k === 'b') b++; else s++;
    leadUp.push({ kind: k === 'b' ? 'ball' : strikeKind(), balls: b, strikes: s });
    while (s === 2 && fouls < MAX_FOULS_C2 && kinds.length + extra < MAX_LEAD_UP && r() < 0.35) {
      extra++; fouls++;
      leadUp.push({ kind: 'foul', balls: b, strikes: s });
    }
  }
  const last = leadUp.at(-1);
  let finalKind: FinalKind | null = null;
  if (o === 'k') { const y = r(); finalKind = y < 0.70 ? 'swinging' : y < 0.93 ? 'called' : 'tip'; }
  return { leadUp, finalKind, balls: last?.balls ?? 0, strikes: last?.strikes ?? 0 };
}

export const PITCH_CAPTION: Record<PitchKind, string> = { ball: 'Ball', called: 'Strike', swinging: 'Swing and miss', foul: 'Foul' };

/** Plan 32A: caption for the final pitch, shown when the ball arrives. Version 1 replays keep none (old text stays the same). */
export function finalCaption(o: OutcomeKey, finalKind: FinalKind | null, deco: Deco): string {
  if (deco === '1') return '';
  switch (o) {
    case 'k': return finalKind === 'called' ? 'Strike three' : finalKind === 'tip' ? 'Struck out on a foul tip' : 'Strike three, swinging';
    case 'bb': return 'Ball four';
    case 'hbp': return 'Hit by pitch';
    default: return '';
  }
}

// ---- Plan 12: announcer calls. Decoration only, like the count. Version a1 is frozen. ----
type Dir = 'pull' | 'center' | 'opp';
export type Spot = 'left' | 'left-center' | 'center' | 'right-center' | 'right';
/** Plan 21: how the batted ball travels; the animation reads only this field. */
export type Trajectory = 'ground' | 'line' | 'fly' | 'bloop' | 'pop' | 'foul';
const FIELD: Record<string, string> = {
  P: 'the pitcher', C: 'the catcher', '1B': 'first', '2B': 'second', SS: 'short', '3B': 'third',
  LF: 'left', CF: 'center', RF: 'right',
};

function stream(prefix: string, seed: string): () => number {
  let h = 2166136261;
  for (const ch of `${prefix}:${seed}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Side the batter hits from this at-bat: switch hitters bat opposite the pitcher; unknowns count as right. */
export function hitsFrom(bats: string | null | undefined, pitcherThrows: string | null | undefined): 'L' | 'R' {
  const b = (bats ?? 'R').toUpperCase();
  if (b === 'L') return 'L';
  if (b === 'B' || b === 'S') return (pitcherThrows ?? 'R').toUpperCase() === 'L' ? 'R' : 'L';
  return 'R';
}

export interface Call { text: string; type: string; fielder?: string; spot?: Spot; dir?: Dir; trajectory?: Trajectory; insideTheParkHr?: boolean; }

/** One announcer-style line for the result. The engine only decided the outcome; the rest is for show. */
export function callFor(o: OutcomeKey, seed: string, count: AtBatCount, batter: string, bats?: string | null, pitcherThrows?: string | null,
  deco: Deco = '1', year?: number | null, play?: PlayFacts | null): Call {
  if (deco === '3') return callA3(o, seed, count, batter, bats, pitcherThrows, year ?? null, play ?? null);
  return deco === '2' ? callA2(o, seed, count, batter, bats, pitcherThrows, year ?? null) : callA1(o, seed, count, batter, bats, pitcherThrows);
}

/** Plan 38: what the server decided about a play that a3 calls must match. */
export type ServerOutType = 'ground' | 'fly' | 'line' | 'pop' | 'error';
/** tagged: on a line out, a runner tagged (scored, moved up, or was thrown out on the tag); the catch was in the outfield. */
export interface PlayFacts { outType: ServerOutType | null; doublePlay: boolean; sacFly: boolean; forceRunner: string | null; tagged?: boolean; }

const FULL_POS: Record<string, string> = {
  P: 'pitcher', C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', SS: 'shortstop', '3B': 'third baseman',
  LF: 'left fielder', CF: 'center fielder', RF: 'right fielder',
};

/**
 * Version a3 (plan 38, inning games). Count c2 and the a2 text for everything but outs in play. Outs in play run a2's
 * draws in a2's order (direction, spot, its own type roll) so the stream stays aligned, then the fielder is drawn by a2's
 * rule for the SERVER's out type, so words and the ball's path match the play the server scored.
 */
function callA3(o: OutcomeKey, seed: string, count: AtBatCount, batter: string, bats: string | null | undefined, pitcherThrows: string | null | undefined,
  year: number | null, play: PlayFacts | null): Call {
  if (o !== 'oip' || !play?.outType) return callA2(o, seed, count, batter, bats, pitcherThrows, year);
  const r = stream('a2', seed);
  const one = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const side = hitsFrom(bats, pitcherThrows);
  const x = r();
  const dir: Dir = x < 0.5 ? 'pull' : x < 0.8 ? 'center' : 'opp';
  const spotR: Spot = dir === 'pull' ? one<Spot>(['left', 'left-center']) : dir === 'center' ? 'center' : one<Spot>(['right-center', 'right']);
  const mirror: Record<Spot, Spot> = { left: 'right', 'left-center': 'right-center', center: 'center', 'right-center': 'left-center', right: 'left' };
  const spot = side === 'R' ? spotR : mirror[spotR];
  const mirrorPos = (p: string) => side === 'R' ? p : ({ '3B': '1B', '1B': '3B', SS: '2B', '2B': 'SS', LF: 'RF', RF: 'LF' } as Record<string, string>)[p] ?? p;
  const pos = (byDir: Record<Dir, string[]>) => mirrorPos(one(byDir[dir]));
  const of = (s: Spot) => (s === 'left' || s === 'left-center' ? 'LF' : s === 'center' ? 'CF' : 'RF');
  const n = batter;
  r();   // a2's own out-type roll: drawn and set aside so every later draw lines up with a2
  const ground = () => pos({ pull: ['3B', 'SS'], center: ['SS', '2B', 'P'], opp: ['2B', '1B'] });
  switch (play.outType) {
    case 'ground': {
      const f = ground();
      if (play.doublePlay) return { type: 'ground', fielder: f, dir, trajectory: 'ground', text: `${n} grounded into a double play.` };
      if (play.forceRunner) return { type: 'ground', fielder: f, dir, trajectory: 'ground', text: `${n} grounded into a force out; ${play.forceRunner} out at second.` };
      return { type: 'ground', fielder: f, dir, trajectory: 'ground', text: `${n} grounded out to ${FIELD[f]}.` };
    }
    case 'error': {
      const f = ground();
      return { type: 'error', fielder: f, dir, trajectory: 'ground', text: `${n} reached on an error by the ${FULL_POS[f]}.` };
    }
    case 'fly': {
      const f = of(spot);
      const deep = r() < 0.25 ? 'deep ' : '';
      return { type: 'fly', fielder: f, spot, dir, trajectory: 'fly',
        text: play.sacFly ? `${n} hit a sacrifice fly to ${deep}${FIELD[f]}.` : `${n} flied out to ${deep}${FIELD[f]}.` };
    }
    case 'line': {
      const drawn = pos({ pull: ['3B', 'SS', 'LF'], center: ['P', 'SS', '2B', 'CF'], opp: ['2B', '1B', 'RF'] });
      // Expert gate: nobody tags up on an infield liner, so a liner a runner tagged on was caught in the outfield.
      const f = play.tagged && !play.doublePlay ? of(spot) : drawn;
      if (play.doublePlay) return { type: 'line', fielder: f, dir, trajectory: 'line', text: `${n} lined into a double play.` };
      return { type: 'line', fielder: f, dir, trajectory: 'line', text: play.sacFly ? `${n} lined out to ${FIELD[f]} for a sacrifice fly.` : `${n} lined out to ${FIELD[f]}.` };
    }
    case 'pop': {
      const f = one(['1B', '2B', 'SS', '3B', '3B', '1B', 'C']);
      return { type: 'pop', fielder: f, trajectory: 'pop', text: `${n} popped out to ${FIELD[f]}.` };
    }
  }
}

/** Version a1, frozen (plan 12/21). Do not change: old links and games replay it. */
function callA1(o: OutcomeKey, seed: string, count: AtBatCount, batter: string, bats?: string | null, pitcherThrows?: string | null): Call {
  const r = stream('a1', seed);
  const one = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const side = hitsFrom(bats, pitcherThrows);
  const x = r();
  const dir: Dir = x < 0.5 ? 'pull' : x < 0.8 ? 'center' : 'opp';
  // Spots as seen by a right-handed hitter, then mirrored for left-handed hitting.
  const spotR: Spot = dir === 'pull' ? one<Spot>(['left', 'left-center']) : dir === 'center' ? 'center' : one<Spot>(['right-center', 'right']);
  const mirror: Record<Spot, Spot> = { left: 'right', 'left-center': 'right-center', center: 'center', 'right-center': 'left-center', right: 'left' };
  const spot = side === 'R' ? spotR : mirror[spotR];
  const mirrorPos = (p: string) => side === 'R' ? p : ({ '3B': '1B', '1B': '3B', SS: '2B', '2B': 'SS', LF: 'RF', RF: 'LF' } as Record<string, string>)[p] ?? p;
  const pos = (byDir: Record<Dir, string[]>) => mirrorPos(one(byDir[dir]));
  const of = (s: Spot) => (s === 'left' || s === 'left-center' ? 'LF' : s === 'center' ? 'CF' : 'RF');
  const lineSpot = spot === 'left' || spot === 'right';
  const n = batter;
  switch (o) {
    case 'k': return { type: 'strikeout', text: `${n} struck out ${count.finalKind === 'called' ? 'looking' : 'swinging'}.` };
    case 'bb': return { type: 'walk', text: count.balls === 3 && count.strikes === 0 && count.leadUp.length === 3 ? `${n} walked on four pitches.` : `${n} drew a walk.` };
    case 'hbp': return { type: 'hbp', text: `${n} was hit by a pitch.` };
    case 'hr': {
      const t = one([`homered to ${spot}.`, `drove one deep to ${spot} for a home run.`, `hit it over the wall in ${spot}.`]);
      return { type: 'hr', spot, dir, trajectory: 'fly', text: `${n} ${t}` };
    }
    case 'triple': {
      const where = lineSpot ? `into the ${spot}-field corner` : spot === 'center' ? `over the center fielder's head` : `into the ${spot} gap`;
      return { type: 'triple', spot, dir, trajectory: 'fly', text: `${n} tripled ${where}.` };
    }
    case 'double': {
      const where = lineSpot ? one([`down the ${spot}-field line`, `into the ${spot}-field corner`]) : spot === 'center' ? `over the center fielder's head` : `into the ${spot} gap`;
      return { type: 'double', spot, dir, trajectory: lineSpot ? 'line' : 'fly', text: `${n} doubled ${where}.` };
    }
    case 'single': {
      const field = spot === 'left-center' ? 'left' : spot === 'right-center' ? 'right' : spot;
      // Same random draw as one([...]) so existing share links keep their text.
      const opts: [string, Trajectory][] = [
        [field === 'center' ? 'singled up the middle.' : `grounded a single through the ${field === 'left' ? 'left' : 'right'} side.`, 'ground'],
        [`lined a single to ${field}.`, 'line'], [`blooped a single into ${field}.`, 'bloop']];
      const [t, trajectory] = one(opts);
      return { type: 'single', spot, dir, trajectory, text: `${n} ${t}` };
    }
    case 'oip': {
      const y = r();
      if (y < 0.42) {
        const f = pos({ pull: ['3B', 'SS'], center: ['SS', '2B', 'P'], opp: ['2B', '1B'] });
        return { type: 'ground', fielder: f, dir, trajectory: 'ground', text: `${n} grounded out to ${FIELD[f]}.` };
      }
      if (y < 0.70) {
        const f = of(spot);
        return { type: 'fly', fielder: f, spot, dir, trajectory: 'fly', text: `${n} flied out to ${r() < 0.25 ? 'deep ' : ''}${FIELD[f]}.` };
      }
      if (y < 0.82) {
        const f = pos({ pull: ['3B', 'SS', 'LF'], center: ['P', 'SS', '2B', 'CF'], opp: ['2B', '1B', 'RF'] });
        return { type: 'line', fielder: f, dir, trajectory: 'line', text: `${n} lined out to ${FIELD[f]}.` };
      }
      if (y < 0.92) {
        const f = one(['1B', '2B', 'SS', '3B']);
        return { type: 'pop', fielder: f, trajectory: 'pop', text: `${n} popped out to ${FIELD[f]}.` };
      }
      const f = pos({ pull: ['3B', 'LF'], center: ['C'], opp: ['1B', 'RF'] });
      return { type: 'foul', fielder: f, dir, trajectory: 'foul', text: `${n} fouled out to ${FIELD[f]}.` };
    }
  }
}

/** Version a2 (plan 32A, expert review 33). Field names are real fields; fielders match the ball's flight. */
function callA2(o: OutcomeKey, seed: string, count: AtBatCount, batter: string, bats: string | null | undefined, pitcherThrows: string | null | undefined, year: number | null): Call {
  const r = stream('a2', seed);
  const one = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const side = hitsFrom(bats, pitcherThrows);
  const x = r();
  const dir: Dir = x < 0.5 ? 'pull' : x < 0.8 ? 'center' : 'opp';
  const spotR: Spot = dir === 'pull' ? one<Spot>(['left', 'left-center']) : dir === 'center' ? 'center' : one<Spot>(['right-center', 'right']);
  const mirror: Record<Spot, Spot> = { left: 'right', 'left-center': 'right-center', center: 'center', 'right-center': 'left-center', right: 'left' };
  const spot = side === 'R' ? spotR : mirror[spotR];
  const mirrorPos = (p: string) => side === 'R' ? p : ({ '3B': '1B', '1B': '3B', SS: '2B', '2B': 'SS', LF: 'RF', RF: 'LF' } as Record<string, string>)[p] ?? p;
  const pos = (byDir: Record<Dir, string[]>) => mirrorPos(one(byDir[dir]));
  const of = (s: Spot) => (s === 'left' || s === 'left-center' ? 'LF' : s === 'center' ? 'CF' : 'RF');
  /** Pull or opposite for a spot named in real field terms. */
  const dirOf = (s: Spot): Dir => s === 'center' ? 'center' : ((s === 'left' || s === 'left-center') === (side === 'R') ? 'pull' : 'opp');
  const lineSpot = spot === 'left' || spot === 'right';
  const n = batter;
  const deadBall = year !== null && year < 1920;
  switch (o) {
    case 'k': return { type: 'strikeout', text: count.finalKind === 'tip' ? `${n} struck out on a foul tip.` : `${n} struck out ${count.finalKind === 'called' ? 'looking' : 'swinging'}.` };
    case 'bb': return { type: 'walk', text: count.balls === 3 && count.strikes === 0 && count.leadUp.length === 3 ? `${n} walked on four pitches.` : `${n} drew a walk.` };
    case 'hbp': return { type: 'hbp', text: `${n} was hit by a pitch.` };
    case 'hr': {
      if (deadBall && r() < 0.5) {   // estimate: many dead-ball home runs stayed in the park
        const gap = one<Spot>(['left-center', 'center', 'right-center']);
        return { type: 'hr', spot: gap, dir: dirOf(gap), trajectory: 'line', insideTheParkHr: true,
          text: `${n} hit an inside-the-park home run to ${gap === 'center' ? 'center' : `the ${gap} gap`}.` };
      }
      const t = deadBall ? one([`homered over the fence in ${spot}.`, `drove one over the ${spot}-field fence.`])
        : one([`homered to ${spot}.`, `drove one deep to ${spot} for a home run.`, `hit it over the wall in ${spot}.`]);
      return { type: 'hr', spot, dir, trajectory: 'fly', text: `${n} ${t}` };
    }
    case 'triple': {
      const z = r();   // estimates: most triples go to right field or the right-center gap
      const ts: Spot = z < 0.6 ? one<Spot>(['right-center', 'right']) : z < 0.95 ? one<Spot>(['left-center', 'center']) : 'left';
      const corner = ts === 'left' || ts === 'right';
      const tr: Trajectory = corner ? 'line' : r() < 0.5 ? 'line' : 'fly';
      const where = corner ? `into the ${ts}-field corner` : ts === 'center' ? `over the center fielder's head` : `into the ${ts} gap`;
      return { type: 'triple', spot: ts, dir: dirOf(ts), trajectory: tr, text: `${n} tripled ${where}.` };
    }
    case 'double': {
      if (lineSpot) return { type: 'double', spot, dir, trajectory: 'line', text: `${n} doubled ${one([`down the ${spot}-field line`, `into the ${spot}-field corner`])}.` };
      const tr: Trajectory = r() < 0.5 ? 'line' : 'fly';
      const where = spot === 'center' ? `over the center fielder's head` : `into the ${spot} gap`;
      return { type: 'double', spot, dir, trajectory: spot === 'center' ? 'fly' : tr, text: `${n} doubled ${where}.` };
    }
    case 'single': {
      const field = spot === 'left-center' ? 'left' : spot === 'right-center' ? 'right' : spot;
      const opts: [string, Trajectory][] = [
        [field === 'center' ? 'singled up the middle.' : `grounded a single through the ${field === 'left' ? 'left' : 'right'} side.`, 'ground'],
        [`lined a single to ${field}.`, 'line'], [`blooped a single into ${field}.`, 'bloop']];
      const [t, trajectory] = one(opts);
      return { type: 'single', spot, dir, trajectory, text: `${n} ${t}` };
    }
    case 'oip': {
      const y = r();
      if (y < 0.42) {
        const f = pos({ pull: ['3B', 'SS'], center: ['SS', '2B', 'P'], opp: ['2B', '1B'] });
        return { type: 'ground', fielder: f, dir, trajectory: 'ground', text: `${n} grounded out to ${FIELD[f]}.` };
      }
      if (y < 0.70) {
        const f = of(spot);
        return { type: 'fly', fielder: f, spot, dir, trajectory: 'fly', text: `${n} flied out to ${r() < 0.25 ? 'deep ' : ''}${FIELD[f]}.` };
      }
      if (y < 0.82) {
        const f = pos({ pull: ['3B', 'SS', 'LF'], center: ['P', 'SS', '2B', 'CF'], opp: ['2B', '1B', 'RF'] });
        return { type: 'line', fielder: f, dir, trajectory: 'line', text: `${n} lined out to ${FIELD[f]}.` };
      }
      if (y < 0.92) {
        const f = one(['1B', '2B', 'SS', '3B', '3B', '1B', 'C']);
        return { type: 'pop', fielder: f, trajectory: 'pop', text: `${n} popped out to ${FIELD[f]}.` };
      }
      const f = pos({ pull: ['3B', 'LF'], center: ['C'], opp: ['1B', 'RF'] });
      return { type: 'foul', fielder: f, dir, trajectory: 'foul', text: `${n} fouled out to ${FIELD[f]}.` };
    }
  }
}

/** Plan 25: a batting line from simulated outcomes (n plate appearances; no sacrifices in the model). */
export interface BattingLine { avg: number; obp: number; slg: number; hr: number; k: number; bb: number; hits: number; ab: number; }
export function battingLine(c: Record<OutcomeKey, number>, n: number): BattingLine {
  const hits = c.single + c.double + c.triple + c.hr;
  const ab = Math.max(0, n - c.bb - c.hbp);
  const tb = c.single + 2 * c.double + 3 * c.triple + 4 * c.hr;
  return { avg: ab ? hits / ab : 0, obp: n ? (hits + c.bb + c.hbp) / n : 0, slg: ab ? tb / ab : 0, hr: c.hr, k: c.k, bb: c.bb + c.hbp, hits, ab };
}
/** ".287" style. */
export function rate3(x: number): string {
  const s = x.toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
}
