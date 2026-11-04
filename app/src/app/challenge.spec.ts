import { challengeFromPath } from './app';
import { CAtBat, CPlayer, CView, links } from './challenge-api';
import { parkLookForView } from './challenge';

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

// Plan 59 Round 1b test 7: one park for the whole Last Licks game. Inning games: the era season; classic games
// (no era): the home side's pitcher (side 0, slot 0). Batters from three eras do not change it.
describe('plan 59 r1b: one park per game', () => {
  const P = (id: string, year: number): CPlayer => ({ id, year, name: id, bats: 'R', throws: 'R' });
  const home = [P('hp', 1972), P('h1', 1910), P('h2', 1950), P('h3', 2001)], away = [P('ap', 1931), P('a1', 1925), P('a2', 1985), P('a3', 1999)];
  const ab = (i: number, side: number, b: CPlayer): CAtBat => ({ index: i, round: 0, battingSide: side, pitcher: side ? home[0] : away[0], batter: b, seed: `s${i}`, outcome: 'k', points: 0 });
  const game = { lineups: [home, away], atBats: [ab(0, 1, away[1]), ab(1, 1, away[2]), ab(2, 0, home[1]), ab(3, 0, home[2]), ab(4, 0, home[3])], totals: [0, 0] as [number, number], winner: -1, notes: [] };
  const view = (era: CView['era']): CView => ({ code: 'x', status: 'resolved', you: 'creator', creatorName: 'a', opponentName: 'b', expiresUtc: '', canClaim: false,
    rematchOf: null, yourPicks: null, game, vsCpu: true, mode: era ? 'inning' : 'classic', era });
  it('inning game: the era season, whatever the batter years', () => {
    expect(parkLookForView(view({ dh: true, runnerOnSecond: false, season: 1987, batters: 9 }))).toBe('1970');
  });
  it('classic game: the home pitcher', () => {
    expect(parkLookForView(view(null))).toBe('1970');
    expect(parkLookForView({ ...view(null), game: { ...game, lineups: [[P('hp', 1911)], away] } })).toBe('1901');
  });
  it('no game: null', () => {
    expect(parkLookForView(null)).toBeNull();
    expect(parkLookForView({ ...view(null), game: null })).toBeNull();
  });
});

// ---- Plan 59 Round 2b test 7: Last Licks keeps the finished scene on screen, held; everything that reads scene() acts as between at-bats ----
import { TestBed } from '@angular/core/testing';
import { voice } from './audio';
import { voiceOn } from './voice-setting';
import { ChallengeFlow } from './challenge';

