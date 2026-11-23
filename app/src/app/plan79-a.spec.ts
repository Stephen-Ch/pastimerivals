// Plan 79 A (server-made team names), B (the friend's link page) and A1 (typed names, reporting): app side.
// planning/79-FRICTION-PLAN.md v3, planning/79-A1-TYPED-NAME-PLAN.md v6.
import { TestBed } from '@angular/core/testing';
import { voice } from './audio';
import { ChallengeFlow } from './challenge';
import type { CMine, CView } from './challenge-api';
import { GamesList } from './games-list';
import { canReport, cleanTyped, mineNames, shortLabel, sideLabel, typedLocalOk } from './team-names';
import { checkKept } from './team-keep';
import { rowsKey } from './inning';

const CODE = 'P79aGame0000000000001';
const ERA = { dh: true, runnerOnSecond: false, season: 1965, batters: 9 };
const TEAMS = ['Toledo Night Owls', 'Erie Kingfishers', 'Boise Lanterns', 'Akron Riveters'];
const base = { code: CODE, expiresUtc: '2030-01-01T00:00:00Z', rematchOf: null, yourPicks: null, vsCpu: false, deco: 3, mode: 'inning' as const, era: ERA };
const OPEN: CView = { ...base, status: 'open', you: 'visitor', creatorName: 'Catcher 9891', opponentName: null, canClaim: true, game: null,
  creatorTeam: 'Toledo Night Owls', creatorShort: 'Night Owls', creatorTyped: false, teamChoices: ['Erie Kingfishers', 'Boise Lanterns', 'Akron Riveters', 'Omaha Starlings'] };
const AB = (i: number, side: number, outcome: any, points: number, inning = 1): any => ({ index: i, round: 0, battingSide: side, seed: String(i), outcome, points, inning, spot: 1,
  outsBefore: 0, outsAfter: outcome === 'oip' ? 1 : 0, basesBefore: [null, null, null], basesAfter: [null, null, null], scored: [],
  pitcher: { id: 'p', year: 1965, name: 'Sandy Koufax', bats: 'R', throws: 'L' }, batter: { id: 'b' + i, year: 1954, name: 'Willie Mays', bats: 'R', throws: 'R' } });
const DONE = (you: CView['you'], typed: [boolean, boolean]): CView => ({ ...base, status: 'resolved', you, creatorName: 'Catcher 9891', opponentName: 'Ace 1234', canClaim: false,
  creatorTeam: typed[0] ? 'Jake Smells' : 'Toledo Night Owls', opponentTeam: typed[1] ? "Jake's Nine" : 'Erie Kingfishers',
  creatorShort: typed[0] ? 'Jake Smells' : 'Night Owls', opponentShort: typed[1] ? "Jake's Nine" : 'Kingfishers', creatorTyped: typed[0], opponentTyped: typed[1],
  game: { lineups: [[], []], atBats: [AB(0, 1, 'oip', 0), AB(1, 0, 'hr', 1)], totals: [1, 0], winner: 0, notes: [], lineScore: [[1], [0]], innings: 1 } });

let calls: { url: string; method: string; body: any }[] = [];
let checkReply: { status: number; body: unknown } = { status: 204, body: null };
function route(url: string, method: string, view: unknown, me: unknown): { status: number; body: unknown } {
  if (url.includes('/api/challenges/check-team')) return checkReply;
  if (url.includes('/report-name')) return { status: 204, body: null };
  if (url.includes('/api/players/featured')) return { status: 200, body: [] };
  if (url.includes('/api/challenges/era')) return { status: 200, body: ERA };
  if (url.includes('/api/challenges/mine')) return { status: 200, body: [] };
  if (url.endsWith('/api/challenges') && method === 'POST') return { status: 200, body: { code: CODE, key: 'k'.repeat(43) } };
  if (url.includes('/lock')) return { status: 200, body: { key: 'k'.repeat(43), view } };
  if (url.includes('/api/me')) return { status: 200, body: me };
  if (url.includes(`/api/challenges/${CODE}`)) return { status: 200, body: view };
  return { status: 200, body: [] };
}

