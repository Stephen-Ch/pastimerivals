import { CAtBat, CGame, CSlot, capi, toBody } from './challenge-api';
import { baseLine, basesPhrase, forceRunner, halfChange, halfLabel, inningResult, oldestRow, ordinal, outAt, playFacts, rowsKey, sitOut } from './inning';
import { callFor, countFor } from './logic';

const P = (id: string, name: string, year = 2000) => ({ id, year, name, bats: 'R', throws: 'R' });
const names = new Map([['r1', 'Babe Ruth'], ['r2', 'Lou Gehrig'], ['r3', 'Tony Lazzeri'], ['bat', 'Earle Combs'], ['r4', 'Bob Meusel']]);
function ab(over: Partial<CAtBat>): CAtBat {
  return { index: 0, round: 0, battingSide: 1, pitcher: P('p', 'Lefty Grove'), batter: P('bat', 'Earle Combs'), seed: '1', outcome: 'single', points: 0,
    inning: 1, spot: 0, outsBefore: 0, outsAfter: 0, basesBefore: [null, null, null], basesAfter: [null, null, null], outType: null,
    scored: [], runnersOut: [], doublePlay: false, sacFly: false, ...over };
}

describe('plan 38 base line', () => {
  it('names runs, then where runners are and the outs', () => {
    expect(baseLine(ab({ basesBefore: [null, 'r1', null], basesAfter: ['bat', null, null], scored: ['r1'], points: 1 }), names, false))
      .toBe('Ruth scores. Runner on first. 0 out.');
    expect(baseLine(ab({ outcome: 'double', basesBefore: ['r1', 'r2', null], basesAfter: [null, 'bat', null], scored: ['r2', 'r1'], points: 2, outsAfter: 1, outsBefore: 1 }), names, false))
      .toBe('Gehrig and Ruth score. Runner on second. 1 out.');
    expect(baseLine(ab({ outcome: 'hr', basesBefore: ['r1', 'r2', 'r3'], scored: ['r3', 'r2', 'r1', 'bat'], points: 4 }), names, false))
      .toBe('4 runs score. Bases empty. 0 out.');
    expect(basesPhrase(['a', 'b', 'c'])).toBe('Bases loaded.');
    expect(basesPhrase(['a', null, 'c'])).toBe('Runners on first and third.');
  });

  it('puts a runner out at the base the play sent him to', () => {
    const single2 = ab({ basesBefore: [null, 'r1', null], basesAfter: ['bat', null, null], runnersOut: ['r1'], outsAfter: 1 });
    expect(baseLine(single2, names, false)).toBe('Ruth out at home. Runner on first. 1 out.');
    const single1 = ab({ basesBefore: ['r1', null, null], basesAfter: ['bat', null, null], runnersOut: ['r1'], outsAfter: 1 });
    expect(baseLine(single1, names, false)).toBe('Ruth out at third. Runner on first. 1 out.');
    expect(outAt(ab({ outcome: 'double' }), 0)).toBe('home');
    expect(outAt(ab({ outcome: 'oip', outType: 'fly' }), 2)).toBe('home');
    expect(outAt(ab({ outcome: 'oip', outType: 'line' }), 2)).toBe('home');
    expect(outAt(ab({ outcome: 'oip', outType: 'ground' }), 0)).toBe('second');
  });

  it('says double play once, skips a force-out runner the call already named, and ends halves and games', () => {
    const dp = ab({ outcome: 'oip', outType: 'ground', basesBefore: ['r1', null, null], runnersOut: ['r1'], doublePlay: true, outsBefore: 0, outsAfter: 2 });
    expect(baseLine(dp, names, false)).toBe('Double play. Bases empty. 2 out.');
    const force = ab({ outcome: 'oip', outType: 'ground', basesBefore: ['r1', null, null], basesAfter: ['bat', null, null], runnersOut: ['r1'], outsAfter: 1 });
    expect(forceRunner(force, names)).toBe('Ruth');
    expect(baseLine(force, names, false)).toBe('Runner on first. 1 out.');
    const third = ab({ outcome: 'k', basesBefore: ['r1', 'r2', null], basesAfter: [null, null, null], outsBefore: 2, outsAfter: 3 });
    expect(baseLine(third, names, false)).toBe('Side retired.');
    const walkOff = ab({ battingSide: 0, scored: ['r1'], points: 1, basesBefore: [null, null, 'r1'], basesAfter: [null, null, null], outsAfter: 1 });
    expect(baseLine(walkOff, names, true)).toBe('Ruth scores. Game over.');
  });

  it('labels halves and the half change', () => {
    expect(halfLabel(1, 1)).toBe('Top 1');
    expect(halfLabel(3, 0)).toBe('Bottom 3');
    expect(ordinal(1)).toBe('1st'); expect(ordinal(2)).toBe('2nd'); expect(ordinal(3)).toBe('3rd'); expect(ordinal(9)).toBe('9th'); expect(ordinal(11)).toBe('11th');
    const last = ab({ battingSide: 1, outsAfter: 3 });
    const next = ab({ battingSide: 0, index: 1 });
    expect(halfChange(last, next, [0, 2], s => (s === 0 ? 'Red Sox' : 'Yankees'), false)).toBe('Middle of the 1st: Yankees 2, Red Sox 0.');
    expect(halfChange(ab({ battingSide: 0, outsAfter: 3 }), ab({ inning: 2, battingSide: 1 }), [1, 1], s => (s === 0 ? 'H' : 'V'), false)).toBe('End of the 1st: V 1, H 1.');
    expect(halfChange(ab({ outsAfter: 1 }), ab({ index: 1 }), [0, 0], () => 'x', false)).toBeNull();
    expect(halfChange(ab({ outsAfter: 1 }), ab({ battingSide: 0 }), [0, 9], () => 'x', true)).toContain('stopped after 30 batters');
  });

  it('writes the result line, walk-offs and ties', () => {
    const g = (over: Partial<CGame>): CGame => ({ lineups: [], atBats: [ab({ battingSide: 0, points: 1 })], totals: [3, 2], winner: 0, notes: [], innings: 1, ...over });
    expect(inningResult(g({}), 0, s => (s === 0 ? 'Home' : 'Away'))).toBe('You win 3-2 on a walk-off');
    expect(inningResult(g({ atBats: [ab({ battingSide: 1 })], totals: [1, 4], winner: 1 }), 0, () => '')).toBe('You lose 1-4');
    expect(inningResult(g({ winner: -1, totals: [0, 0], innings: 4 }), 1, () => '')).toBe('Tied after 3 extra innings');
    expect(inningResult(g({ atBats: [ab({ battingSide: 1 })], totals: [1, 4], winner: 1 }), null, s => (s === 1 ? 'Slugger 1' : 'x'))).toBe('Slugger 1 wins 4-1');
  });
});

