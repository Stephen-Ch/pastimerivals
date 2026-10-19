import { ArtManifest, artFor, pairArt, sheetTone, variantFor } from './art';
import { ARRIVE_S, ballAt, MITT_FADE_S, MITT_HOLD_S, SPLIT_END_S, batterFrames, exitSide, frameAt, LEAD_START_S, pitchRand, pitchTarget, PITCHER_FRAMES, RELEASE_S, SPLIT_LEAD_MS, STRETCH_FRAMES } from './pitch-scene';
import { callFor, countFor } from './logic';

const man: ArtManifest = {
  cell: [364, 480], frames: 8,
  sheets: { 'pitcher/1990-2025/darkbrown': '/art/p.webp', 'batter/1920-1945/light': '/art/b.webp' },
  cards: { 'pitcher/1990-2025/darkbrown/a': '/art/pa.webp', 'pitcher/1990-2025/darkbrown/b': '/art/pb.webp',
           'batter/1920-1945/light/a': '/art/ba.webp', 'batter/1920-1945/light/b': '/art/bb.webp' },
  tones: { martp001: 'darkbrown', ruthb101: 'light', oliveguy: 'olive', medguy: 'mediumbrown' },
};

describe('comic art (plan 18)', () => {
  it('maps the four tones to the two animation tones', () => {
    expect(sheetTone('light')).toBe('light');
    expect(sheetTone('olive')).toBe('light');
    expect(sheetTone('mediumbrown')).toBe('darkbrown');
    expect(sheetTone('darkbrown')).toBe('darkbrown');
  });

  it('picks a stable card variant per player', () => {
    expect(variantFor('ruthb101')).toBe(variantFor('ruthb101'));
    expect(['a', 'b']).toContain(variantFor('martp001'));
  });

  it('finds art for researched players and mirrors lefties', () => {
    const p = artFor(man, 'martp001', 'pit', '1990-2025', 'R')!;
    expect(p.sheet).toBe('/art/p.webp');
    expect(p.mirror).toBe(false);
    expect(artFor(man, 'ruthb101', 'bat', '1920-1945', 'L')!.mirror).toBe(true);
  });

  it('returns null for unresearched players and missing files', () => {
    expect(artFor(man, 'nobody01', 'bat', '1920-1945', 'R')).toBeNull();
    expect(artFor(man, 'ruthb101', 'bat', '1990-2025', 'R')).toBeNull();
  });

  it('uses drawn figures for both when either player has no art', () => {
    const pit = { id: 'martp001', era: '1990-2025' as const, hand: 'R' };
    expect(pairArt(man, pit, { id: 'ruthb101', era: '1920-1945', hand: 'L' })).not.toBeNull();
    expect(pairArt(man, pit, { id: 'nobody01', era: '1920-1945', hand: 'R' })).toBeNull();
    expect(pairArt(null, pit, { id: 'ruthb101', era: '1920-1945', hand: 'L' })).toBeNull();
  });

  it('times frames so contact lands on ball arrival and release comes first (plan 19)', () => {
    expect(frameAt(PITCHER_FRAMES, RELEASE_S)).toBe(6);
    expect(frameAt(batterFrames('hit'), ARRIVE_S)).toBe(4);
    expect(frameAt(batterFrames('hit'), ARRIVE_S - 0.01)).toBe(3);
    expect(batterFrames('miss').some(([, f]) => f === 4)).toBe(false);
    expect(batterFrames('take').map(([, f]) => f)).toEqual([0, 6]);
    expect(batterFrames('look').map(([, f]) => f)).toEqual([0]);
    expect(batterFrames('hbp').map(([, f]) => f)).toEqual([0, 7]);
    expect(PITCHER_FRAMES[PITCHER_FRAMES.length - 1][0]).toBeGreaterThan(1);   // windup is no longer a blur
  });

  it('keeps lead-up pitches short but starts them at the stride', () => {
    expect(frameAt(STRETCH_FRAMES, LEAD_START_S)).toBe(0);   // from the set position, never mid-stride
    expect(STRETCH_FRAMES.map(([, f]) => f)).toEqual([0, 2, 4, 5, 6, 7]);
    expect(SPLIT_LEAD_MS).toBeLessThan(1700);
  });

  it('moves the ball from the pitcher panel to the plate side of each batter', () => {
    expect(ballAt(1.0, 'hit', 'R', 'R').panel).toBeNull();
    expect(ballAt(1.1, 'hit', 'R', 'R').panel).toBeNull();   // release frame shows the ball itself
    expect(ballAt(1.2, 'hit', 'L', 'R').x).toBeLessThan(50);  // a lefty's pitch enters from the other side
    const r = ballAt(ARRIVE_S, 'hit', 'R', 'R'), l = ballAt(ARRIVE_S, 'hit', 'R', 'L');
    expect(r.panel).toBe('bat');
    expect(r.x).toBeGreaterThan(50);
    expect(l.x).toBeLessThan(50);
    expect(ballAt(2.3, 'foul', 'R', 'R').o).toBe(0);
  });

  it('ends every pitch he does not hit over or beside the plate, clear of his body (plan 27)', () => {
    // Measured from the art (tools/check-ball-path.py): body x 12-60 everywhere, feet out to 77 below y 85.
    const onBody = (x: number, y: number) => (x >= 12 && x <= 60 && y >= 20 && y <= 100) || (x <= 77 && y >= 85);
    for (const [bats, dir] of [['R', 1], ['L', -1]] as const) {
      for (let i = 0; i < 1000; i++) {
        const r = pitchRand('seed' + i, i % 7);
        for (const m of ['look', 'miss', 'take'] as const) {
          const t = pitchTarget(m, bats, r);
          const x = dir === 1 ? t.x : 100 - t.x;   // compare in right-handed screen space
          expect(onBody(x, t.y)).toBe(false);
          expect(x).toBeGreaterThanOrEqual(74); expect(x).toBeLessThanOrEqual(94);
          if (m === 'look') { expect(x).toBeLessThanOrEqual(84); expect(t.y).toBeGreaterThanOrEqual(46); expect(t.y).toBeLessThanOrEqual(62); }
          if (m === 'miss') { expect(x).toBeLessThanOrEqual(84); expect(t.y).toBeGreaterThanOrEqual(66); expect(t.y).toBeLessThanOrEqual(70); }
          if (m === 'take') expect(x > 84 || t.y < 40 || t.y > 68).toBe(true);   // never in the strike box
        }
      }
    }
  });

  it('holds the ball in the mitt so the eye can find it, then fades (plan 27)', () => {
    for (const m of ['look', 'miss', 'take'] as const) {
      expect(ballAt(ARRIVE_S + 0.01, m, 'R', 'R').o).toBe(1);
      expect(ballAt(ARRIVE_S + MITT_HOLD_S - 0.01, m, 'R', 'R').o).toBe(1);
      expect(ballAt(ARRIVE_S + MITT_HOLD_S + MITT_FADE_S + 0.01, m, 'R', 'R').o).toBe(0);
      expect(ballAt(ARRIVE_S + 0.1, m, 'R', 'R').ring).toBeGreaterThan(0);
      expect(ballAt(ARRIVE_S + 0.4, m, 'R', 'R').ring).toBeUndefined();
      expect('behind' in ballAt(ARRIVE_S + 0.2, m, 'R', 'R')).toBe(false);
    }
    expect(ARRIVE_S + MITT_HOLD_S + MITT_FADE_S).toBeLessThanOrEqual(SPLIT_END_S);
    expect(frameAt(batterFrames('hit'), ARRIVE_S)).toBe(4);   // contact frame lines up with the ball
    expect(frameAt(batterFrames('hit'), ARRIVE_S - 0.01)).toBe(3);
  });

  it('places pitches from a stable hash', () => {
    expect(pitchRand('abc', 2)).toEqual(pitchRand('abc', 2));
    for (let i = 0; i < 40; i++) for (const v of pitchRand('s' + i, i)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('sends batted balls to the side the announcer names, the same for lefties', () => {
    expect(exitSide({ text: '', type: 'hr', spot: 'left' })).toBe(1);
    expect(exitSide({ text: '', type: 'single', spot: 'right' })).toBe(-1);
    expect(exitSide({ text: '', type: 'ground', fielder: 'SS' })).toBe(0.5);
    const lf = ballAt(2.2, 'hit', 'R', 'L', [0.5, 0.5, 0.5], 'line', 1);
    expect(lf.x).toBeGreaterThan(50);   // still the viewer's right for a left-handed batter
    expect(ballAt(2.2, 'hit', 'R', 'R', [0.5, 0.5, 0.5], 'ground', 1).y).toBeGreaterThan(85);
    expect(ballAt(2.2, 'out', 'R', 'R', [0.5, 0.5, 0.5], 'pop', 0).d).toBeCloseTo(4.5, 1);
  });

  it('gives every batted-ball call a trajectory', () => {
    for (const o of ['single', 'double', 'triple', 'hr', 'oip'] as const)
      for (let i = 0; i < 30; i++) {
        const c = callFor(o, 'seed' + i, countFor(o, 'seed' + i), 'X', 'R', 'R');
        expect(c.trajectory).toBeTruthy();
      }
  });
});
