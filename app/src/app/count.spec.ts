import { countFor, MAX_FOULS, MAX_LEAD_UP, OUTCOMES } from './logic';

describe('countFor (plan 11)', () => {
  it('builds a legal count for every outcome and many seeds', () => {
    for (const o of OUTCOMES) {
      for (let i = 0; i < 2000; i++) {
        const c = countFor(o, `seed-${i}`);
        const total = c.leadUp.length + 1;
        let b = 0, s = 0, fouls = 0;
        for (const p of c.leadUp) {
          if (p.kind === 'ball') b++;
          else if (p.kind === 'foul') { fouls++; if (s < 2) s++; }
          else s++;
          expect(p.balls).toBe(b);
          expect(p.strikes).toBe(s);
          expect(b).toBeLessThanOrEqual(3);
          expect(s).toBeLessThanOrEqual(2);
        }
        expect(fouls).toBeLessThanOrEqual(MAX_FOULS);
        expect(c.leadUp.length).toBeLessThanOrEqual(MAX_LEAD_UP);
        expect([c.balls, c.strikes]).toEqual([b, s]);
        if (o === 'k') { expect(s).toBe(2); expect(total).toBeGreaterThanOrEqual(3); expect(c.finalKind).not.toBeNull(); }
        else expect(c.finalKind).toBeNull();
        if (o === 'bb') { expect(b).toBe(3); expect(total).toBeGreaterThanOrEqual(4); }
        expect(total).toBeLessThanOrEqual(7);
      }
    }
  });

  it('gives the same count for the same seed', () => {
    expect(countFor('hr', 'abc')).toEqual(countFor('hr', 'abc'));
    const varied = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(countFor('single', String(i)))));
    expect(varied.size).toBeGreaterThan(5);
  });
});
