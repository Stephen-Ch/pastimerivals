// Plan 79 C (planning/79-FRICTION-PLAN.md v3): the Last Licks team builder behaves like the Duel picker.
// Famous seasons shelf on an empty search; "Use YEAR (best season)" commits in one tap; Quick pick hidden after the first hand pick;
// the team in progress kept in sessionStorage (restored picks re-checked), cleared on Lock.
import { TestBed } from '@angular/core/testing';
import { voice } from './audio';
import { ChallengeFlow } from './challenge';
import { checkKept, KeptTeam, loadTeam, teamKey } from './team-keep';
import { rowsKey } from './inning';

const FEATURED = {
  pit: [{ id: 'koufs101', name: 'Sandy Koufax', years: '1955-1966', bats: 'R', throws: 'L', hof: true, bio: '', year: 1965, line: 'x' },
    { id: 'gibsb101', name: 'Bob Gibson', years: '1959-1975', bats: 'R', throws: 'R', hof: true, bio: '', year: 1968, line: 'x' }],
  bat: [{ id: 'ruthb101', name: 'Babe Ruth', years: '1914-1935', bats: 'L', throws: 'L', hof: true, bio: '', year: 1927, line: 'x' },
    { id: 'maysw101', name: 'Willie Mays', years: '1951-1973', bats: 'R', throws: 'R', hof: true, bio: '', year: 1954, line: 'x' }],
};
const SEASONS = [1963, 1964, 1965, 1966].map(year => ({ year, teams: 'NL', pa: 300, line: 'l', grade: 'A', isDefault: year === 1963, isBest: year === 1965, bestFallback: false }));
const ERA = { dh: true, runnerOnSecond: false, season: 1965, batters: 9 };
const QUICK = { era: ERA, batters: 9, slots: Array.from({ length: 10 }, (_, slot) => ({ slot, choices: [{ id: `q${slot}`, year: 1960 + slot, name: `Quick ${slot}`, bats: 'R', throws: 'R' }] })) };
const CODE = 'P79cGame0000000000001';
const OPEN_VIEW = (batters: number) => ({ code: CODE, status: 'open', you: 'opponent', creatorName: 'Catcher 9891', opponentName: null, expiresUtc: '2030-01-01T00:00:00Z',
  canClaim: true, rematchOf: null, yourPicks: null, game: null, vsCpu: false, deco: 3, mode: 'inning', era: { ...ERA, batters } });

let calls: string[] = [];
function route(url: string, view: unknown): unknown {
  calls.push(url);
  if (url.includes('/api/players/featured')) return url.includes('role=pit') ? FEATURED.pit : FEATURED.bat;
  if (url.includes('/seasons')) return SEASONS;
  if (url.includes('/api/challenges/similar')) return [];
  if (url.includes('/api/challenges/era')) return ERA;
  if (url.includes('/api/challenges/quickpick')) return QUICK;
  if (url.includes('/api/challenges/computer')) return { code: 'P79cCpu00000000000001', key: 'k'.repeat(43), view: { ...(OPEN_VIEW(9) as object), code: 'P79cCpu00000000000001', status: 'resolved', you: 'creator', vsCpu: true, game: { lineups: [[], []], atBats: [], totals: [0, 0], winner: -1, notes: [] } } };
  if (url.includes('/api/me')) return { nickname: 'Tester', choices: [] };
  if (url.includes(`/api/challenges/${CODE}`)) return view;
  return [];
}

async function mount(opts: { startMode?: 'cpu' | 'friend'; code?: string; view?: unknown } = {}) {
  const origFetch = globalThis.fetch;
  history.replaceState(null, '', opts.code ? '/c/' + opts.code : '/c/new');
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(route(String(url), opts.view)),
    { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  vi.spyOn(voice, 'say').mockResolvedValue(undefined as never);
  vi.spyOn(voice, 'running').mockReturnValue(false);
  vi.spyOn(voice, 'prefetch').mockImplementation(() => undefined as never);
  vi.spyOn(voice, 'enable').mockResolvedValue(undefined as never);
  const f = TestBed.createComponent(ChallengeFlow);
  if (opts.code) f.componentRef.setInput('code', opts.code);
  if (opts.startMode) f.componentRef.setInput('startMode', opts.startMode);
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await f.whenStable(); } };
  await settle();
  return { f, settle, c: f.componentInstance as any, el: f.nativeElement as HTMLElement,
    restore: () => { globalThis.fetch = origFetch; vi.restoreAllMocks(); history.replaceState(null, '', '/'); f.destroy(); } };
}
const buttons = (el: HTMLElement, text: string | RegExp) => Array.from(el.querySelectorAll('button')).filter(b => typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent?.trim() ?? ''));

