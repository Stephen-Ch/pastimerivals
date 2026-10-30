import { challengeFromPath } from './app';
import { CAtBat, CPlayer, CView, links } from './challenge-api';
import { parkLookForView } from './challenge';

describe('challenge routing and links (plan 24)', () => {
  it('reads /c/ paths', () => {
    expect(challengeFromPath('/')).toBeUndefined();
    expect(challengeFromPath('/c/new')).toBeNull();
    expect(challengeFromPath('/c/54EjHH01sszqRhaQxoTpyA')).toBe('54EjHH01sszqRhaQxoTpyA');
    expect(challengeFromPath('/c/bad code')).toBeUndefined();
  });

  it('keeps the private key after the # so it never reaches the server', () => {
    const l = links('https://pastimerivals.com', 'abc', 'k'.repeat(43));
    expect(l.share).toBe('https://pastimerivals.com/c/abc');
    expect(l.private).toBe(`https://pastimerivals.com/c/abc#k=${'k'.repeat(43)}`);
    expect(links('https://x', 'abc', null).private).toBeNull();
  });
});

// Plan 59 Round 1b test 7: one park for the whole Last Licks game. Inning games: the era season; classic games
// (no era): the home side's pitcher (side 0, slot 0). Batters from three eras do not change it.
describe('plan 59 r1b: one park per game', () => {
  const P = (id: string, year: number): CPlayer => ({ id, year, name: id, bats: 'R', throws: 'R' });
  const home = [P('hp', 1972), P('h1', 1910), P('h2', 1950), P('h3', 2001)], away = [P('ap', 1931), P('a1', 1925), P('a2', 1985), P('a3', 1999)];
  const ab = (i: number, side: number, b: CPlayer): CAtBat => ({ index: i, round: 0, battingSide: side, pitcher: side ? home[0] : away[0], batter: b, seed: `s${i}`, outcome: 'k', points: 0 });
  const game = { lineups: [home, away], atBats: [ab(0, 1, away[1]), ab(1, 1, away[2]), ab(2, 0, home[1]), ab(3, 0, home[2]), ab(4, 0, home[3])], totals: [0, 0] as [number, number], winner: -1, notes: [] };
  const view = (era: CView['era']): CView => ({ code: 'x', status: 'resolved', you: 'creator', creatorName: 'a', opponentName: 'b', expiresUtc: '', canClaim: false,
    rematchOf: null, yourPicks: null, game, vsCpu: true, mode: era ? 'inning' : 'classic', era });
  it('inning game: the era season, whatever the batter years', () => {
    expect(parkLookForView(view({ dh: true, runnerOnSecond: false, season: 1987, batters: 9 }))).toBe('1970');
  });
  it('classic game: the home pitcher', () => {
    expect(parkLookForView(view(null))).toBe('1970');
    expect(parkLookForView({ ...view(null), game: { ...game, lineups: [[P('hp', 1911)], away] } })).toBe('1901');
  });
  it('no game: null', () => {
    expect(parkLookForView(null)).toBeNull();
    expect(parkLookForView({ ...view(null), game: null })).toBeNull();
  });
});
