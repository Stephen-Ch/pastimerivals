import { ArtManifest, artFor, pairArt, sheetTone, variantFor } from './art';
import { batterFrames, CUT_S, PITCHER_FRAMES } from './pitch-scene';

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

  it('times frames so contact lands on ball arrival and the cut is at release', () => {
    expect(PITCHER_FRAMES.find(([, f]) => f === 6)![0]).toBeLessThan(CUT_S);
    expect(batterFrames('hit').find(([, f]) => f === 4)![0]).toBe(1.05);
    expect(batterFrames('miss').some(([, f]) => f === 4)).toBe(false);
    expect(batterFrames('take').map(([, f]) => f)).toEqual([0, 6]);
    expect(batterFrames('hbp').map(([, f]) => f)).toEqual([0, 7]);
    for (const m of ['hit', 'out', 'foul', 'miss', 'take', 'look', 'hbp'] as const) expect(batterFrames(m)[0][0]).toBe(CUT_S);
  });
});
