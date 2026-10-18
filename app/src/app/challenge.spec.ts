import { challengeFromPath } from './app';
import { links } from './challenge-api';

describe('challenge routing and links (plan 24)', () => {
  it('reads /c/ paths', () => {
    expect(challengeFromPath('/')).toBeUndefined();
    expect(challengeFromPath('/c/new')).toBeNull();
    expect(challengeFromPath('/c/54EjHH01sszqRhaQxoTpyA')).toBe('54EjHH01sszqRhaQxoTpyA');
    expect(challengeFromPath('/c/bad code')).toBeUndefined();
  });

  it('keeps the private key after the # so it never reaches the server', () => {
    const l = links('https://pastimerivals.com', 'abc', 'k'.repeat(43));
    expect(l.share).toBe('https://pastimerivals.com/c/abc');
    expect(l.private).toBe(`https://pastimerivals.com/c/abc#k=${'k'.repeat(43)}`);
    expect(links('https://x', 'abc', null).private).toBeNull();
  });
});
