import { ArtManifest, artFor, pairArt, sheetTone, variantFor } from './art';

const man: ArtManifest = {
  cell: [364, 480], frames: 8,
  sheets: { 'pitcher/1990-2025/darkbrown': '/art/p.webp', 'batter/1920-1945/light': '/art/b.webp' },
  cards: { 'pitcher/1990-2025/darkbrown/a': '/art/pa.webp', 'pitcher/1990-2025/darkbrown/b': '/art/pb.webp',
           'batter/1920-1945/light/a': '/art/ba.webp', 'batter/1920-1945/light/b': '/art/bb.webp',
           'pitcher/1990-2025/line/a': '/art/pla.webp', 'pitcher/1990-2025/line/b': '/art/plb.webp',
           'batter/1920-1945/line/a': '/art/bla.webp', 'batter/1920-1945/line/b': '/art/blb.webp' },
  tones: { martp001: 'darkbrown', ruthb101: 'light', oliveguy: 'olive', medguy: 'mediumbrown' },
};

describe('comic art (plan 18, plan 52)', () => {
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

  it('finds the toned card for researched players and mirrors lefties', () => {
    const p = artFor(man, 'martp001', 'pit', '1990-2025', 'R')!;
    expect(p.card).toMatch(/^\/art\/p[ab]\.webp$/);
    expect(p.line).toBe(false);
    expect(p.mirror).toBe(false);
    expect(artFor(man, 'ruthb101', 'bat', '1920-1945', 'L')!.mirror).toBe(true);
  });

  it('gives a player with no researched tone the blank-paper card', () => {
    const a = artFor(man, 'nobody01', 'bat', '1920-1945', 'R')!;
    expect(a.line).toBe(true);
    expect(a.card).toMatch(/^\/art\/bl[ab]\.webp$/);
  });

  it('forceLine gives a toned player the blank-paper card too', () => {
    const a = artFor(man, 'martp001', 'pit', '1990-2025', 'R', true)!;
    expect(a.line).toBe(true);
    expect(a.card).toMatch(/^\/art\/pl[ab]\.webp$/);
  });

  it('returns null only when the card is missing', () => {
    expect(artFor(man, 'ruthb101', 'bat', '1990-2025', 'R')).toBeNull();
    expect(artFor(man, 'nobody01', 'pit', '1946-1969', 'R')).toBeNull();
  });

  it('keeps one style per matchup: blank paper for both when either player has no tone', () => {
    const pit = { id: 'martp001', era: '1990-2025' as const, hand: 'R' };
    const toned = pairArt(man, pit, { id: 'ruthb101', era: '1920-1945', hand: 'L' })!;
    expect(toned.pit.line || toned.bat.line).toBe(false);
    const mixed = pairArt(man, pit, { id: 'nobody01', era: '1920-1945', hand: 'R' })!;
    expect(mixed.pit.line && mixed.bat.line).toBe(true);
  });

  it('gives blank frames for both (null) when a card is missing or there is no manifest', () => {
    const pit = { id: 'martp001', era: '1990-2025' as const, hand: 'R' };
    expect(pairArt(man, pit, { id: 'ruthb101', era: '1990-2025', hand: 'L' })).toBeNull();
    expect(pairArt(null, pit, { id: 'ruthb101', era: '1920-1945', hand: 'L' })).toBeNull();
  });
});
