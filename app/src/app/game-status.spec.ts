import type { CMine, CStage } from './challenge-api';
import { gamesLinkText, isWaiting, orderMine, pageCount, pageOf, stageWords, waitingCount, waitingText } from './game-status';

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
  it('duel home link text', () => {
    expect(gamesLinkText(3, 0, false)).toBe('Your games (3)');
    expect(gamesLinkText(3, 1, false)).toBe('Your games (3) · 1 result waiting');
    expect(gamesLinkText(3, 2, false)).toBe('Your games (3) · 2 results waiting');
    expect(gamesLinkText(3, 1, true)).toBe('Your games (1 new)');
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
  it('4 rows a page, clamped', () => {
    const o = orderMine(list);
    expect(pageCount(o.length)).toBe(3);
    expect(pageCount(0)).toBe(1);
    expect(pageOf(o, 0).map(m => m.code)).toEqual(['result-new', 'rm', 'result-old', 'unsent-new']);
    expect(pageOf(o, 2).map(m => m.code)).toEqual(['done-old']);
    expect(pageOf(o, 9).map(m => m.code)).toEqual(['done-old']);
    expect(pageOf(o, -1)).toEqual(pageOf(o, 0));
  });
});
