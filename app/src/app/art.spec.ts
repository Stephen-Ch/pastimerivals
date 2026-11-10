import { eraOf, lookOf, parkLookOf } from './art';

describe('art', () => {
  it('maps seasons to eras', () => {
    expect(eraOf(1901)).toBe('1901-1919');
    expect(eraOf(1927)).toBe('1920-1945');
    expect(eraOf(1969)).toBe('1946-1969');
    expect(eraOf(1985)).toBe('1970-1989');
    expect(eraOf(2025)).toBe('1990-2025');
  });

});

// Plan 59 Round 1b test 6: the park follows the card eras (five looks); the batter sheet split (lookOf) is unchanged.
describe('plan 59 r1b: park looks', () => {
  it('parkLookOf splits at the card eras', () => {
    expect([1919, 1920, 1945, 1946, 1969, 1970, 1989, 1990].map(parkLookOf)).toEqual(['1901', '1920', '1920', '1956', '1956', '1970', '1970', '1990']);
  });
  it('lookOf (batter sheets) is unchanged', () => {
    expect([1919, 1920, 1955, 1956, 1989, 1990].map(lookOf)).toEqual(['1901', '1920', '1920', '1956', '1956', '1990']);
  });
});

// Plan 59 Round 4: a toned batter's side sheet wears his card era's uniform; untoned batters keep the pen-and-ink sheet.
import { ArtManifest, sideArt, sideKey, windupArt } from './art';

describe('plan 59 r4: uniform colours follow the card era', () => {
  const sheets: Record<string, string> = { '1920/light': '/old-1920-l.webp', '1920/line': '/line-1920.webp', '1920/1920/light': '/r-1920-1920-l.webp', '1920/1946/light': '/r-1920-1946-l.webp', '1956/1946/darkbrown': '/r-1956-1946-d.webp', '1956/1970/darkbrown': '/r-1956-1970-d.webp', '1956/darkbrown': '/old-1956-d.webp' };
  const frames = Object.fromEntries(Object.keys(sheets).map(k => [k, []]));
  const m = { cell: [364, 480], frames: 8, sheets: { 'pitcher/1990-2025/darkbrown': '/w.webp' }, cards: {}, tones: { lite: 'light', oli: 'olive', mb: 'mediumbrown', dk: 'darkbrown' }, side: { cell: [520, 480], footY: 470, sheets, frames } } as unknown as ArtManifest;
  it('sideKey: look by helmet rules, colours by card era', () => {
    expect([1945, 1946, 1955, 1956, 1969, 1970, 1989, 1990].map(y => sideKey(y, 'light')))
      .toEqual(['1920/1920/light', '1920/1946/light', '1920/1946/light', '1956/1946/light', '1956/1946/light', '1956/1970/light', '1956/1970/light', '1990/1990/light']);
  });
  it('picks the era copy; olive uses light, mediumbrown uses darkbrown', () => {
    expect(sideArt(m, 'lite', 1925)!.sheet).toBe('/r-1920-1920-l.webp');
    expect(sideArt(m, 'oli', 1950)!.sheet).toBe('/r-1920-1946-l.webp');
    expect(sideArt(m, 'mb', 1960)!.sheet).toBe('/r-1956-1946-d.webp');
    expect(sideArt(m, 'dk', 1975)!.sheet).toBe('/r-1956-1970-d.webp');
  });
  it('untoned batters keep the old line key; windup unchanged (untoned pitcher has none, lefty mirrors)', () => {
    expect(sideArt(m, 'nobody', 1950)).toEqual({ sheet: '/line-1920.webp', frames: [], lineArt: true });
    expect(windupArt(m, 'nobody', '1990-2025', 'R')).toBeNull();
    expect(windupArt(m, 'dk', '1990-2025', 'L')).toEqual({ sheet: '/w.webp', mirror: true });
  });
  it('falls back to the old key only when the era copy is missing', () => {
    const sh = { ...sheets }; delete sh['1920/1920/light'];
    const m2 = { ...m, side: { ...m.side!, sheets: sh } } as ArtManifest;
    expect(sideArt(m2, 'lite', 1925)!.sheet).toBe('/old-1920-l.webp');
  });
});
