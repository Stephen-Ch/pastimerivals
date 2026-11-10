// Plan 59 Round 2a: one shared scoreboard for The Duel and Last Licks, styled per era.
import { boardModel, ERA_BOARD, lastName, shortYear } from './scoreboard';

const lum = (hex: string) => {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('plan 59 r2a scoreboard', () => {
  it('Duel: the count reads B-S and is labelled', () => {
    const m = boardModel({ names: ['Pedro Martinez', 'Babe Ruth'], count: { balls: 2, strikes: 1 }, scores: null, outs: null, bases: null });
    expect(m.count).toBe('2-1');
    expect(m.countLabel).toBe('Balls and strikes');
    expect(m.scores).toBeNull();
    expect(m.state).toBeNull();
  });

  it('Last Licks: both scores and the same outs and bases text as before', () => {
    const m = boardModel({ names: ['Away', 'Home'], count: null, scores: [3, 1], outs: 1, bases: [true, false, false] });
    expect(m.scores).toEqual(['3', '1']);
    expect(m.count).toBeNull();
    expect(m.state).toBe('1 out, runner on first ');
    expect(boardModel({ names: ['A', 'B'], count: null, scores: [0, 0], outs: 2, bases: [true, true, true] }).state)
      .toBe('2 out, runner on first runner on second runner on third');
  });

  it('every era: text and numerals at least 4.5:1, dots and outlines at least 3:1 on the board', () => {
    const eras = Object.keys(ERA_BOARD);
    expect(eras.sort()).toEqual(['1901', '1920', '1956', '1970', '1990']);
    for (const [era, c] of Object.entries(ERA_BOARD)) {
      expect(contrast(c.fg, c.bg), `${era} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.num, c.bg), `${era} numerals`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.fg, c.bg), `${era} dots`).toBeGreaterThanOrEqual(3);
    }
  });

  it('last names keep suffixes and name particles; years shorten to two digits', () => {
    expect(lastName('Babe Ruth')).toBe('Ruth');
    expect(lastName('Ken Griffey Jr.')).toBe('Griffey Jr.');
    expect(lastName('Elly De La Cruz')).toBe('De La Cruz');
    expect(lastName('Ichiro')).toBe('Ichiro');
    expect(shortYear(1927)).toBe("'27");
  });
});
