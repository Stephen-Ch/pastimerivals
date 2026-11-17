// Plan 71: the extra-inning runner on second is explained (written note when the announcer is off, spoken line when on).
import { extraStart, intro, IntroCtx, lineText, PHRASES, Situation } from './pbp';

const sit = (s: Partial<Situation>): Situation => ({ outs: 0, bases: [null, 'r2', null], inning: 2, battingSide: 1, firstOfHalf: true, deficit: 0, lastScheduledInning: 1, ...s });
const ictx = (s: Situation | null, showPitcher = true): IntroCtx => ({ key: 'k', index: 3, batter: { id: 'b', name: 'Bat Ter' }, pitcher: { id: 'p', name: 'Pitch Er' },
  showPitcher, pitchingSide: 0, situation: s });

describe('plan 71: extra-inning runner on second', () => {
  it('detects only the first at-bat of an extra half that starts with a runner on second', () => {
    expect(extraStart(sit({}))).toBe(true);
    expect(extraStart(sit({ inning: 4, battingSide: 0 }))).toBe(true);
    expect(extraStart(sit({ firstOfHalf: false })), 'second batter of the half').toBe(false);
    expect(extraStart(sit({ inning: 1 })), 'scheduled inning').toBe(false);
    expect(extraStart(sit({ bases: [null, null, null] })), 'no runner rule').toBe(false);
    expect(extraStart(null), 'The Duel').toBe(false);
  });

  it('the spoken line comes first, before the pitcher line, and only at an extra start', () => {
    const x = intro(ictx(sit({})), null);
    expect(x.extra).not.toBeNull();
    expect(lineText(x.extra!)).toBe('Extra innings, and a runner starts on second.');
    expect(PHRASES['lead.extra']?.t).toBe('Extra innings, and a runner starts on second.');
    expect(intro(ictx(sit({ firstOfHalf: false })), null).extra).toBeNull();
    expect(intro(ictx(null), null).extra).toBeNull();
  });
});
