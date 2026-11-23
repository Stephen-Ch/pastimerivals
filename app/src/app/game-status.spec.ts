import type { CMine, CStage } from './challenge-api';
import { gamesLinkText, isWaiting, orderMine, pageCountBy, pageForAnchor, ROW_H, rowsFit, stageWords, waitingCount, waitingText } from './game-status';

// Plan 69: "did my friend play?" status words, order, badge and paging.
const row = (code: string, stage: CStage | null, status: string, minsAgo: number, extra: Partial<CMine> = {}): CMine => ({
  code, you: 'creator', creatorName: 'Me', opponentName: null, createdUtc: new Date(Date.UTC(2026, 10, 22, 12, 0) - minsAgo * 60000).toISOString(),
  status, vsCpu: stage === null, mode: 'inning', stage, ...extra,
});

describe('plan 69 status words', () => {
  it('has one line per row', () => {
    const w = (s: CStage, rematchSent = false) => stageWords(row('x', s, 'open', 0, { rematchSent }));
    expect(w('expired_late')).toBe('Expired · your friend tried to open it late · Send a new one');
    expect(w('expired')).toBe('Expired · Send a new one');
    expect(w('result')).toBe('Played! See who won');
    expect(w('done')).toBe('Done · Rematch');
    expect(w('done', true)).toBe('Done · Rematch sent');
    expect(w('picking')).toBe('Your friend started picking');
    expect(w('opened')).toBe('Opened · your friend is looking');
    expect(w('sent')).toBe('Sent · waiting for your friend');
    expect(w('unsent')).toBe('Not sent yet · Send');
    expect(w('you_played')).toBe('You played · Rematch?');
    expect(w('you_played', true)).toBe('You played · Rematch sent');
    expect(w('rematch_for_you')).toBe('Your friend wants a rematch · Play');
  });
  it('keeps the old words for computer games and older servers', () => {
    expect(stageWords(row('c', null, 'resolved', 0))).toBe('played');
    expect(stageWords({ ...row('o', null, 'expired', 0), stage: undefined })).toBe('expired');
  });
});

describe('plan 69 badge', () => {
  it('counts results not yet seen and rematches for you, never computer games', () => {
    const list = [row('a', 'result', 'resolved', 1), row('b', 'rematch_for_you', 'open', 2), row('c', null, 'resolved', 3), row('d', 'done', 'resolved', 4)];
    expect(waitingCount(list)).toBe(2);
    expect(isWaiting(list[2])).toBe(false);
    expect(waitingText(1)).toBe('1 result waiting');
    expect(waitingText(2)).toBe('2 results waiting');
  });
  it('duel home link text by screen (A1)', () => {
    expect(gamesLinkText(3, 0, 'wide')).toBe('Your games (3)');
    expect(gamesLinkText(3, 1, 'wide')).toBe('Your games (3) · 1 result waiting');
    expect(gamesLinkText(3, 2, 'wide')).toBe('Your games (3) · 2 results waiting');
    expect(gamesLinkText(3, 0, 'portrait')).toBe('Your games (3)');
    expect(gamesLinkText(3, 2, 'portrait')).toBe('Your games (2 new)');
    expect(gamesLinkText(11, 0, 'small')).toBe('Games (11)');
    expect(gamesLinkText(11, 2, 'small')).toBe('Games (2 new)');
  });
});

describe('plan 69 order and paging', () => {
  const list = [
    row('done-new', 'done', 'resolved', 1), row('sent', 'sent', 'open', 5), row('result-old', 'result', 'resolved', 50),
    row('cpu', null, 'resolved', 2), row('unsent-new', 'unsent', 'open', 3), row('result-new', 'result', 'resolved', 10),
    row('expired', 'expired', 'expired', 4), row('rm', 'rematch_for_you', 'open', 20, { you: 'opponent' }), row('done-old', 'done', 'resolved', 60),
  ];
  it('waiting rows first, then open games, then the rest, newest first in each', () => {
    expect(orderMine(list).map(m => m.code)).toEqual(['result-new', 'rm', 'result-old', 'unsent-new', 'sent', 'done-new', 'cpu', 'expired', 'done-old']);
  });
  it('rows a page: whole 62 px rows that fit, 1 to 4 (A1)', () => {
    expect(ROW_H).toBe(62);
    expect(rowsFit(0, 6)).toBe(1);
    expect(rowsFit(62, 6)).toBe(1);
    expect(rowsFit(129, 6)).toBe(1);
    expect(rowsFit(130, 6)).toBe(2);
    expect(rowsFit(266, 6)).toBe(4);
    expect(rowsFit(900, 6)).toBe(4);
  });
  it('turning the phone keeps the anchor row on screen, and back returns to the same page (A1)', () => {
    expect(pageCountBy(20, 4)).toBe(5);
    expect(pageCountBy(0, 4)).toBe(1);
    const anchor = 4;                                   // page 2 at 4 a page
    expect(pageForAnchor(anchor, 4, 20)).toBe(1);
    expect(pageForAnchor(anchor, 3, 20)).toBe(1);       // rows 3-5: row 4 still shows
    expect(pageForAnchor(anchor, 2, 20)).toBe(2);       // rows 4-5
    expect(pageForAnchor(anchor, 4, 20)).toBe(1);       // turned back: page 2 again
    expect(pageForAnchor(40, 4, 20)).toBe(4);           // list shrank: last page
  });
});