describe('plan 38 lineup rules while picking', () => {
  const row = (slot: number, id: string, year: number): CSlot => ({ slot, choices: [P(id, id, year)] });
  const full = () => [row(0, 'p', 1965), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => row(k, `b${k}`, k === 4 ? 1931 : k === 7 ? 1931 : 1965))];

  it('sits out the oldest-season batter (lowest row on a tie), moves the rows below up, never the newest', () => {
    const rows = full();
    expect(oldestRow(rows)).toBe(4);
    const r = sitOut(rows);
    expect(r.out?.choices[0].id).toBe('b4');
    expect(r.rows.map(x => x?.choices[0].id ?? null)).toEqual(['p', 'b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'b8', 'b9', null]);
    expect(r.rows.slice(0, 9).every((x, i) => x?.slot === i)).toBe(true);
  });

  it('keys an era answer to exactly the rows that will be sent', () => {
    const rows = full();
    expect(rowsKey(rows, 8)).not.toBe(rowsKey(rows, 9));
    expect(rowsKey(rows, 8).split(',').length).toBe(9);
  });

  it('sends the mode with every team', () => {
    const body = toBody(full(), 'Slugger 1');
    expect(body.mode).toBe('inning');
    expect(body.picks.length).toBe(10);
    expect(toBody(full().slice(0, 4), undefined, 'classic').mode).toBe('classic');
  });

  it('asks quick pick and the era preview with the right query', async () => {
    const urls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ era: null, batters: 8, slots: [], dh: false, runnerOnSecond: false, season: 1965 }), { status: 200 }); }) as typeof fetch;
    try {
      await capi.quickpickInning();
      await capi.quickpickInning(8);
      await capi.era(P('p', 'P', 1965), [P('b1', 'B', 1931), P('b2', 'C', 1965)]);
    } finally { globalThis.fetch = real; }
    expect(urls[0]).toBe('/api/challenges/quickpick?mode=inning');
    expect(urls[1]).toBe('/api/challenges/quickpick?mode=inning&batters=8');
    expect(urls[2]).toBe('/api/challenges/era?p=p%3A1965&b=b1%3A1931&b=b2%3A1965');
  });
});

