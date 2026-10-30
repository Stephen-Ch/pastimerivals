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