beforeEach(() => { sessionStorage.clear(); calls = []; });

describe('plan 79 C: team builder like the Duel picker', () => {
  it('empty search shows the famous seasons shelf by slot; one tap commits that season', async () => {
    const m = await mount({ startMode: 'friend' });
    try {
      m.c.goSlot(0); await m.settle();
      const pit = Array.from(m.el.querySelectorAll('.legends li')).map(x => x.textContent!.replace(/\s+/g, ' ').trim());
      expect(pit[0]).toContain('Sandy Koufax 1965');
      expect(pit.length).toBe(2);
      buttons(m.el, /^Sandy Koufax 1965/)[0].click(); await m.settle();
      expect(m.c.slots()[0].choices[0]).toMatchObject({ id: 'koufs101', year: 1965 });
      m.c.goSlot(1); await m.settle();
      expect(m.el.querySelector('.legends li')?.textContent).toContain('Babe Ruth 1927');
      m.c.onQuery('ma'); await m.settle();
      expect(m.el.querySelector('.legends'), 'shelf hides once typing starts').toBeNull();
    } finally { m.restore(); }
  });

  it('"Use 1965 (best season)" commits the best season in one tap; tapping a row still commits', async () => {
    const m = await mount({ startMode: 'friend' });
    try {
      m.c.goSlot(0); await m.settle();
      await m.c.choosePlayer(FEATURED.pit[0]); await m.settle();
      const use = buttons(m.el, 'Use 1965 (best season)');
      expect(use.length).toBe(1);
      use[0].click(); await m.settle();
      expect(m.c.slots()[0].choices[0]).toMatchObject({ id: 'koufs101', year: 1965 });
      m.c.goSlot(0); m.c.openSearch(true); await m.c.choosePlayer(FEATURED.pit[0]); await m.settle();
      buttons(m.el, /^1963/)[0].click(); await m.settle();
      expect(m.c.slots()[0].choices[0].year).toBe(1963);
    } finally { m.restore(); }
  });

  it('Quick pick: shown on an empty team and while every slot came from Quick pick; hidden after the first hand pick', async () => {
    const m = await mount({ startMode: 'friend' });
    try {
      expect(m.c.step()).toBe('review');
      expect(buttons(m.el, 'Quick pick').length).toBe(1);
      await m.c.quickPick(); await m.settle();
      expect(m.c.slots()[1].choices[0].id).toBe('q1');
      expect(buttons(m.el, 'Quick pick').length, 'all quick: still offered').toBe(1);
      m.c.goSlot(1); m.c.openSearch(true); await m.settle();
      buttons(m.el, /^Babe Ruth 1927/)[0].click(); await m.settle();
      expect(buttons(m.el, 'Quick pick').length, 'pick screen').toBe(0);
      m.c.step.set('review'); await m.settle();
      expect(buttons(m.el, 'Quick pick').length, 'review screen').toBe(0);
    } finally { m.restore(); }
  });

  it('keys: new friend challenge, computer game, accept and rematch', () => {
    expect(teamKey('create', 'inning', null)).toBe('pr_team:inning:new');
    expect(teamKey('cpu', 'inning', null)).toBe('pr_team:inning:cpu');
    expect(teamKey('accept', 'inning', CODE)).toBe(`pr_team:inning:${CODE}`);
    expect(teamKey('rematch', 'classic', CODE)).toBe(`pr_team:classic:rematch:${CODE}`);
    expect(teamKey('accept', 'inning', null)).toBeNull();
  });

  it('a reload keeps the team (with the sitting-out player); Lock clears it', async () => {
    let m = await mount({ startMode: 'cpu' });
    try {
      m.c.goSlot(1); m.c.openSearch(true); await m.settle();
      buttons(m.el, /^Babe Ruth 1927/)[0].click(); await m.settle();
      m.c.sittingOut.set({ slot: 9, choices: [{ id: 'maysw101', year: 1954, name: 'Willie Mays', bats: 'R', throws: 'R' }] }); await m.settle();
      expect(loadTeam('pr_team:inning:cpu')?.slots[1]?.choices[0].id).toBe('ruthb101');
    } finally { m.restore(); }
    m = await mount({ startMode: 'cpu' });
    try {
      expect(m.c.slots()[1]?.choices[0]).toMatchObject({ id: 'ruthb101', year: 1927 });
      expect(m.c.sittingOut()?.choices[0].id).toBe('maysw101');
      expect(buttons(m.el, 'Quick pick').length, 'hand pick remembered').toBe(0);
      expect(sessionStorage.getItem('pr_team:inning:new'), 'other flows untouched').toBeNull();
      m.c.slots.set(QUICK.slots); m.c.sittingOut.set(null); m.c.era.set(ERA); m.c.eraKey.set(rowsKey(QUICK.slots, 9)); await m.settle();
      expect(m.c.teamDone()).toBe(true);
      await m.c.lockTeam(); await m.settle();
      expect(calls.some(u => u.includes('/api/challenges/computer'))).toBe(true);
      expect(sessionStorage.getItem('pr_team:inning:cpu'), 'cleared on Lock').toBeNull();
    } finally { m.restore(); }
  });

  it('the friend\'s restored picks go through the era check: rows past the game\'s batters are dropped', async () => {
    const kept: KeptTeam = { slots: QUICK.slots, sittingOut: null, hand: true };
    sessionStorage.setItem(`pr_team:inning:${CODE}`, JSON.stringify(kept));
    const m = await mount({ code: CODE, view: OPEN_VIEW(8) });
    try {
      expect(m.c.step()).toBe('intro');
      expect(m.c.slots()[8]?.choices[0].id).toBe('q8');
      expect(m.c.slots()[9]).toBeNull();
      expect(buttons(m.el, 'Quick pick').length, 'intro: no Quick pick over a hand-picked team').toBe(0);
    } finally { m.restore(); }
  });

  it('checkKept: bad shapes and other game modes are dropped', () => {
    const ok: KeptTeam = { slots: QUICK.slots, sittingOut: null, hand: false };
    expect(checkKept(ok, 10, null)?.slots[9]?.choices[0].id).toBe('q9');
    expect(checkKept(ok, 4, null), 'wrong size (classic team)').toBeNull();
    expect(checkKept({ ...ok, slots: QUICK.slots.map((s, i) => (i === 3 ? { slot: 3, choices: [{ id: 5 }] } : s)) } as never, 10, null)?.slots[3]).toBeNull();
    expect(checkKept(null as never, 10, null)).toBeNull();
    expect(checkKept({ ...ok, sittingOut: { slot: 9, choices: [] } } as never, 10, null)?.sittingOut).toBeNull();
    expect(checkKept(ok, 10, 8)?.slots[9]).toBeNull();
  });
});