describe('plan 38 calls a3', () => {
  const facts = (o: Partial<{ outType: 'ground' | 'fly' | 'line' | 'pop' | 'error'; doublePlay: boolean; sacFly: boolean; forceRunner: string | null }>) =>
    ({ outType: null, doublePlay: false, sacFly: false, forceRunner: null, ...o }) as never;

  it('uses c2 and the a2 text for everything but outs in play', () => {
    for (let i = 0; i < 200; i++) for (const o of ['k', 'bb', 'hbp', 'single', 'double', 'triple', 'hr'] as const) {
      const seed = `q${i}`;
      expect(countFor(o, seed, '3')).toEqual(countFor(o, seed, '2'));
      const c = countFor(o, seed, '2');
      expect(callFor(o, seed, c, 'B', 'R', 'R', '3', 1990, facts({}))).toEqual(callFor(o, seed, c, 'B', 'R', 'R', '2', 1990));
    }
  });

  it('keeps a2 word for word when a2 rolled the same out type the server scored', () => {
    let same = 0;
    for (let i = 0; i < 300; i++) {
      const seed = `w${i}`, c = countFor('oip', seed, '2');
      const a2 = callFor('oip', seed, c, 'B', 'L', 'R', '2', 1990);
      if (a2.type === 'foul') continue;
      const a3 = callFor('oip', seed, c, 'B', 'L', 'R', '3', 1990, facts({ outType: a2.type as 'ground' }));
      expect(a3).toEqual(a2);
      same++;
    }
    expect(same).toBeGreaterThan(200);
  });

  it('follows the server out type for words and the ball path', () => {
    for (let i = 0; i < 200; i++) {
      const seed = `v${i}`, c = countFor('oip', seed, '3');
      const call = (f: object) => callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, facts(f));
      expect(call({ outType: 'ground' }).trajectory).toBe('ground');
      expect(call({ outType: 'ground' }).text).toMatch(/^Ruth grounded out to (third|short|second|first|the pitcher)\.$/);
      expect(call({ outType: 'ground', doublePlay: true }).text).toBe('Ruth grounded into a double play.');
      expect(call({ outType: 'ground', forceRunner: 'Gehrig' }).text).toBe('Ruth grounded into a force out; Gehrig out at second.');
      expect(call({ outType: 'fly' }).text).toMatch(/^Ruth flied out to (deep )?(left|center|right)\.$/);
      expect(call({ outType: 'fly', sacFly: true }).text).toMatch(/^Ruth hit a sacrifice fly to (deep )?(left|center|right)\.$/);
      expect(call({ outType: 'line' }).trajectory).toBe('line');
      expect(call({ outType: 'line', doublePlay: true }).text).toBe('Ruth lined into a double play.');
      expect(call({ outType: 'pop' }).trajectory).toBe('pop');
      const err = call({ outType: 'error' });
      expect(err.trajectory).toBe('ground');
      expect(err.type).toBe('error');
      expect(err.text).toMatch(/^Ruth reached on an error by the (third baseman|shortstop|second baseman|first baseman|pitcher)\.$/);
      expect(call({ outType: 'pop' }).text).not.toContain('fouled');
    }
  });

  it('falls back to a2 when an inning play has no out type (never for outs in play from the server)', () => {
    const c = countFor('oip', 'z', '2');
    expect(callFor('oip', 'z', c, 'B', 'R', 'R', '3', 1990, null)).toEqual(callFor('oip', 'z', c, 'B', 'R', 'R', '2', 1990));
  });
});

describe('plan 38 expert gate: liners and walk-offs', () => {
  const lineAb = (over: Partial<CAtBat>) => ab({ outcome: 'oip', outType: 'line', outsBefore: 1, outsAfter: 2, ...over });

  it('a liner a runner tagged on is caught in the outfield; a run on it is a sacrifice fly', () => {
    for (let i = 0; i < 150; i++) {
      const seed = `L${i}`, c = countFor('oip', seed, '3');
      const run = lineAb({ seed, basesBefore: [null, null, 'r1'], basesAfter: [null, null, null], scored: ['r1'], points: 1 });
      const f = playFacts(run, names);
      expect(f.sacFly).toBe(true);
      expect(f.tagged).toBe(true);
      const call = callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, f);
      expect(call.text).toMatch(/^Ruth lined out to (left|center|right) for a sacrifice fly\.$/);
      const thrown = lineAb({ seed, basesBefore: [null, null, 'r1'], basesAfter: [null, null, null], runnersOut: ['r1'], outsAfter: 3 });
      expect(callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, playFacts(thrown, names)).fielder).toMatch(/^(LF|CF|RF)$/);
      const moved = lineAb({ seed, basesBefore: [null, 'r1', null], basesAfter: [null, null, 'r1'] });
      expect(callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, playFacts(moved, names)).fielder).toMatch(/^(LF|CF|RF)$/);
      // Nobody moves: a2's line table as before (infielders allowed), same as an untagged a3 call.
      const still = lineAb({ seed, basesBefore: ['r1', null, null], basesAfter: ['r1', null, null] });
      const plain = callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, playFacts(still, names));
      expect(plain.text).not.toContain('sacrifice');
      expect(plain).toEqual(callFor('oip', seed, c, 'Ruth', 'R', 'R', '3', 1927, { outType: 'line', doublePlay: false, sacFly: false, forceRunner: null }));
    }
  });

  it('a walk-off liner with a run reads as a sacrifice fly and then Game over', () => {
    const w = lineAb({ battingSide: 0, basesBefore: [null, null, 'r1'], basesAfter: [null, null, null], scored: ['r1'], points: 1 });
    expect(playFacts(w, names).sacFly).toBe(true);
    expect(baseLine(w, names, true)).toBe('Ruth scores. Game over.');
  });

  it('a walk-off hit names nobody out after the winning run', () => {
    const w = ab({ battingSide: 0, outcome: 'double', outsBefore: 2, outsAfter: 2, basesBefore: ['r1', null, 'r2'], basesAfter: [null, null, null], scored: ['r2'], points: 1, runnersOut: [] });
    expect(baseLine(w, names, true)).toBe('Gehrig scores. Game over.');
  });
});

