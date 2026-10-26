import { resetArtNoteVisit } from './art-note';
import { DOWN_REASONS, feedbackDue, markFeedbackAsked, resetFeedbackVisit, UP_REASONS } from './feedback';

describe('feedbackDue (plan 30)', () => {
  beforeEach(() => { localStorage.clear(); resetFeedbackVisit(); resetArtNoteVisit(); });

  it('asks from the 2nd game, counts a game once, then not again this visit', () => {
    const t = 1_800_000_000_000;
    expect(feedbackDue('aaa', 2, t)).toBe(false);
    expect(feedbackDue('aaa', 2, t)).toBe(false);   // same game again does not count twice
    expect(feedbackDue('bbb', 2, t)).toBe(true);
    markFeedbackAsked(t);
    expect(feedbackDue('ccc', 2, t)).toBe(false);
  });

  it('waits 7 days between asks', () => {
    const t = 1_800_000_000_000, day = 24 * 3600 * 1000;
    localStorage.setItem('pr_fb_last', String(t));
    localStorage.setItem('pr_fb_games', '5');
    expect(feedbackDue('x1', 2, t + 6 * day)).toBe(false);
    expect(feedbackDue('x2', 2, t + 7 * day)).toBe(true);
  });

  it('practice asks from the 3rd pitch', () => {
    expect(feedbackDue('p1', 3)).toBe(false);
    expect(feedbackDue('p2', 3)).toBe(false);
    expect(feedbackDue('p3', 3)).toBe(true);
  });

  it('has different reasons for thumbs up and thumbs down', () => {
    expect(UP_REASONS.map(r => r[0])).toEqual(['oldtime', 'friends', 'quick', 'animation']);
    expect(DOWN_REASONS.map(r => r[0])).toEqual(['hard', 'confusing', 'slow', 'players']);
  });
});
