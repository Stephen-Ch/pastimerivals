import { callFor, countFor, hitsFrom, OUTCOMES } from './logic';

const ALLOWED: Record<string, string[]> = {
  ground: ['3B', 'SS', '2B', 'P', '1B'], line: ['3B', 'SS', 'LF', 'P', '2B', 'CF', '1B', 'RF'],
  fly: ['LF', 'CF', 'RF'], pop: ['1B', '2B', 'SS', '3B'], foul: ['3B', 'LF', 'C', '1B', 'RF'],
};

describe('callFor (plan 12)', () => {
  it('gives a sensible call for every outcome and many seeds', () => {
    for (const o of OUTCOMES) {
      for (let i = 0; i < 2000; i++) {
        const seed = `s${i}`;
        const c = countFor(o, seed);
        const call = callFor(o, seed, c, 'Babe Ruth', 'L', 'R');
        expect(call.text.startsWith('Babe Ruth ')).toBe(true);
        expect(call.text.endsWith('.')).toBe(true);
        if (o === 'k') expect(call.text).toContain(c.finalKind === 'called' ? 'looking' : 'swinging');
        if (o === 'bb') expect(call.text.includes('four pitches')).toBe(c.leadUp.length === 3 && c.strikes === 0);
        if (call.fielder) expect(ALLOWED[call.type]).toContain(call.fielder);
        if (call.spot === 'center') expect(call.text).not.toMatch(/down the|corner/);
        expect(call.text).not.toContain('undefined');
      }
    }
  });

  it('is the same for the same seed', () => {
    const c = countFor('oip', 'z');
    expect(callFor('oip', 'z', c, 'A', 'R', 'R')).toEqual(callFor('oip', 'z', c, 'A', 'R', 'R'));
  });

  it('pulls to left for righties and right for lefties, about half the time', () => {
    for (const [bats, pullField] of [['R', 'left'], ['L', 'right']] as const) {
      let pulled = 0;
      for (let i = 0; i < 2000; i++) {
        const call = callFor('hr', `p${i}`, countFor('hr', `p${i}`), 'X', bats, 'R');
        if (call.dir === 'pull') { pulled++; expect(call.spot!.startsWith(pullField)).toBe(true); }
      }
      expect(pulled / 2000).toBeGreaterThan(0.4);
      expect(pulled / 2000).toBeLessThan(0.6);
    }
  });

  it('switch hitters bat opposite the pitcher; unknowns count as right', () => {
    expect(hitsFrom('B', 'R')).toBe('L');
    expect(hitsFrom('B', 'L')).toBe('R');
    expect(hitsFrom(null, null)).toBe('R');
    expect(hitsFrom('B', null)).toBe('L');
  });
});
