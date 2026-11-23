// Plan 79 E (planning/79-FRICTION-PLAN.md v3): the Last Licks final screen leads with the deciding play.
// Deciding play = the play that put the winner ahead for good (the go-ahead play the loser never answered). Tie: the final out.
import type { CAtBat, CGame, CPlayer } from './challenge-api';
import type { OutcomeKey } from './logic';
import { decidingCard, decidingIndex, playWord } from './deciding-play';

const pl = (side: number, i: number): CPlayer => ({ id: `${side ? 'a' : 'h'}${i}`, year: 1950 + i, name: `Player ${side ? 'Away' : 'Home'}${i}`, bats: 'R', throws: 'R' });
type Spec = [side: number, outcome: OutcomeKey, points: number, extra?: Partial<CAtBat>];
function game(plays: Spec[], innings = 1, winnerOverride?: number): CGame {
  const totals: [number, number] = [0, 0];
  const atBats = plays.map(([side, outcome, points, extra], index) => {
    totals[side] += points;
    return { index, round: 0, battingSide: side, pitcher: pl(1 - side, 0), batter: pl(side, 1 + (index % 9)), seed: `s${index}`, outcome, points,
      inning: 1, outType: outcome === 'oip' ? 'ground' : null, scored: Array.from({ length: points }, (_, k) => `r${index}-${k}`),
      runnersOut: [], doublePlay: false, sacFly: false, ...extra } as CAtBat;
  });
  const winner = winnerOverride ?? (totals[0] === totals[1] ? -1 : totals[0] > totals[1] ? 0 : 1);
  return { lineups: [[pl(0, 0)], [pl(1, 0)]], atBats, totals, winner, notes: [], innings };
}
const name = (s: number) => (s === 0 ? 'Catcher 9891' : 'Bleacher 12');

describe('plan 79 E: deciding play', () => {
  it('walk-off hit: the last play', () => {
    const g = game([[1, 'single', 1], [1, 'k', 0], [0, 'single', 0], [0, 'double', 2]]);
    expect(decidingIndex(g)).toBe(3);
    const c = decidingCard(g, 0, name)!;
    expect(c.word).toBe('DOUBLE');
    expect(c.line).toBe('Home4 1954 doubles in 2. You win 2-1.');
  });

  it('walk-off hit that counts fewer runs than crossed: the counted runs', () => {
    const g = game([[1, 'single', 1], [0, 'single', 1], [0, 'double', 1, { scored: ['x', 'y'] }]]);
    expect(decidingIndex(g)).toBe(2);
    expect(decidingCard(g, 1, name)!.line).toBe('Home3 1953 doubles in a run. You lose 1-2.');
  });

  it('go-ahead in the top half, held: that play', () => {
    const g = game([[1, 'hr', 1], [1, 'k', 0], [0, 'k', 0], [0, 'oip', 0]]);
    expect(decidingIndex(g)).toBe(0);
    const c = decidingCard(g, null, name)!;
    expect(c.word).toBe('HOME RUN');
    expect(c.line).toBe('Away1 1951 hits a solo home run. Bleacher 12 wins 1-0.');
  });

  it('go-ahead on an out: sacrifice fly and a run-scoring groundout', () => {
    const fly = game([[1, 'oip', 1, { outType: 'fly', sacFly: true }], [0, 'k', 0]]);
    expect(decidingIndex(fly)).toBe(0);
    expect(decidingCard(fly, 1, name)).toEqual({ word: 'SAC FLY', line: 'Away1 1951 hits a sacrifice fly. You win 1-0.', side: 1 });
    const ground = game([[1, 'oip', 1], [0, 'k', 0]]);
    expect(decidingCard(ground, 1, name)).toEqual({ word: 'RUN SCORES', line: 'Away1 1951 grounds out as a run scores. You win 1-0.', side: 1 });
  });

  it('extra-inning go-ahead: the play in the extra inning', () => {
    const g = game([[1, 'single', 1], [0, 'single', 1], [1, 'k', 0], [0, 'k', 0], [1, 'triple', 2, { inning: 2 }], [0, 'single', 1, { inning: 2 }]], 2);
    expect(decidingIndex(g)).toBe(4);
    expect(decidingCard(g, 1, name)!.word).toBe('TRIPLE');
  });

  it('lead from the first batter, never lost: the first play', () => {
    const g = game([[1, 'hr', 4], [1, 'single', 1], [0, 'hr', 2]]);
    expect(decidingIndex(g)).toBe(0);
    expect(decidingCard(g, 1, name)!.line).toBe('Away1 1951 hits a grand slam. You win 5-2.');
  });

  it('late comeback: the last go-ahead, not the first lead', () => {
    const g = game([[1, 'hr', 2], [0, 'hr', 1], [1, 'k', 0], [0, 'single', 1], [0, 'bb', 1]]);
    expect(decidingIndex(g)).toBe(4);
    expect(decidingCard(g, 0, name)).toEqual({ word: 'WALK', line: 'Home5 1955 walks in a run. You win 3-2.', side: 0 });
  });

  it('tie: the final out', () => {
    const g = game([[1, 'single', 1], [0, 'single', 1], [1, 'k', 0], [0, 'oip', 0, { outType: 'pop' }]], 4);
    expect(decidingIndex(g)).toBe(3);
    expect(decidingCard(g, 0, name)).toEqual({ word: 'OUT', line: 'Tied after 4. Final out: Home4 1954 pops out.', side: 0 });
    const k = game([[1, 'single', 1], [0, 'single', 1], [1, 'k', 0], [0, 'k', 0]], 4);
    expect(decidingCard(k, 0, name)!.word).toBe('STRIKEOUT');
    expect(decidingCard(k, 0, name)!.line).toBe('Tied after 4. Final out: Home4 1954 strikes out.');
  });

  it('a word for every outcome that can decide a game', () => {
    const ab = (outcome: OutcomeKey, points: number, extra: Partial<CAtBat> = {}) => ({ outcome, points, outType: outcome === 'oip' ? 'ground' : null, ...extra }) as CAtBat;
    expect(playWord(ab('single', 1))).toBe('SINGLE');
    expect(playWord(ab('double', 1))).toBe('DOUBLE');
    expect(playWord(ab('triple', 1))).toBe('TRIPLE');
    expect(playWord(ab('hr', 1))).toBe('HOME RUN');
    expect(playWord(ab('bb', 1))).toBe('WALK');
    expect(playWord(ab('hbp', 1))).toBe('HIT BY PITCH');
    expect(playWord(ab('oip', 1, { outType: 'error' }))).toBe('ERROR');
    expect(playWord(ab('oip', 1, { outType: 'fly', sacFly: true }))).toBe('SAC FLY');
    expect(playWord(ab('oip', 1))).toBe('RUN SCORES');
    expect(playWord(ab('oip', 1, { doublePlay: true }))).toBe('RUN SCORES');
    expect(playWord(ab('k', 0))).toBe('STRIKEOUT');
    expect(playWord(ab('oip', 0))).toBe('OUT');
    expect(playWord(ab('oip', 0, { doublePlay: true }))).toBe('OUT');
  });

  it('no game or no plays: no card', () => {
    expect(decidingCard(game([]), 0, name)).toBeNull();
  });
});

describe('plan 79 E, diff review 1: a tie that ends on a capped half', () => {
  it('last play not an out: "Last play", with its own words', () => {
    const g = game([[1, 'single', 1], [0, 'single', 1], [0, 'single', 0]], 1);
    expect(decidingCard(g, 0, name)).toEqual({ word: 'SINGLE', line: 'Tied after 1. Last play: Home3 1953 singles.', side: 0 });
  });
});