async function mount(opts: { startMode?: 'cpu' | 'friend'; code?: string; view?: unknown; me?: unknown } = {}) {
  const origFetch = globalThis.fetch;
  history.replaceState(null, '', opts.code ? '/c/' + opts.code : '/c/new');
  document.cookie = 'XSRF-TOKEN=t; path=/';
  const me = opts.me ?? { nickname: 'Tester', choices: [], teams: TEAMS, typedNames: false };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = route(String(url), method, opts.view, me);
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  vi.spyOn(voice, 'say').mockResolvedValue(undefined as never);
  vi.spyOn(voice, 'running').mockReturnValue(false);
  vi.spyOn(voice, 'prefetch').mockImplementation(() => undefined as never);
  vi.spyOn(voice, 'enable').mockResolvedValue(undefined as never);
  const f = TestBed.createComponent(ChallengeFlow);
  if (opts.code) f.componentRef.setInput('code', opts.code);
  if (opts.startMode) f.componentRef.setInput('startMode', opts.startMode);
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await f.whenStable(); } };
  await settle();
  return { f, settle, c: f.componentInstance as any, el: f.nativeElement as HTMLElement,
    restore: () => { globalThis.fetch = origFetch; vi.restoreAllMocks(); history.replaceState(null, '', '/'); f.destroy(); } };
}
const buttons = (el: HTMLElement, text: string | RegExp) => Array.from(el.querySelectorAll('button')).filter(b => typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent?.trim() ?? ''));
const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');

beforeEach(() => { sessionStorage.clear(); calls = []; checkReply = { status: 204, body: null }; });

describe('plan 79 team name helpers', () => {
  it('labels a side by its team, falling back to the nickname (old games) and the computer', () => {
    expect(sideLabel(OPEN, 0)).toBe('The Toledo Night Owls');
    expect(sideLabel({ ...OPEN, creatorTeam: null }, 0)).toBe('Catcher 9891');
    expect(sideLabel({ ...OPEN, vsCpu: true, opponentTeam: null }, 1)).toBe('The Computer');
    expect(sideLabel({ ...OPEN, opponentTeam: null, opponentName: null }, 1)).toBe('Friend');
    expect(shortLabel(OPEN, 0)).toBe('Night Owls');
    expect(shortLabel({ ...OPEN, creatorTeam: null, creatorShort: null }, 0)).toBe('Catcher');
  });

  it('cleans typed text like the server (NFKC, spaces, a leading "The ") and pre-checks length and characters', () => {
    expect(cleanTyped('  the  Ｔａｃｏｍａ   Titans ')).toBe('Tacoma Titans');
    expect(typedLocalOk('Tacoma Titans')).toBe(true);
    expect(typedLocalOk('ab')).toBe(false);
    expect(typedLocalOk('Abcdefghij Klmnopqrst Uvwxyz')).toBe(false);
    expect(typedLocalOk('Tacoma Titans!')).toBe(false);
    expect(typedLocalOk('Токио Titans')).toBe(false);
  });

  it('"Report name" only for a typed name that is not yours', () => {
    const v = DONE('creator', [true, true]);
    expect(canReport(v, 0)).toBe(false);
    expect(canReport(v, 1)).toBe(true);
    expect(canReport(DONE('creator', [false, false]), 1)).toBe(false);
    expect(canReport(DONE('visitor', [true, false]), 0)).toBe(true);
  });

  it('Your games rows name the teams, falling back to nicknames', () => {
    const m: CMine = { code: CODE, you: 'creator', creatorName: 'Catcher 9891', opponentName: 'Ace 1234', createdUtc: '', status: 'resolved', vsCpu: false,
      creatorTeam: 'Toledo Night Owls', opponentTeam: 'Erie Kingfishers' };
    expect(mineNames(m)).toBe('You vs Erie Kingfishers');
    expect(mineNames({ ...m, you: 'opponent' })).toBe('Toledo Night Owls vs you');
    expect(mineNames({ ...m, opponentTeam: null })).toBe('You vs Ace 1234');
    expect(mineNames({ ...m, opponentTeam: null, opponentName: null })).toBe('Your challenge');
    const f = TestBed.createComponent(GamesList);
    f.componentRef.setInput('list', [m]);
    f.detectChanges();
    expect(text(f.nativeElement)).toContain('You vs Erie Kingfishers');
    f.destroy();
  });

  it('a kept team keeps its name; a bad name is dropped', () => {
    const slots = [{ slot: 0, choices: [{ id: 'a', year: 1965, name: 'A', bats: 'R', throws: 'R' }] }, ...Array(9).fill(null)];
    expect(checkKept({ slots, sittingOut: null, hand: true, team: 'Boise Lanterns' }, 10, null)?.team).toBe('Boise Lanterns');
    expect(checkKept({ slots, sittingOut: null, hand: true, team: 42 as never }, 10, null)?.team).toBeUndefined();
  });
});

