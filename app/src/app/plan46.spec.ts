// Plan 46: short audio-only lead-up pitch calls.
import { callFor, countFor, CountPitch, OUTCOMES, PlayFacts } from './logic';
import { ALL_KEYS, AUDIO_PHRASES, audioCall, intro, IntroCtx, isTextOnly, PbpLine, PHRASES, pitchLines, recapLines, RecapAb, RecapCtx, resultLine, spokenKeys } from './pbp';

const keys = (l: PbpLine | null) => (l ? l.segs.filter(s => 'p' in s).map(s => (s as { p: string }).p) : []);
const countSaid = (k: string): [number, number] | 'still' | null => {
  if (k === 'a.still') return 'still';
  if (k.endsWith('.full')) return [3, 2];
  const m = /^a\.(ball|strike|swing|foul)\.(\d)$/.exec(k);
  return m ? (m[1] === 'ball' ? [+m[2], -1] : [-1, +m[2]]) : null;
};

describe('plan 46: audio pitch calls', () => {
  it('maps every possible lead-up pitch to an audio phrase that says the right count', () => {
    for (let b0 = 0; b0 <= 3; b0++) for (let s0 = 0; s0 <= 2; s0++) for (const kind of ['ball', 'called', 'swinging', 'foul'] as const) {
      if (kind === 'ball' && b0 === 3) continue;                       // ball four ends the at-bat
      if (kind !== 'ball' && kind !== 'foul' && s0 === 2) continue;   // strike three ends the at-bat
      const p: CountPitch = kind === 'ball' ? { kind, balls: b0 + 1, strikes: s0 } : { kind, balls: b0, strikes: Math.min(2, s0 + 1) };
      const k = audioCall(p, { balls: b0, strikes: s0 });
      expect(AUDIO_PHRASES[k], k).toBeTruthy();
      const c = countSaid(k);
      if (c === 'still') { expect(kind).toBe('foul'); expect(s0).toBe(2); continue; }
      expect(c).not.toBeNull();
      if (c![0] === 3 && c![1] === 2) { expect([p.balls, p.strikes]).toEqual([3, 2]); continue; }
      if (c![0] >= 0) expect(c![0]).toBe(p.balls); else expect(c![1]).toBe(p.strikes);
      expect(p.balls === 3 && p.strikes === 2 && !(kind === 'ball')).toBe(false);   // 3-2 strikes must use a .full key
    }
    expect(audioCall({ kind: 'foul', balls: 3, strikes: 2 }, { balls: 3, strikes: 2 })).toBe('a.still');   // repeat foul at 3-2
    expect(audioCall({ kind: 'ball', balls: 3, strikes: 2 }, { balls: 2, strikes: 2 })).toBe('a.ball.full');
    expect(audioCall({ kind: 'swinging', balls: 3, strikes: 2 }, { balls: 3, strikes: 1 })).toBe('a.strike.full');
    expect(audioCall({ kind: 'foul', balls: 3, strikes: 2 }, { balls: 3, strikes: 1 })).toBe('a.foul.full');
  });

  it('every lead-up pitch the count makers produce gets an audio key; the final pitch gets none', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1500; i++) for (const o of OUTCOMES) for (const deco of ['1', '2', '3'] as const) {
      const seed = `a${i}`, count = countFor(o, seed, deco);
      for (let p = 0; p <= count.leadUp.length; p++) {
        const pl = pitchLines({ key: seed, index: 0, count, runnersOn: i % 2 === 0, throws: 'R', era: '1946-1969', seed }, p);
        if (p === count.leadUp.length) { expect(pl.audio).toBeNull(); continue; }
        expect(AUDIO_PHRASES[pl.audio!], String(pl.audio)).toBeTruthy();
        seen.add(pl.audio!);
      }
    }
    // Every primary phrase is reachable (a.full and a.fouloff are fallbacks only).
    expect([...seen].sort()).toEqual(Object.keys(AUDIO_PHRASES).filter(k => k !== 'a.full' && k !== 'a.fouloff').sort());
  });

  it('audio phrases are separate from text phrases; fallbacks exist and do not chain', () => {
    for (const [k, v] of Object.entries(AUDIO_PHRASES)) {
      expect(PHRASES[k]).toBeUndefined();
      if (v.fallback) { expect(AUDIO_PHRASES[v.fallback]).toBeTruthy(); expect(AUDIO_PHRASES[v.fallback].fallback).toBeNull(); }
      expect(v.t.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
    expect(Object.keys(AUDIO_PHRASES).length).toBe(15);
  });

  it('spokenKeys holds every key a spoken line uses and none of the text-only call keys', () => {
    const spoken = new Set(spokenKeys());
    const used = new Set<string>();
    const types = ['ground', 'fly', 'line', 'pop', 'error'] as const;
    for (let i = 0; i < 400; i++) for (const o of OUTCOMES) for (const deco of ['2', '3'] as const) {
      const seed = `k${i}`, count = countFor(o, seed, deco), t = types[i % 5];
      const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: i % 7 === 0 && (t === 'ground' || t === 'line'), sacFly: i % 5 === 0 && (t === 'fly' || t === 'line'), forceRunner: i % 6 === 1 && t === 'ground' ? 'R' : null } : null;
      const call = callFor(o, seed, count, 'X', 'R', 'R', deco, 1955, facts);
      let typeWord = false;
      for (let p = 0; p <= count.leadUp.length; p++) {
        const pl = pitchLines({ key: seed, index: 0, count, runnersOn: i % 2 === 0, throws: ['R', 'L', null][i % 3], era: '1946-1969', seed }, p);
        keys(pl.delivery).forEach(k => used.add(k));
        if (pl.audio) used.add(pl.audio);
        for (const k of keys(pl.call)) if (!k.startsWith('type.')) expect(spoken.has(k), k).toBe(false);
        if (p === count.leadUp.length) typeWord = pl.typeWord;
      }
      keys(resultLine({ key: seed, index: 0, outcome: o, count, call, play: facts, era: '1946-1969', seed, typeWord })).forEach(k => used.add(k));
    }
    for (let i = 0; i < 300; i++) {
      const ctx: IntroCtx = { key: `i${i}`, index: i, batter: { id: 'b', name: 'B' }, pitcher: { id: 'p', name: 'P' }, showPitcher: true, pitchingSide: [null, 0, 1][i % 3],
        situation: i % 10 === 0 ? null : { outs: i % 3, bases: [i & 1 ? 'a' : null, i & 2 ? 'b' : null, i & 4 ? 'c' : null], inning: 1 + (i % 9), battingSide: (i >> 3) & 1, firstOfHalf: i % 5 === 0, deficit: (i % 6) - 2, lastScheduledInning: 1 + (i % 9) } };
      const x = intro(ctx, null); keys(x.pitcher).forEach(k => used.add(k)); keys(x.batter).forEach(k => used.add(k));
      const ab: RecapAb = { outcome: OUTCOMES[i % OUTCOMES.length], battingSide: i & 1, inning: 1 + (i % 15), outsBefore: i % 3, outsAfter: Math.min(3, (i % 3) + (i % 2)), basesBefore: ['r1', i & 2 ? 'r2' : null, null], basesAfter: [i & 4 ? 'b' : null, 'r1', null], scored: i % 3 === 0 ? ['r2'] : [], runnersOut: i % 7 === 0 ? ['r1'] : [], doublePlay: i % 11 === 0, batterId: 'b' };
      const rc: RecapCtx = { key: `r${i}`, index: i, ab, outAt: () => 'second', scoreBefore: [i % 4, (i >> 2) % 4], scoreAfter: [i % 4 + (ab.battingSide === 0 ? ab.scored.length : 0), (i >> 2) % 4 + (ab.battingSide === 1 ? ab.scored.length : 0)],
        lastOfGame: i % 13 === 0, halfEnds: ab.outsAfter === 3, capped: false, nextIsNewHalf: true, halfPlays: [ab], throws: ['R', 'L', null][i % 3], lastScheduledInning: 9 };
      recapLines(rc).forEach(l => keys(l).forEach(k => used.add(k)));
    }
    const missing = [...used].filter(k => !spoken.has(k));
    expect(missing).toEqual([]);
    expect(spokenKeys().filter(isTextOnly)).toEqual([]);
    // The prefix list must not catch spoken look-alikes.
    for (const k of ['foulout.SS', '2b.corner.left', 'k.swing', 'sc.tied.0', 'type.fast']) if (ALL_KEYS().includes(k)) expect(spoken.has(k), k).toBe(true);
  });
});
