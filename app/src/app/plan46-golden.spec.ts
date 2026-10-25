// Plan 46: golden check. The text track (intro, pitch calls, delivery, results, recaps) must not change.
import { callFor, countFor, OUTCOMES, PlayFacts } from './logic';
import { intro, IntroCtx, lineText, pitchLines, rawLead, recapLines, RecapAb, RecapCtx, resultLine, Situation } from './pbp';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const ERAS = ['1901-1919', '1946-1969', '1990-2025'] as const;

export function pitchGolden(): { text: string; n: number } {
  const out: string[] = [];
  const types = ['ground', 'fly', 'line', 'pop', 'error'] as const;
  let n = 0;
  for (let i = 0; i < 2000; i++) for (const deco of ['1', '2', '3'] as const) {
    const o = OUTCOMES[i % OUTCOMES.length];
    const seed = `g${i}`;
    const [bats, thr] = [['R', 'R'], ['L', 'R'], ['B', 'L'], ['R', 'L']][i % 4];
    const era = ERAS[i % 3] as any;
    const count = countFor(o, seed, deco);
    const t = types[i % 5];
    const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: i % 7 === 0 && (t === 'ground' || t === 'line'), sacFly: i % 5 === 0 && (t === 'fly' || t === 'line'), forceRunner: i % 6 === 1 && t === 'ground' ? 'Runner Y' : null } : null;
    const call = callFor(o, seed, count, 'Batter X', bats, thr, deco, 1900 + (i % 125), facts);
    let typeWord = false;
    for (let p = 0; p <= count.leadUp.length; p++) {
      const pl = pitchLines({ key: seed, index: i % 9, count, runnersOn: i % 3 === 0, throws: i % 5 === 0 ? null : thr, era, seed }, p);
      out.push(pl.delivery ? lineText(pl.delivery) : '-', pl.call ? lineText(pl.call) : '-', String(pl.typeWord));
      if (p === count.leadUp.length) typeWord = pl.typeWord;
    }
    out.push(lineText(resultLine({ key: seed, index: i % 9, outcome: o, count, call, play: facts, era, seed, typeWord })));
    n++;
  }
  return { text: fnv(out.join('|')), n };
}

export function introRecapGolden(): string {
  const out: string[] = [];
  const sitFor = (i: number): Situation | null => i % 11 === 0 ? null : ({
    outs: i % 3, bases: [i & 1 ? 'a' : null, i & 2 ? 'b' : null, i & 4 ? 'c' : null], inning: 1 + (i % 10), battingSide: (i >> 3) & 1,
    firstOfHalf: i % 5 === 0, deficit: (i % 7) - 2, lastScheduledInning: 1 + (i % 9),
  });
  let prev: string | null = null;
  for (let i = 0; i < 2000; i++) {
    const ctx: IntroCtx = { key: `i${i % 37}`, index: i, batter: { id: 'b' + i, name: 'Bat ' + i }, pitcher: { id: 'p', name: 'Pit' }, showPitcher: i % 4 === 0, pitchingSide: i % 3 === 0 ? null : i % 3 === 1 ? 0 : 1, situation: sitFor(i) };
    const x = intro(ctx, prev);
    out.push(x.pitcher ? lineText(x.pitcher) : '-', lineText(x.batter), x.lead);
    prev = rawLead(ctx);
  }
  const outcomes = OUTCOMES;
  for (let i = 0; i < 2000; i++) {
    const o = outcomes[i % outcomes.length];
    const bb: (string | null)[] = [i & 1 ? 'r1' : null, i & 2 ? 'r2' : null, i & 4 ? 'r3' : null];
    const ba: (string | null)[] = [i & 8 ? 'b' : null, i & 16 ? 'r1' : null, i & 32 ? 'r2' : null];
    const scored = (['r3', 'r2', 'r1'].filter(r => bb.includes(r))).slice(0, i % 4);
    const outsBefore = i % 3, outsAfter = Math.min(3, outsBefore + (i % 2));
    const ab: RecapAb = { outcome: o, battingSide: (i >> 2) & 1, inning: 1 + (i % 16), outsBefore, outsAfter, basesBefore: bb, basesAfter: ba, scored, runnersOut: i % 9 === 0 && bb[0] ? ['r1'] : [], doublePlay: i % 13 === 0, batterId: 'b' };
    const sb: [number, number] = [i % 5, (i >> 1) % 5];
    const sa: [number, number] = ab.battingSide === 0 ? [sb[0] + scored.length, sb[1]] : [sb[0], sb[1] + scored.length];
    const ctx: RecapCtx = { key: `r${i % 41}`, index: i, ab, outAt: f => (f === 0 ? 'second' : f === 1 ? 'third' : 'home'), scoreBefore: sb, scoreAfter: sa,
      lastOfGame: i % 17 === 0, halfEnds: outsAfter === 3 || i % 19 === 0, capped: i % 23 === 0, nextIsNewHalf: i % 2 === 0, halfPlays: [ab, ab, ab].slice(0, 1 + (i % 3)),
      throws: ['R', 'L', null][i % 3], lastScheduledInning: 1 + (i % 9) };
    out.push(recapLines(ctx).map(lineText).join('/'));
  }
  return fnv(out.join('|'));
}

describe('plan 46: text track golden', () => {
  it('pitch calls, deliveries and results are unchanged', () => {
    const g = pitchGolden();
    expect(g.text).toBe('aa111400');
  });
  it('intro and recap lines are unchanged', () => {
    const g = introRecapGolden();
    expect(g).toBe('ea597b1f');
  });
});