// ---- Diff review 1 (PASS WITH FIXES) folded ----
const RESOLVED_VIEW = (mode: 'inning' | 'classic') => ({ ...(OPEN_VIEW(9) as object), status: 'resolved', you: 'creator', opponentName: 'Bleacher 12', canClaim: false, mode,
  era: mode === 'inning' ? ERA : null, game: { lineups: [[], []], atBats: [], totals: [1, 0], winner: 0, notes: [] } });

describe('plan 79 C, diff review 1 fixes', () => {
  it('M1: leaving the builder (Home or Back) drops the kept team, so Quick pick comes back next time', async () => {
    const m = await mount({ startMode: 'cpu' });
    try {
      m.c.goSlot(1); m.c.openSearch(true); await m.settle();
      buttons(m.el, /^Babe Ruth 1927/)[0].click(); await m.settle();
      expect(sessionStorage.getItem('pr_team:inning:cpu')).not.toBeNull();
      m.c.step.set('review'); await m.settle();
      m.c.backFromPicking(); await m.settle();
      expect(sessionStorage.getItem('pr_team:inning:cpu'), 'Back from the team list').toBeNull();
    } finally { m.restore(); }
  });

  it('M1: a closed game (409) drops the kept team', async () => {
    sessionStorage.setItem(`pr_team:inning:${CODE}`, JSON.stringify({ slots: QUICK.slots, sittingOut: null, hand: true }));
    const m = await mount({ code: CODE, view: OPEN_VIEW(9) });
    try {
      m.c.startPicking('accept'); await m.settle();
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'x', code: 'expired' }), { status: 409, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
      await m.c.lockTeam(); await m.settle();
      expect(m.c.step()).toBe('closed');
      expect(sessionStorage.getItem(`pr_team:inning:${CODE}`)).toBeNull();
    } finally { m.restore(); }
  });

  it('M2: accept flow: the restored team survives "Pick your team"', async () => {
    sessionStorage.setItem(`pr_team:inning:${CODE}`, JSON.stringify({ slots: QUICK.slots, sittingOut: null, hand: true }));
    const m = await mount({ code: CODE, view: OPEN_VIEW(9) });
    try {
      buttons(m.el, 'Pick your team')[0].click(); await m.settle();
      expect(m.c.step()).toBe('review');
      expect(m.c.slots()[9]?.choices[0].id).toBe('q9');
      expect(buttons(m.el, 'Quick pick').length).toBe(0);
    } finally { m.restore(); }
  });

  it('M2: rematch: the team kept under rematch:<old code> comes back after a reload', async () => {
    sessionStorage.setItem(`pr_team:inning:rematch:${CODE}`, JSON.stringify({ slots: QUICK.slots, sittingOut: null, hand: true }));
    const m = await mount({ code: CODE, view: RESOLVED_VIEW('inning') });
    try {
      m.c.startPicking('rematch'); await m.settle();
      expect(m.c.slots()[1]?.choices[0].id).toBe('q1');
      expect(calls.some(u => u.includes('/api/challenges/era')), 'home side asks for its rules again').toBe(true);
      expect(m.c.teamDone()).toBe(true);
    } finally { m.restore(); }
  });

  it('M2: a reload while the rules are being fetched: Lock waits for the answer for exactly these rows', async () => {
    sessionStorage.setItem('pr_team:inning:cpu', JSON.stringify({ slots: QUICK.slots, sittingOut: null, hand: false }));
    const m = await mount({ startMode: 'cpu' });
    try {
      expect(m.c.eraKey()).toBe(rowsKey(QUICK.slots, 9));
      expect(m.c.teamDone()).toBe(true);
    } finally { m.restore(); }
  });

  it('m1: classic games show the pitcher shelf on slot 0 too', async () => {
    const m = await mount({ code: CODE, view: RESOLVED_VIEW('classic') });
    try {
      m.c.startPicking('rematch'); await m.settle();
      expect(m.c.step()).toBe('pick');
      expect(m.el.querySelector('.legends li')?.textContent).toContain('Sandy Koufax 1965');
    } finally { m.restore(); }
  });

  it('m2: a shelf tap shows "Adding..." while the backups load, not an empty season list', async () => {
    const m = await mount({ startMode: 'friend' });
    try {
      m.c.goSlot(0); await m.settle();
      const p = m.c.chooseFeatured(FEATURED.pit[0]);
      m.f.detectChanges();
      expect(m.el.textContent).toContain('Adding Sandy Koufax 1965...');
      expect(m.el.textContent).not.toContain('Back to search');
      await p; await m.settle();
      expect(m.c.slots()[0].choices[0].id).toBe('koufs101');
    } finally { m.restore(); }
  });

  it('m5: a restored team never has the same player twice', () => {
    const dup = QUICK.slots.map((s, i) => (i === 4 ? { slot: 4, choices: [QUICK.slots[2].choices[0]] } : s));
    const t = checkKept({ slots: dup, sittingOut: null, hand: true }, 10, null)!;
    expect(t.slots[2]?.choices[0].id).toBe('q2');
    expect(t.slots[4]).toBeNull();
  });
});
