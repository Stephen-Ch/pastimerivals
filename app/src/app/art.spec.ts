import { eraOf } from './art';

describe('art', () => {
  it('maps seasons to eras', () => {
    expect(eraOf(1901)).toBe('1901-1919');
    expect(eraOf(1927)).toBe('1920-1945');
    expect(eraOf(1969)).toBe('1946-1969');
    expect(eraOf(1985)).toBe('1970-1989');
    expect(eraOf(2025)).toBe('1990-2025');
  });

});
