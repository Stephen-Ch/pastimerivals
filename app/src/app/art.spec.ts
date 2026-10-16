import { eraOf, figure } from './art';

describe('art', () => {
  it('maps seasons to eras', () => {
    expect(eraOf(1901)).toBe('1901-1919');
    expect(eraOf(1927)).toBe('1920-1945');
    expect(eraOf(1969)).toBe('1946-1969');
    expect(eraOf(1985)).toBe('1970-1989');
    expect(eraOf(2025)).toBe('1990-2025');
  });

  it('mirrors left-handed players only', () => {
    expect(figure('1920-1945', 'bat', 'L')).toContain('scale(-1 1)');
    expect(figure('1920-1945', 'bat', 'R')).not.toContain('scale(-1 1)');
  });

  it('never draws text, numbers or logos into the uniform', () => {
    for (const era of ['1901-1919', '1920-1945', '1946-1969', '1970-1989', '1990-2025'] as const)
      for (const pose of ['bat', 'pit'] as const) {
        const svg = figure(era, pose, 'R');
        expect(svg).not.toContain('<text');
        expect(svg).not.toContain('<image');
      }
  });

  it('uses the same neutral skin tone for every figure', () => {
    const tones = new Set(['1901-1919', '1990-2025'].map(e => /fill="(#cfc9bd)"/.exec(figure(e as never, 'pit', 'R'))?.[1]));
    expect([...tones]).toEqual(['#cfc9bd']);
  });

  it('falls back to the modern look for an unknown era', () => {
    expect(figure('unknown' as never, 'bat', 'R')).toContain('<svg');
  });
});
