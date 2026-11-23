// Plan 79 (planning/79-FRICTION-PLAN.md v3) parts D (note) and F: small text fixes.
import { TestBed } from '@angular/core/testing';
import { voice } from './audio';
import { ChallengeFlow } from './challenge';
import { saveKey, setWatched } from './challenge-api';
import { sideLine } from './side-line';

const P = (id: string, name: string, bats = 'R') => ({ id, year: 1950, name, bats, throws: 'R' });
const home = [P('hp', 'Home Pitcher'), ...Array.from({ length: 9 }, (_, i) => P(`h${i}`, `Home Batter${i}`))];
const away = [P('ap', 'Away Pitcher'), ...Array.from({ length: 9 }, (_, i) => P(`a${i}`, `Away Batter${i}`))];
const ab = (index: number, side: number, outcome: string, points: number, extra: object = {}) => ({
  index, round: 0, battingSide: side, pitcher: side ? home[0] : away[0], batter: side ? away[1 + (index % 9)] : home[1 + (index % 9)],
  seed: `s${index}`, outcome, points, inning: 1, outsBefore: 0, outsAfter: 0, basesBefore: [null, null, null], basesAfter: [null, null, null],
  outType: null, scored: [], runnersOut: [], doublePlay: false, sacFly: false, ...extra,
});
const CODE = 'P79fGame0000000000001';
const view = (over: object = {}) => ({
  code: CODE, status: 'resolved', you: 'creator', creatorName: 'Catcher 9891', opponentName: 'Bleacher 12', expiresUtc: '2030-01-01T00:00:00Z',
  canClaim: false, rematchOf: null, yourPicks: null, vsCpu: false, deco: 3, mode: 'inning', era: { dh: true, runnerOnSecond: false, season: 1990, batters: 9 },
  game: { lineups: [home, away], atBats: [ab(0, 1, 'hr', 2), ab(1, 0, 'k', 0)], totals: [0, 2], winner: 1, notes: [], lineScore: [[0], [2]], innings: 1 },
  ...over,
});

async function mount(v: unknown, code: string | null = CODE) {
  const origFetch = globalThis.fetch;
  history.replaceState(null, '', code ? '/c/' + code : '/');
  globalThis.fetch = (async (url: string) => new Response(code && String(url).includes('/api/challenges/' + code) ? JSON.stringify(v) : '[]',
    { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  vi.spyOn(voice, 'say').mockResolvedValue(undefined as never);
  vi.spyOn(voice, 'running').mockReturnValue(false);
  vi.spyOn(voice, 'prefetch').mockImplementation(() => undefined as never);
  vi.spyOn(voice, 'enable').mockResolvedValue(undefined as never);
  const f = TestBed.createComponent(ChallengeFlow);
  if (code) f.componentRef.setInput('code', code);
  for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await f.whenStable(); }
  return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement,
    restore: () => { globalThis.fetch = origFetch; vi.restoreAllMocks(); history.replaceState(null, '', '/'); localStorage.clear(); } };
}

describe('plan 79 F: small text fixes', () => {
  it('D2: no "Bats left" line; right-handed and switch hitters unchanged', () => {
    expect(sideLine('L', 'R')).toBeNull();
    expect(sideLine('L', 'L')).toBeNull();
    expect(sideLine('R', 'L')).toBe('Bats right.');
    expect(sideLine('B', 'R')).toBe('Switch hitter: bats left vs a righty.');
  });

  it('plays list: "Home run, 2 runs" with no space before the comma', async () => {
    setWatched(CODE, 2);
    const m = await mount(view());
    try {
      expect(m.c.step()).toBe('final');
      const li = Array.from(m.el.querySelectorAll('.plays-card li')).map(x => x.textContent!.replace(/\s+/g, ' ').trim());
      expect(li[0]).toBe('Away Batter0: Home run, 2 runs');
      expect(li.join('|')).not.toContain(' ,');
    } finally { m.restore(); }
  });

  it('home intro: the home side bats second', async () => {
    const m = await mount(null, null);
    try {
      expect(m.c.step()).toBe('home');
      const how = m.el.querySelector('.how')?.textContent ?? '';
      expect(how).toContain('their hitters bat first, then yours');
      expect(how).not.toContain('your hitters bat until 3 outs, then theirs');
    } finally { m.restore(); }
  });

  it('D: the first play note says ties go up to 3 extra innings', async () => {
    setWatched(CODE, 0);
    const m = await mount(view());
    try {
      expect(m.c.step()).toBe('play');
      expect(m.el.querySelector('.result .note')?.textContent).toContain('One inning. Tied? Up to 3 extra.');
    } finally { m.restore(); }
  });

  it('waiting screen: the private link sits only inside its "Only for you" box', async () => {
    saveKey(CODE, 'k'.repeat(43));
    const m = await mount(view({ status: 'open', game: null, opponentName: null, yourPicks: [] }));
    try {
      expect(m.c.step()).toBe('waiting');
      const box = m.el.querySelector('.private');
      expect(box?.textContent).toContain('Only for you');
      const priv = Array.from(m.el.querySelectorAll('button')).filter(b => b.textContent?.includes('private link'));
      expect(priv.length).toBe(1);
      expect(box!.contains(priv[0])).toBe(true);
    } finally { m.restore(); }
  });
});