const LL_VIEW = {"code": "E2eLastLicksGame000001", "status": "resolved", "you": "creator", "creatorName": "Tester", "opponentName": "Computer", "expiresUtc": "2030-01-01T00:00:00Z", "canClaim": false, "rematchOf": null, "yourPicks": null, "vsCpu": true, "cpuLevel": 1, "deco": 3, "mode": "inning", "era": {"dh": true, "runnerOnSecond": false, "season": 1999, "batters": 9}, "game": {"lineups": [[{"id": "martp001", "year": 1999, "name": "Pedro Martinez", "bats": "R", "throws": "R"}, {"id": "homeb001", "year": 1955, "name": "Home Batter 1", "bats": "R", "throws": "R"}, {"id": "homeb002", "year": 1960, "name": "Home Batter 2", "bats": "R", "throws": "R"}, {"id": "homeb003", "year": 1965, "name": "Home Batter 3", "bats": "R", "throws": "R"}, {"id": "homeb004", "year": 1970, "name": "Home Batter 4", "bats": "R", "throws": "R"}, {"id": "homeb005", "year": 1975, "name": "Home Batter 5", "bats": "R", "throws": "R"}, {"id": "homeb006", "year": 1980, "name": "Home Batter 6", "bats": "R", "throws": "R"}, {"id": "homeb007", "year": 1985, "name": "Home Batter 7", "bats": "R", "throws": "R"}, {"id": "homeb008", "year": 1990, "name": "Home Batter 8", "bats": "R", "throws": "R"}, {"id": "homeb009", "year": 1995, "name": "Home Batter 9", "bats": "R", "throws": "R"}], [{"id": "gibsb001", "year": 1968, "name": "Bob Gibson", "bats": "R", "throws": "R"}, {"id": "aaroh101", "year": 1957, "name": "Hank Aaron", "bats": "R", "throws": "R"}, {"id": "ruthb101", "year": 1927, "name": "Babe Ruth", "bats": "L", "throws": "L"}, {"id": "visb003", "year": 1993, "name": "Visitor Batter 3", "bats": "R", "throws": "R"}, {"id": "visb004", "year": 1994, "name": "Visitor Batter 4", "bats": "R", "throws": "R"}, {"id": "visb005", "year": 1995, "name": "Visitor Batter 5", "bats": "R", "throws": "R"}, {"id": "visb006", "year": 1996, "name": "Visitor Batter 6", "bats": "R", "throws": "R"}, {"id": "visb007", "year": 1997, "name": "Visitor Batter 7", "bats": "R", "throws": "R"}, {"id": "visb008", "year": 1998, "name": "Visitor Batter 8", "bats": "R", "throws": "R"}, {"id": "visb009", "year": 1999, "name": "Visitor Batter 9", "bats": "R", "throws": "R"}]], "atBats": [{"index": 0, "round": 0, "battingSide": 1, "pitcher": {"id": "martp001", "year": 1999, "name": "Pedro Martinez", "bats": "R", "throws": "R"}, "batter": {"id": "aaroh101", "year": 1957, "name": "Hank Aaron", "bats": "R", "throws": "R"}, "seed": "e2e0", "outcome": "double", "points": 0, "inning": 1, "spot": 0, "outsBefore": 0, "outsAfter": 0, "basesBefore": [null, null, null], "basesAfter": [null, "aaroh101", null], "outType": null, "scored": [], "runnersOut": [], "doublePlay": false, "sacFly": false}, {"index": 1, "round": 0, "battingSide": 1, "pitcher": {"id": "martp001", "year": 1999, "name": "Pedro Martinez", "bats": "R", "throws": "R"}, "batter": {"id": "ruthb101", "year": 1927, "name": "Babe Ruth", "bats": "L", "throws": "L"}, "seed": "e2e1", "outcome": "k", "points": 0, "inning": 1, "spot": 1, "outsBefore": 0, "outsAfter": 1, "basesBefore": [null, "aaroh101", null], "basesAfter": [null, "aaroh101", null], "outType": null, "scored": [], "runnersOut": [], "doublePlay": false, "sacFly": false}, {"index": 2, "round": 0, "battingSide": 1, "pitcher": {"id": "martp001", "year": 1999, "name": "Pedro Martinez", "bats": "R", "throws": "R"}, "batter": {"id": "visb003", "year": 1993, "name": "Visitor Batter 3", "bats": "R", "throws": "R"}, "seed": "e2e2", "outcome": "oip", "points": 0, "inning": 1, "spot": 2, "outsBefore": 1, "outsAfter": 2, "basesBefore": [null, "aaroh101", null], "basesAfter": [null, null, "aaroh101"], "outType": "ground", "scored": [], "runnersOut": [], "doublePlay": false, "sacFly": false}], "totals": [0, 0], "winner": -1, "notes": [], "lineScore": [[0], [0]], "innings": 1, "lineupSources": [["pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick"], ["pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick", "pick"]]}};
const LL_SIDE = { sheet: '/s.webp', frames: Array.from({ length: 8 }, () => ({})), lineArt: false };

