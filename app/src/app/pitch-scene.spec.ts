import { TestBed } from '@angular/core/testing';
import { Era, SideLook } from './art';
import { callFor, countFor, Deco, OUTCOMES, PlayFacts } from './logic';
import { buildPlay, hasPark } from './park';
import { leadMotion, motionFor, parkTiming, PitchScene, planPitch, WINDUP_S } from './pitch-scene';

describe('pitch scene', () => {
  it('maps every outcome to the planned motion', () => {
    expect(motionFor('k')).toBe('miss');
    expect(motionFor('k', 'called')).toBe('look');
    expect(motionFor('bb')).toBe('take');
    expect(motionFor('hbp')).toBe('hbp');
    expect(motionFor('oip')).toBe('out');
    for (const o of ['single', 'double', 'triple', 'hr'] as const) expect(motionFor(o)).toBe('hit');
    expect(leadMotion('ball')).toBe('take');
    expect(leadMotion('foul')).toBe('foul');
  });

  it('emits done only once, even when Skip is tapped twice', async () => {
    const f = TestBed.createComponent(PitchScene);
    f.componentRef.setInput('era', '1990-2025');
    f.componentRef.setInput('outcome', 'hr');
    f.componentRef.setInput('seed', 'x');
    let n = 0;
    f.componentInstance.done.subscribe(() => n++);
    await f.whenStable();
    const skip = (f.nativeElement as HTMLElement).querySelector('button.skip') as HTMLButtonElement;
    skip.click(); skip.click();
    f.componentInstance.finish();
    expect(n).toBe(1);
    expect((f.nativeElement as HTMLElement).querySelector('.scene button')).toBeNull();   // no nested buttons
  });

  it('goes straight to the result with reduced motion', async () => {
    const orig = globalThis.matchMedia;
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof matchMedia;
    try {
      const f = TestBed.createComponent(PitchScene);
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'k');
      let n = 0;
      f.componentInstance.done.subscribe(() => n++);
      await new Promise(r => setTimeout(r, 5));
      expect(n).toBe(1);
    } finally { globalThis.matchMedia = orig; }
  });
});

// Plan 59 Round 1a: cue-time golden. The planned moments the audio and announcer follow (enter, plate, park, end,
// windup length) must not move. Not covered: the 60 ms gap between pitches inside the component's next().
describe('plan 59 cue golden', () => {
  const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
  const n = (x: number) => x.toFixed(6);
  const ERAS: Era[] = ['1901-1919', '1920-1945', '1946-1969', '1970-1989', '1990-2025'];
  const LOOKS: SideLook[] = ['1901', '1920', '1956', '1990'];
  const DECOS: Deco[] = ['1', '2', '3'];
  const TYPES = ['ground', 'fly', 'line', 'pop'] as const;

  function cueGolden(): { hash: string; pitches: number; parks: number } {
    const out: string[] = [`W${n(WINDUP_S)}`];
    let pitches = 0, parks = 0;
    for (let i = 0; i < 200; i++) for (const o of OUTCOMES) for (const deco of DECOS) {
      const seed = `c${i}`;
      const bats: 'L' | 'R' = i % 2 ? 'L' : 'R';
      const era = ERAS[i % 5];
      const count = countFor(o, seed, deco);
      const t = TYPES[i % 4];
      const facts: PlayFacts | null = deco === '3' ? { outType: o === 'oip' ? t : null, doublePlay: false, sacFly: false, forceRunner: null } : null;
      const call = callFor(o, seed, count, 'Batter X', bats, 'R', deco, 1900 + (i % 125), facts);
      const windup = i % 3 !== 0;
      for (let k = 0; k <= count.leadUp.length; k++) {
        const isFinal = k === count.leadUp.length;
        const lead = isFinal ? null : count.leadUp[k];
        const m = isFinal ? motionFor(o, count.finalKind) : leadMotion(lead!.kind);
        const kind: 'ball' | 'strike' | null = lead ? (lead.kind === 'ball' ? 'ball' : 'strike') : o === 'bb' ? 'ball' : null;
        const pl = planPitch({ m, kind, isFinal, outcome: o, era, bats, call: isFinal ? call : null, contact: { x: 372, y: 200 }, seed, index: k, windup });
        const play = isFinal && (m === 'hit' || m === 'out') && hasPark(o, call) ? buildPlay({ outcome: o, call, play: facts, seed, look: LOOKS[i % 4] }) : null;
        const pk = parkTiming(pl, play);
        out.push([n(pl.p.enter), n(pl.p.tPlate), n(pl.p.tTarget), n(pl.tl.enter), n(pl.tl.end), n(pl.exitT), pk ? `${n(pk.tPark)}/${n(pk.end)}` : '-'].join(','));
        pitches++; if (pk) parks++;
      }
    }
    return { hash: fnv(out.join('|')), pitches, parks };
  }

  it('planned cue times for 200 seeds x 8 outcomes x 3 decos are unchanged', () => {
    const g = cueGolden();
    expect(g.parks).toBeGreaterThan(500);   // the park path is really exercised
    expect(g).toEqual({ hash: '7cf48e17', pitches: 18834, parks: 3000 });
  });
});
