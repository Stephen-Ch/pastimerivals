import { OUTCOMES, label, percent, shareUrl, parseShare, explain, timesLeague } from './logic';

describe('logic', () => {
  it('lists the eight outcomes in engine order', () => {
    expect(OUTCOMES).toEqual(['k', 'bb', 'hbp', 'single', 'double', 'triple', 'hr', 'oip']);
    expect(label('hr')).toBe('Home run');
    expect(label('oip')).toBe('Out in play');
  });

  it('formats probabilities to one decimal place', () => {
    expect(percent(0.06123)).toBe('6.1%');
    expect(percent(0.0004)).toBe('<0.1%');
  });

  it('round-trips a share link', () => {
    const url = shareUrl('https://pastimerivals.com', { b: 'ruthb101', by: 1927, p: 'martp001', py: 1999 }, '123', '0.1.0');
    expect(url).toBe('https://pastimerivals.com/?b=ruthb101&by=1927&p=martp001&py=1999&s=123&v=0.1.0&d=2');
    expect(parseShare(new URL(url).search)).toEqual({ pick: { b: 'ruthb101', by: 1927, p: 'martp001', py: 1999 }, seed: '123', version: '0.1.0', deco: '2' });
    expect(parseShare('?b=x&by=1927&p=y&py=1999&s=1')!.deco).toBe('1');   // old links without d
  });

  it('ignores incomplete share links', () => {
    expect(parseShare('?b=ruthb101')).toBeNull();
  });

  it('describes how far a player was from his league', () => {
    expect(timesLeague(0.087, 0.0094)).toBe('9.3x');
    expect(timesLeague(null, 0.0094)).toBe('n/a');
  });

  it('explains a result in one sentence using both players', () => {
    const step = { outcome: 'Hr', batterObserved: 0.087, batterLeague: 0.0094, pitcherObserved: 0.011, pitcherLeague: 0.027, neutral: 0.028, final: 0.061 };
    const s = explain('hr', step, 'Babe Ruth', 'Pedro Martinez');
    expect(s).toContain('Babe Ruth homered at 9.3x');
    expect(s).toContain('Pedro Martinez allowed home runs at 0.4x');
    expect(s).toContain('9.3x');
    expect(s).toContain('Pedro Martinez');
    expect(s).toContain('0.4x');
    expect(s).toContain('6.1%');
  });
});

import { battingLine, rate3 } from './logic';
describe('battingLine (plan 25)', () => {
  it('computes AVG, OBP and SLG from plate appearances', () => {
    const c = { k: 200, bb: 90, hbp: 10, single: 150, double: 40, triple: 5, hr: 30, oip: 475 };
    const l = battingLine(c, 1000);
    expect(l.ab).toBe(900);
    expect(l.hits).toBe(225);
    expect(rate3(l.avg)).toBe('.250');
    expect(rate3(l.obp)).toBe('.325');
    expect(rate3(l.slg)).toBe(".406");   // (150 + 80 + 15 + 120) / 900
    expect(l.bb).toBe(100);
  });
  it('never divides by zero', () => {
    const z = { k: 0, bb: 5, hbp: 0, single: 0, double: 0, triple: 0, hr: 0, oip: 0 };
    expect(battingLine(z, 5).avg).toBe(0);
    expect(rate3(1)).toBe('1.000');
  });
});