describe('plan 79 A: the review screen names your team', () => {
  it('shows the first suggestion; "More names" offers 3 more; Lock sends the chosen name', async () => {
    const m = await mount({ startMode: 'cpu' });
    try {
      expect(m.c.step()).toBe('review');
      expect(text(m.el)).toContain('The Toledo Night Owls');
      expect(buttons(m.el, 'Change').length).toBe(1);
      buttons(m.el, 'Change')[0].click(); await m.settle();
      buttons(m.el, 'More names')[0].click(); await m.settle();
      const more = ['Erie Kingfishers', 'Boise Lanterns', 'Akron Riveters'];
      for (const n of more) expect(buttons(m.el, `The ${n}`).length, n).toBe(1);
      expect(buttons(m.el, /Type your own/).length, 'typed names off').toBe(0);
      buttons(m.el, 'The Boise Lanterns')[0].click(); await m.settle();
      expect(m.c.team()).toBe('Boise Lanterns');
      expect(text(m.el)).toContain('The Boise Lanterns');
      m.c.slots.set(Array.from({ length: 10 }, (_, slot) => ({ slot, choices: [{ id: `q${slot}`, year: 1960 + slot, name: `Q ${slot}`, bats: 'R', throws: 'R' }] })));
      m.c.era.set(ERA); m.c.eraKey.set(rowsKey(m.c.slots(), 9)); await m.settle();
      await m.c.lockTeam(); await m.settle();
      const post = calls.find(x => x.url.includes('/api/challenges/computer'));
      expect(post?.body.team).toBe('Boise Lanterns');
    } finally { m.restore(); }
  });

  it('typed names (switch on): Use checks the name on the server; a refusal shows and keeps the picks and the old name', async () => {
    const m = await mount({ startMode: 'friend', me: { nickname: 'Tester', choices: [], teams: TEAMS, typedNames: true } });
    try {
      m.c.openTeamSheet(); await m.settle();
      buttons(m.el, /Type your own/)[0].click(); await m.settle();
      const input = m.el.querySelector<HTMLInputElement>('input.team-input')!;
      expect(input.maxLength).toBe(24);
      checkReply = { status: 400, body: { error: 'Try another name.' } };
      input.value = 'Tacoma F4g'; input.dispatchEvent(new Event('input')); await m.settle();
      buttons(m.el, 'Use')[0].click(); await m.settle();
      expect(text(m.el)).toContain('Try another name.');
      expect(m.c.team()).toBe('Toledo Night Owls');
      checkReply = { status: 204, body: null };
      input.value = ' the Jake’s Nine '; input.dispatchEvent(new Event('input')); await m.settle();
      buttons(m.el, 'Use')[0].click(); await m.settle();
      expect(calls.filter(x => x.url.includes('check-team')).map(x => x.body.team)).toEqual(['Tacoma F4g', "Jake's Nine"]);
      expect(m.c.team()).toBe("Jake's Nine");
    } finally { m.restore(); }
  });
});

describe('plan 79 B: the friend\'s link page', () => {
  it('headline names the creator\'s team, the intro says your hitters bat first, and your default name comes from the suggestions', async () => {
    const m = await mount({ code: CODE, view: OPEN });
    try {
      expect(m.c.step()).toBe('intro');
      expect(m.el.querySelector('h1')?.textContent?.trim()).toBe('The Toledo Night Owls challenged you');
      expect(text(m.el)).toContain('your hitters bat until 3 outs, then theirs');
      expect(m.el.querySelector('img'), 'no picture').toBeNull();
      expect(m.c.team()).toBe('Erie Kingfishers');
      expect(buttons(m.el, 'Report name').length, 'server-made name').toBe(0);
    } finally { m.restore(); }
  });

  it('old games fall back to the nickname headline; a typed creator name can be reported', async () => {
    let m = await mount({ code: CODE, view: { ...OPEN, creatorTeam: null, creatorShort: null } });
    try { expect(m.el.querySelector('h1')?.textContent?.trim()).toBe('Catcher 9891 challenged you'); } finally { m.restore(); }
    m = await mount({ code: CODE, view: { ...OPEN, creatorTeam: 'Jake Smells', creatorShort: 'Jake Smells', creatorTyped: true } });
    try {
      buttons(m.el, 'Report name')[0].click(); await m.settle();
      const r = calls.find(x => x.url.includes('/report-name'));
      expect(r?.url).toContain(`/api/challenges/${CODE}/report-name`);
      expect(r?.body).toEqual({ side: 0 });
      expect(text(m.el)).toContain('Thanks. That name is gone.');
    } finally { m.restore(); }
  });
});

describe('plan 79 A + A1: names in the game', () => {
  it('the board uses the short team name and the final screen names the teams; Report name only under the other side\'s typed name', async () => {
    localStorage.setItem(`pr-watched-${CODE}`, '99');
    const m = await mount({ code: CODE, view: DONE('creator', [true, true]) });
    try {
      expect(m.c.step()).toBe('final');
      expect(m.c.boardShort()).toEqual(['Jake\'s Nine', 'You']);
      expect(text(m.el)).toContain('The Jake Smells');
      expect(buttons(m.el, 'Report name').length).toBe(1);
      buttons(m.el, 'Report name')[0].click(); await m.settle();
      expect(calls.find(x => x.url.includes('/report-name'))?.body).toEqual({ side: 1 });
    } finally { m.restore(); }
  });
});