describe('plan 59 r2b: Last Licks held scene', () => {
  it('after an at-bat: the scene stays (held), Pitch is enabled, no board count, the next batter\'s intro is spoken', async () => {
    history.replaceState(null, '', '/c/' + LL_VIEW.code);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(String(url).includes('/api/challenges/' + LL_VIEW.code) ? JSON.stringify(LL_VIEW) : '[]',
      { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const wasOn = voiceOn();
    const say = vi.spyOn(voice, 'say').mockResolvedValue(undefined as never);
    vi.spyOn(voice, 'running').mockReturnValue(true);
    vi.spyOn(voice, 'prefetch').mockImplementation(() => undefined as never);
    vi.spyOn(voice, 'enable').mockResolvedValue(undefined as never);
    try {
      const f = TestBed.createComponent(ChallengeFlow);
      f.componentRef.setInput('code', LL_VIEW.code);
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await f.whenStable(); }
      const c = f.componentInstance as any, el = f.nativeElement as HTMLElement;
      expect(c.step()).toBe('play');
      const ab = c.game().atBats[0];
      c.scene.set({ ab, art: LL_SIDE, windup: null });
      f.detectChanges(); await f.whenStable();
      const scene = el.querySelector('pr-pitch-scene');
      expect(scene).not.toBeNull();
      voiceOn.set(true);
      say.mockClear();
      c.sceneDone();
      f.detectChanges(); await f.whenStable();
      expect(el.querySelector('pr-pitch-scene'), 'same scene, held').toBe(scene);
      expect(el.querySelector('pr-pitch-scene .stage')?.getAttribute('data-held')).toBe('1');
      expect(el.querySelector('pr-pitch-scene .held-band')?.textContent).toContain(c.lastCall());
      expect(c.boardCount()).toBeNull();
      const pitch = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Pitch') as HTMLButtonElement;
      expect(pitch.disabled).toBe(false);
      expect(say.mock.calls.some(([, kind]) => kind === 'intro'), 'the next batter is introduced').toBe(true);
      expect(el.querySelector('pr-pitch-scene .under')?.textContent).toContain('Next:');
    } finally { voiceOn.set(wasOn); globalThis.fetch = origFetch; vi.restoreAllMocks(); history.replaceState(null, '', '/'); }
  });
});

// ---- PLAN-2026-11-04-team-identity-v3 Part A: away left / home right, colors and "you / they" on screen only ----
describe('team identity (plan 2026-11-04)', () => {
  it('Last Licks as home: board order, scores, short names, pills, header, tags; spoken lines carry none of the new words', async () => {
    history.replaceState(null, '', '/c/' + LL_VIEW.code);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(String(url).includes('/api/challenges/' + LL_VIEW.code) ? JSON.stringify(LL_VIEW) : '[]',
      { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const wasOn = voiceOn();
    const say = vi.spyOn(voice, 'say').mockResolvedValue(undefined as never);
    vi.spyOn(voice, 'running').mockReturnValue(true);
    vi.spyOn(voice, 'prefetch').mockImplementation(() => undefined as never);
    vi.spyOn(voice, 'enable').mockResolvedValue(undefined as never);
    try {
      const f = TestBed.createComponent(ChallengeFlow);
      f.componentRef.setInput('code', LL_VIEW.code);
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await f.whenStable(); }
      const c = f.componentInstance as any, el = f.nativeElement as HTMLElement;
      voiceOn.set(true);
      // creator = side 0 = home; the away Computer bats first and sits on the left
      expect(c.boardNames()).toEqual(['The Computer', 'Tester (you)']);
      expect(c.boardShort()).toEqual(['Computer', 'You']);
      expect(c.boardScores([3, 5])).toEqual([5, 3]);
      expect(c.boardPills()).toEqual(['#f5a142', '#1f5fbf']);
      expect(c.boardBatting()).toBe(0);
      expect(el.querySelector('.vs-line')?.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Top 1 · They bat \(away\) · Batter \d$/);
      const ab = c.game().atBats[0];
      c.scene.set({ ab, art: LL_SIDE, windup: null });
      f.detectChanges(); await f.whenStable();
      c.sceneDone();
      f.detectChanges(); await f.whenStable();
      expect(el.querySelector('.ll-next')?.textContent).toContain('(theirs)');
      expect(el.querySelector('.result-word .team-chip')?.textContent).toBe('THEM');
      expect(el.querySelector('.result-word .team-chip')?.getAttribute('aria-hidden')).toBe('true');
      expect(c.teamWord(0)).toBe('You');
      const spoken = say.mock.calls.map(([t]) => String(t)).join(' | ');
      expect(spoken.length).toBeGreaterThan(0);
      for (const w of ['You bat', 'They bat', '(yours)', '(theirs)', 'Your team', 'Their team', 'YOU', 'THEM']) expect(spoken).not.toContain(w);
      // spectator: no who/where, home blue / away orange
      c.view.set({ ...c.view(), you: null });
      f.detectChanges(); await f.whenStable();
      expect(c.boardPills()).toEqual(['#f5a142', '#1f5fbf']);
      expect(c.ownTag(1)).toBe('');
      expect(c.teamWord(0)).toBe('Tester');
      // classic / Duel-style games: unchanged order, no pills, no short names, no batting dim
      c.view.set({ ...c.view(), you: 'creator', mode: 'classic' });
      f.detectChanges(); await f.whenStable();
      expect(c.boardNames()).toEqual(['Tester (you)', 'The Computer']);
      expect(c.boardScores([3, 5])).toEqual([3, 5]);
      expect(c.boardPills()).toBeNull();
      expect(c.boardShort()).toBeNull();
      expect(c.boardBatting()).toBeNull();
      expect(c.teamWord(0)).toBe('Tester');
    } finally { voiceOn.set(wasOn); globalThis.fetch = origFetch; vi.restoreAllMocks(); history.replaceState(null, '', '/'); }
  });
});
