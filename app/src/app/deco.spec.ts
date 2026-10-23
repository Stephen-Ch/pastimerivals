import { callFor, countFor, finalCaption, hitsFrom, OUTCOMES, resolveDeco } from './logic';
import { V1_FIXTURE } from './logic-v1-fixture';
import { V2_FIXTURE } from './logic-v2-fixture';
import { V3_FIXTURE } from './logic-v3-fixture';
import { frameAt, planPitch } from './pitch-scene';

const h = (s: string, off: number) => { let x = off >>> 0; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };

describe('plan 32A decoration versions', () => {
  it('replays version 1 (c1 + a1) byte for byte, as frozen before any change', () => {
    let all = '';
    const sample: Record<string, unknown> = {};
    let n = 0;
    for (let i = 0; i < 300; i++) for (const o of OUTCOMES) for (const [bats, thr] of [['R', 'R'], ['L', 'R'], ['B', 'R'], ['B', 'L'], ['R', 'L'], ['L', 'L']]) {
      const seed = `s${i * 7919 % 100003}`;
      const c = countFor(o, seed, '1');
      const line = JSON.stringify({ c, a: callFor(o, seed, c, 'Batter X', bats, thr, '1', 1910) });
      all += line + '\n';
      if (n++ % 500 === 0) sample[`${o}|${seed}|${bats}|${thr}`] = JSON.parse(line);
    }
    expect(n).toBe(V1_FIXTURE.entries);
    expect(all.length).toBe(V1_FIXTURE.length);
    expect(h(all, 2166136261)).toBe(V1_FIXTURE.h1);
    expect(h(all, 0x811c9dc5 ^ 0x5bd1e995)).toBe(V1_FIXTURE.h2);
    expect(JSON.stringify(sample)).toBe(JSON.stringify(V1_FIXTURE.sample));
  }, 30000);

  it('replays version 3 (c2 + a3, inning games) byte for byte, as frozen when plan 38 shipped', () => {
    const types = ['ground', 'fly', 'line', 'pop', 'error'] as const;
    let all = '';
    const sample: Record<string, unknown> = {};
    let n = 0;
    const years = [1910, 1955, 1990, 2020];
    for (let i = 0; i < 300; i++) for (const o of OUTCOMES) for (const [bats, thr] of [['R', 'R'], ['L', 'R'], ['B', 'R'], ['B', 'L'], ['R', 'L'], ['L', 'L']]) {
      const seed = `s${i * 7919 % 100003}`, year = years[i % 4];
      const t = types[(i + n) % 5];
      const facts = { outType: o === 'oip' ? t : null, doublePlay: (i % 7 === 0) && (t === 'ground' || t === 'line'), sacFly: (i % 5 === 0) && (t === 'fly' || t === 'line'), forceRunner: i % 6 === 1 && t === 'ground' ? 'Runner Y' : null, tagged: (i % 5 === 0 || i % 4 === 1) && t === 'line' };
      const c = countFor(o, seed, '3');
      const line = JSON.stringify({ c, a: callFor(o, seed, c, 'Batter X', bats, thr, '3', year, facts) });
      all += line + '\n';
      if (n++ % 500 === 0) sample[`${o}|${seed}|${bats}|${thr}|${year}`] = JSON.parse(line);
    }
    expect(n).toBe(V3_FIXTURE.entries);
    expect(all.length).toBe(V3_FIXTURE.length);
    expect(h(all, 2166136261)).toBe(V3_FIXTURE.h1);
    expect(h(all, 0x811c9dc5 ^ 0x5bd1e995)).toBe(V3_FIXTURE.h2);
    expect(JSON.stringify(sample)).toBe(JSON.stringify(V3_FIXTURE.sample));
  }, 30000);

  it('replays version 2 (c2 + a2) byte for byte, as frozen before plan 38 stage C', () => {
    let all = '';
    const sample: Record<string, unknown> = {};
    let n = 0;
    const years = [1910, 1955, 1990, 2020];
    for (let i = 0; i < 300; i++) for (const o of OUTCOMES) for (const [bats, thr] of [['R', 'R'], ['L', 'R'], ['B', 'R'], ['B', 'L'], ['R', 'L'], ['L', 'L']]) {
      const seed = `s${i * 7919 % 100003}`, year = years[i % 4];
      const c = countFor(o, seed, '2');
      const line = JSON.stringify({ c, a: callFor(o, seed, c, 'Batter X', bats, thr, '2', year) });
      all += line + '\n';
      if (n++ % 500 === 0) sample[`${o}|${seed}|${bats}|${thr}|${year}`] = JSON.parse(line);
    }
    expect(n).toBe(V2_FIXTURE.entries);
    expect(all.length).toBe(V2_FIXTURE.length);
    expect(h(all, 2166136261)).toBe(V2_FIXTURE.h1);
    expect(h(all, 0x811c9dc5 ^ 0x5bd1e995)).toBe(V2_FIXTURE.h2);
    expect(JSON.stringify(sample)).toBe(JSON.stringify(V2_FIXTURE.sample));
  }, 30000);

  it('reads versions: missing = 1, unknown = newest plus a refresh flag', () => {
    expect(resolveDeco(undefined)).toEqual({ deco: '1', unknown: false });
    expect(resolveDeco('1')).toEqual({ deco: '1', unknown: false });
    expect(resolveDeco(2)).toEqual({ deco: '2', unknown: false });
    expect(resolveDeco('9')).toEqual({ deco: '2', unknown: true });
    expect(resolveDeco(3)).toEqual({ deco: '3', unknown: false });
  }, 30000);

  it('c2 counts are legal and match the review rates', () => {
    let k = 0, called = 0, tip = 0, inPlay = 0, threeOh = 0, first = 0, firstFoul = 0, firstCalled = 0;
    for (let i = 0; i < 20000; i++) for (const o of OUTCOMES) {
      const c = countFor(o, `x${i}`, '2');
      expect(c.leadUp.length).toBeLessThanOrEqual(6);
      expect(c.leadUp.filter(p => p.kind === 'foul').length).toBeLessThanOrEqual(3);
      expect(c.balls).toBeLessThanOrEqual(3); expect(c.strikes).toBeLessThanOrEqual(2);
      if (o === 'bb') expect(c.balls).toBe(3);
      if (o === 'k') { k++; expect(c.strikes).toBe(2); if (c.finalKind === 'called') called++; if (c.finalKind === 'tip') tip++; }
      if (!['k', 'bb', 'hbp'].includes(o)) { inPlay++; if (c.balls === 3 && c.strikes === 0) threeOh++; }
      const s1 = c.leadUp.find(p => p.kind !== 'ball');
      if (s1) { first++; if (s1.kind === 'foul') firstFoul++; if (s1.kind === 'called') firstCalled++; }
    }
    expect(Math.abs(called / k - 0.23)).toBeLessThan(0.02);
    expect(Math.abs(tip / k - 0.07)).toBeLessThan(0.02);
    expect(threeOh / inPlay).toBeLessThan(0.015);
    expect(Math.abs(firstFoul / first - 0.40)).toBeLessThan(0.02);
    expect(Math.abs(firstCalled / first - 0.35)).toBeLessThan(0.02);
  }, 30000);

  it('a2 calls follow the fielder and flight rules', () => {
    const IF = ['P', '1B', '2B', 'SS', '3B'], OF = ['LF', 'CF', 'RF'];
    let triples = 0, leftCorner = 0, itp = 0, deadHr = 0;
    for (let i = 0; i < 4000; i++) for (const [bats, thr] of [['R', 'R'], ['L', 'R'], ['B', 'L']]) for (const year of [1910, 1990]) {
      for (const o of OUTCOMES) {
        const seed = `y${i}`, c = countFor(o, seed, '2'), a = callFor(o, seed, c, 'B', bats, thr, '2', year);
        if (a.type === 'ground') expect(IF).toContain(a.fielder);
        if (a.type === 'fly') expect(OF).toContain(a.fielder);
        if (a.type === 'pop') expect([...IF.slice(1), 'C']).toContain(a.fielder);
        if (a.type === 'line') expect(a.fielder).not.toBe('C');
        if (a.type === 'foul') expect(['C', '1B', '3B', 'LF', 'RF']).toContain(a.fielder);
        if (o === 'single') expect(['ground', 'line', 'bloop']).toContain(a.trajectory);
        if (o === 'double' || o === 'triple') expect(['line', 'fly']).toContain(a.trajectory);
        if (o === 'triple') { triples++; if (a.spot === 'left') { leftCorner++; expect(a.trajectory).toBe('line'); } }
        if (o === 'hr') {
          if (a.insideTheParkHr) { itp++; expect(year).toBe(1910); expect(a.trajectory).toBe('line'); expect(a.text).toContain('inside-the-park'); }
          else expect(a.trajectory).toBe('fly');
          if (year === 1910) deadHr++;
        }
        if (o === 'k' && c.finalKind === 'tip') expect(a.text).toContain('foul tip');
      }
    }
    expect(leftCorner / triples).toBeLessThan(0.08);
    expect(Math.abs(itp / deadHr - 0.5)).toBeLessThan(0.04);
  }, 30000);

  it('switch hitters bat opposite the pitcher, and the call mirrors with them', () => {
    expect(hitsFrom('B', 'R')).toBe('L');
    expect(hitsFrom('B', 'L')).toBe('R');
    for (let i = 0; i < 200; i++) {
      const c = countFor('oip', `z${i}`, '2');
      const sw = callFor('oip', `z${i}`, c, 'B', 'B', 'R', '2', 1990), lefty = callFor('oip', `z${i}`, c, 'B', 'L', 'R', '2', 1990);
      expect(sw).toEqual(lefty);
    }
  }, 30000);

  it('captions the final pitch in version 2 only', () => {
    expect(finalCaption('k', 'called', '2')).toBe('Strike three');
    expect(finalCaption('k', 'swinging', '2')).toBe('Strike three, swinging');
    expect(finalCaption('k', 'tip', '2')).toBe('Struck out on a foul tip');
    expect(finalCaption('bb', null, '2')).toBe('Ball four');
    expect(finalCaption('hbp', null, '2')).toBe('Hit by pitch');
    expect(finalCaption('single', null, '2')).toBe('');
    expect(finalCaption('k', 'called', '1')).toBe('');
  }, 30000);

  it('draws every old a1 call without error', () => {
    for (let i = 0; i < 300; i++) for (const o of OUTCOMES) {
      const c = countFor(o, `w${i}`, '1'), a = callFor(o, `w${i}`, c, 'B', 'R', 'R', '1');
      const pl = planPitch({ m: o === 'oip' ? 'out' : o === 'k' ? 'miss' : o === 'bb' ? 'take' : o === 'hbp' ? 'hbp' : 'hit', kind: null, isFinal: true, outcome: o, era: '1990-2025',
        bats: 'R', call: a, contact: { x: 372, y: 200 }, seed: `w${i}`, index: c.leadUp.length });
      for (let t = 0; t < 1.9; t += 0.05) expect(() => frameAt(pl, t)).not.toThrow();
    }
  }, 30000);
});
