import { OUTCOMES } from './logic';
import { CLUTCH_SETUP, clutchNext } from './clutch';

describe('plan 73 Part C: clutch setup', () => {
  it('every outcome has a consequence line; none says a team wins or a run scored', () => {
    for (const o of OUTCOMES) {
      const l = clutchNext(o);
      expect(l, o).toMatch(/^\.\.\.\S.*\.$/);
      expect(l.toLowerCase(), o).not.toMatch(/\bwins\b|\bscored\b/);
    }
    expect(clutchNext('hr')).toBe('...that\'s a walk-off.');
    expect(clutchNext('k')).toBe(clutchNext('oip'));
    expect(clutchNext('bb')).toBe(clutchNext('hbp'));
  });
  it('one setup, ending in an ellipsis', () => {
    expect(CLUTCH_SETUP).toBe('If it\'s the bottom of the 9th, two outs, down a run, tying run on second...');
  });
});
