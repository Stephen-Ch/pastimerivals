// PLAN-2026-11-04-team-identity-v3 Part A: helpers, contrast, board order.
import { describe, expect, it } from 'vitest';
import { ERA_BOARD } from './scoreboard';
import { boardOrder, firstWord, headerParts, ownTag, sideColor, TEAM_BLUE, TEAM_ORANGE } from './team';
import { halfChange } from './inning';
import { CAtBat } from './challenge-api';

function lum(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y); return (hi + 0.05) / (lo + 0.05); };

describe('team colors', () => {
  it('players: you blue, them orange, whichever side you are', () => {
    expect(sideColor(0, 0)).toBe(TEAM_BLUE); expect(sideColor(1, 0)).toBe(TEAM_ORANGE);
    expect(sideColor(1, 1)).toBe(TEAM_BLUE); expect(sideColor(0, 1)).toBe(TEAM_ORANGE);
  });
  it('spectators: home blue, away orange', () => {
    expect(sideColor(0, null)).toBe(TEAM_BLUE); expect(sideColor(1, null)).toBe(TEAM_ORANGE);
  });
  it('the two fills stay at least 2.5:1 apart (distinct in grayscale)', () => {
    expect(ratio(TEAM_BLUE, TEAM_ORANGE)).toBeGreaterThanOrEqual(2.5);
  });
  it('the pill ring (board text color) reaches 3:1 on every era board', () => {
    for (const [era, c] of Object.entries(ERA_BOARD)) expect(ratio(c.fg, c.bg), era).toBeGreaterThanOrEqual(3);
  });
  it('chip text passes 4.5:1: white on blue, near-black on orange', () => {
    expect(ratio('#ffffff', TEAM_BLUE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#111111', TEAM_ORANGE)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('board order and words', () => {
  it('Last Licks: away (side 1) left, home right; other games unchanged', () => {
    expect(boardOrder(true)).toEqual([1, 0]);
    expect(boardOrder(false)).toEqual([0, 1]);
  });
  it('own tag only for players', () => {
    expect(ownTag(1, 1)).toBe('yours'); expect(ownTag(0, 1)).toBe('theirs'); expect(ownTag(0, null)).toBe('');
  });
  it('first word of a nickname', () => {
    expect(firstWord('Bleacher 5012')).toBe('Bleacher'); expect(firstWord('Computer')).toBe('Computer');
  });
  it('header parts: players get who and where, spectators do not', () => {
    expect(headerParts('Top 1', 1, 1, 2)).toEqual({ half: 'Top 1', who: 'You bat', where: '(away)', batter: 'Batter 2' });
    expect(headerParts('Bottom 1', 0, 1, 1)).toEqual({ half: 'Bottom 1', who: 'They bat', where: '(home)', batter: 'Batter 1' });
    expect(headerParts('Top 1', 1, null, 3)).toEqual({ half: 'Top 1', who: '', where: '', batter: 'Batter 3' });
  });
  it('half change keeps away first and uses "You" for your side', () => {
    const ab = { inning: 1, battingSide: 1, outsAfter: 3 } as CAtBat, next = { inning: 1, battingSide: 0 } as CAtBat;
    const word = (s: number) => (s === 1 ? 'You' : 'Bleacher 5012');
    expect(halfChange(ab, next, [0, 2], word, false)).toBe('Middle of the 1st: You 2, Bleacher 5012 0.');
  });
});
