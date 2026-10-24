import { callFor, countFor, OUTCOMES, PlayFacts } from './logic';
import { intro, IntroCtx, lineText, PbpLine, PHRASES, pitchLines, rawLead, recapLines, RecapAb, RecapCtx, resultLine, Seg, Situation, wordCount } from './pbp';

const keysOk = (l: PbpLine) => l.segs.every(s => !('p' in s) || !!PHRASES[s.p]);
const nameLast = (l: PbpLine) => l.segs.every((s, i) => !('name' in s) || i === l.segs.length - 1);
const noName = (l: PbpLine) => l.segs.every((s: Seg) => !('name' in s));
const he = /\b(he|he's|he'll)\b/i;
const sit = (o: Partial<Situation>): Situation => ({ outs: 0, bases: [null, null, null], inning: 1, battingSide: 1, firstOfHalf: false, deficit: 0, lastScheduledInning: 1, ...o });
const ictx = (o: Partial<IntroCtx>): IntroCtx => ({ key: 'k', index: 3, batter: { id: 'b1', name: 'Josh Gibson' }, pitcher: { id: 'p1', name: 'Satchel Paige' }, showPitcher: false, pitchingSide: null, situation: null, ...o });

describe('plan 42: play-by-play', () => {
  it('every pitch and result line uses catalog keys, no names, and stays within its word limit', () => {
    const types = ['ground', 'fly', 'line', 'pop', 'error'] as const;
    let n = 0;
    for (let i = 0; i < 150; i++) for (const o of OUTCOMES) for (const [bats, thr] of [['R', 'R'], ['L', 'R'], ['B', 'L'], ['R', 'L']]) for (const deco of ['2', '3'] as const) {
      const seed = `s${i * 7919 % 100003}`;
      const count = countFor(o, seed, deco);
      const t = types[(i + n) % 5];
      const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: i % 7 === 0 && (t === 'ground' || t === 'line'), sacFly: i % 5 === 0 && (t === 'fly' || t === 'line'), forceRunner: i % 6 === 1 && t === 'ground' ? 'Runner Y' : null } : null;
      const call = callFor(o, seed, count, 'Batter X', bats, thr, deco, 1955, facts);
      let typeWord = false;
      for (let p = 0; p <= count.leadUp.length; p++) {
        const pl = pitchLines({ key: seed, index: 0, count, runnersOn: i % 2 === 0, throws: thr, era: '1946-1969', seed }, p);
        if (pl.delivery) { expect(keysOk(pl.delivery)).toBe(true); expect(noName(pl.delivery)).toBe(true); expect(lineText(pl.delivery)).not.toMatch(he); expect(wordCount(pl.delivery)).toBeLessThanOrEqual(5); }
        if (pl.call) { expect(keysOk(pl.call)).toBe(true); expect(noName(pl.call)).toBe(true); expect(wordCount(pl.call)).toBeLessThanOrEqual(7); }
        expect(pl.delivery && pl.typeWord).toBeFalsy();
        if (p === count.leadUp.length) typeWord = pl.typeWord;
      }
      const res = resultLine({ key: seed, index: 0, outcome: o, count, call, play: facts, era: '1946-1969', seed, typeWord });
      expect(keysOk(res)).toBe(true);
      expect(noName(res)).toBe(true);
      expect(wordCount(res)).toBeLessThanOrEqual(10);
      n++;
    }
  });

  it('the same seed always gives the same lines', () => {
    const count = countFor('double', 'z9', '3');
    const call = callFor('double', 'z9', count, 'X', 'R', 'R', '3', 1990, null);
    const a = JSON.stringify([pitchLines({ key: 'z9', index: 2, count, runnersOn: true, throws: 'R', era: '1990-2025', seed: 'z9' }, 0), resultLine({ key: 'z9', index: 2, outcome: 'double', count, call, play: null, era: '1990-2025', seed: 'z9', typeWord: false })]);
    const b = JSON.stringify([pitchLines({ key: 'z9', index: 2, count, runnersOn: true, throws: 'R', era: '1990-2025', seed: 'z9' }, 0), resultLine({ key: 'z9', index: 2, outcome: 'double', count, call, play: null, era: '1990-2025', seed: 'z9', typeWord: false })]);
    expect(a).toBe(b);
  });

  it('intro: the name comes last after a pause; the pitcher line only when asked', () => {
    const x = intro(ictx({ showPitcher: true, pitchingSide: 0 }), null);
    expect(nameLast(x.batter)).toBe(true);
    expect(nameLast(x.pitcher!)).toBe(true);
    expect(lineText(x.batter)).toMatch(/\.\.\. Josh Gibson\.$/);
    expect(lineText(x.pitcher!)).toMatch(/Satchel Paige\.$/);
    expect(intro(ictx({}), null).pitcher).toBeNull();
  });

  it('intro: situation lead-ins follow the radio rules', () => {
    const lead = (s: Partial<Situation>) => PHRASES[rawLead(ictx({ situation: sit(s) }))].t;
    expect(lead({ bases: ['a', 'b', 'c'] })).toBe("Bases loaded, here's...");
    expect(lead({ battingSide: 0, inning: 1, bases: ['a', null, null], deficit: 1 })).toBe('Winning run at the plate...');
    expect(lead({ battingSide: 1, inning: 1, bases: ['a', null, null], deficit: 1 })).toBe('Go-ahead run at the plate...');
    expect(lead({ bases: ['a', null, null], deficit: 2 })).toBe('Tying run at the plate...');
    expect(lead({ outs: 2 })).toBe("With two down, here's...");
    expect(['Leading off...', 'To lead it off...']).toContain(lead({ firstOfHalf: true }));
    // Never the same lead-in twice in a row when there is a choice.
    for (let i = 0; i < 40; i++) {
      const prev = rawLead(ictx({ index: i - 1 }));
      expect(intro(ictx({ index: i }), prev).lead).not.toBe(prev);
    }
  });

  const ab = (o: Partial<RecapAb>): RecapAb => ({ outcome: 'single', battingSide: 0, inning: 1, outsBefore: 0, outsAfter: 0, basesBefore: [null, null, null], basesAfter: ['b', null, null], scored: [], runnersOut: [], doublePlay: false, batterId: 'b', ...o });
  const rctx = (a: RecapAb, o: Partial<RecapCtx> = {}): RecapCtx => ({ key: 'k', index: 1, ab: a, outAt: f => (f === 1 ? 'home' : 'second'), scoreBefore: [0, 0], scoreAfter: [0, 0], lastOfGame: false, halfEnds: false, capped: false, nextIsNewHalf: false, halfPlays: [a], throws: 'L', lastScheduledInning: 1, ...o });
  const texts = (ls: PbpLine[]) => ls.map(lineText);

  it('recap: runs, ties, lead changes, runners out and bases', () => {
    const t = texts(recapLines(rctx(ab({ outcome: 'double', basesBefore: ['r1', 'r2', null], basesAfter: [null, 'b', null], scored: ['r2'], runnersOut: ['r1'] }), { scoreBefore: [0, 1], scoreAfter: [1, 1], outAt: () => 'home' })));
    expect(t).toContain('A run scores.');
    expect(t).toContain('That ties it!');
    expect(t).toContain('The runner from first is out at home.');
    expect(t.some(x => /Man at second, nobody out\./.test(x))).toBe(true);
    expect(t.some(x => /\bhe\b/i.test(x))).toBe(false);   // a run-scoring recap never says "he"
  });

  it('recap: walk-off, home team not needing to bat, side retired with the score', () => {
    expect(texts(recapLines(rctx(ab({ basesBefore: [null, 'r', null], scored: ['r'] }), { lastOfGame: true, scoreBefore: [1, 1], scoreAfter: [2, 1] })))[0]).toMatch(/winning run/i);
    expect(texts(recapLines(rctx(ab({ outcome: 'hr', basesAfter: [null, null, null], scored: ['b'] }), { lastOfGame: true, scoreBefore: [1, 1], scoreAfter: [2, 1] })))[0]).toBe("He's home! The home team wins!");
    expect(texts(recapLines(rctx(ab({ battingSide: 1, outcome: 'k', outsBefore: 2, outsAfter: 3, basesAfter: [null, null, null] }), { lastOfGame: true, scoreBefore: [2, 1], scoreAfter: [2, 1] })))).toContain("The home team won't need to bat.");
    const end = texts(recapLines(rctx(ab({ battingSide: 1, outcome: 'oip', outsBefore: 2, outsAfter: 3, basesAfter: [null, null, null] }), { halfEnds: true, scoreBefore: [0, 2], scoreAfter: [0, 2] })));
    expect(end).toContain('Heading to the bottom half, the visitors lead by two.');
  });

  it('pitcher recap lines name the pitcher by role and never say "he"', () => {
    for (let i = 0; i < 30; i++) {
      const t = texts(recapLines(rctx(ab({ outcome: 'k', outsBefore: 0, outsAfter: 1, basesAfter: [null, null, null] }), { index: i, throws: 'R' })));
      expect(t.some(x => /right-hander/i.test(x))).toBe(true);
      expect(t.every(x => !/^He\b/.test(x))).toBe(true);
    }
    const jam = texts(recapLines(rctx(ab({ outcome: 'bb', basesBefore: ['r', null, null], basesAfter: ['b', 'r', null] }), { throws: 'L' })));
    expect(jam.some(x => /lefty|pitcher/.test(x))).toBe(true);
  });
});

describe('plan 42: catalog', () => {
  it('no phrase is longer than 10 words', () => {
    const long = Object.entries(PHRASES).filter(([, v]) => v.t.split(/\s+/).length > 10).map(([k, v]) => `${k}: ${v.t}`);
    expect(long).toEqual([]);
  });
});
