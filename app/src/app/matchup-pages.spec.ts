import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { parseOpen } from './logic';

// Plan matchup-pages-1: buttons on /matchups/... pages open the game on that matchup, ready to pitch.
describe('parseOpen', () => {
  it('reads a plain matchup link', () => {
    expect(parseOpen('?b=bondb001&by=2001&p=gibsb101&py=1968&ref=mp-bonds-gibson')).toEqual({ b: 'bondb001', by: 2001, p: 'gibsb101', py: 1968 });
    expect(parseOpen('?b=ott-m101&by=1929&p=martp001&py=1999')).toEqual({ b: 'ott-m101', by: 1929, p: 'martp001', py: 1999 });
  });
  it('leaves seeded share links to parseShare', () => {
    expect(parseOpen('?b=ruthb101&by=1927&p=martp001&py=1999&s=1')).toBeNull();
  });
  it('rejects bad ids, bad years and missing fields', () => {
    expect(parseOpen('')).toBeNull();
    expect(parseOpen('?b=ruthb101&by=1927&p=martp001')).toBeNull();
    expect(parseOpen('?b=RUTHB101&by=1927&p=martp001&py=1999')).toBeNull();
    expect(parseOpen('?b=ruthb1&by=1927&p=martp001&py=1999')).toBeNull();
    expect(parseOpen('?b=ruthb101&by=1870&p=martp001&py=1999')).toBeNull();
    expect(parseOpen('?b=ruthb101&by=19x7&p=martp001&py=1999')).toBeNull();
    expect(parseOpen('?b=ruthb101&by=1927&p=martp001&py=2101')).toBeNull();
  });
});

describe('App opened from a matchup page', () => {
  const probs = { k: 0.21, bb: 0.21, hbp: 0.01, single: 0.1, double: 0.04, triple: 0.004, hr: 0.064, oip: 0.362 };
  const matchup = {
    batter: { id: 'bondb001', name: 'Barry Bonds', year: 2001, hand: 'L' },
    pitcher: { id: 'gibsb101', name: 'Bob Gibson', year: 1968, hand: 'R' },
    sameHand: false, probabilities: probs, neutral: 'x', engineVersion: '0.1.0',
    steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
  };
  const report = (role: 'bat' | 'pit', id: string, year: number) => ({
    id, name: id, role, year, age: 30, height: "6' 2\"", weight: '200 lb', bats: 'L', throws: 'R', position: role === 'pit' ? 'P' : 'LF',
    places: ['x'], line: 'a line', grade: 'A', era: year < 1946 ? '1920-1945' : '1990-2025', hof: true, ratios: [],
  });
  let calls: string[] = [];
  let events: { name: string; source?: string }[] = [];

  beforeEach(async () => {
    history.replaceState(null, '', '/?b=bondb001&by=2001&p=gibsb101&py=1968&ref=mp-bonds-gibson');
    localStorage.removeItem('pr_seen');   // a search visitor is new
    localStorage.setItem('pr_art_note', '1');
    calls = []; events = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/api/events')) { events.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(
        u.includes('/api/matchup?') ? matchup
        : u.includes('role=pit') && u.includes('/api/card') ? report('pit', 'gibsb101', 1968)
        : u.includes('/api/card') ? report('bat', 'bondb001', 2001) : []), { status: 200 });
    }) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  afterEach(() => history.replaceState(null, '', '/'));

  it('shows that matchup ready to pitch, as a first visit, without playing a pitch', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    for (let i = 0; i < 100 && !(app.pitcherReport() && app.batterReport()); i++) { await new Promise(r => setTimeout(r, 20)); fixture.detectChanges(); }
    await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); await fixture.whenStable();

    expect(app.screen()).toBe('matchup');
    expect(app.batter().name).toBe('Barry Bonds');
    expect(app.pitcher().name).toBe('Bob Gibson');
    expect(calls.filter(u => u.includes('/api/matchup?'))).toEqual(['/api/matchup?b=bondb001&by=2001&p=gibsb101&py=1968']);
    expect(calls.some(u => u.includes('/api/matchup/random'))).toBe(false);
    expect(calls.some(u => u.includes('/api/pitch'))).toBe(false);
    expect(calls.some(u => u.includes('/api/challenges/mine'))).toBe(true);
    const names = events.map(e => e.name);
    expect(names).not.toContain('share_open');
    expect(names).toContain('first_view');
    expect(events.find(e => e.name === 'open')?.source).toBe('mp-bonds-gibson');
    expect(app.result()).toBeNull();
  });

  it('a brand-new visitor (art note not yet seen) still counts as a first view and no pitch is thrown', async () => {
    localStorage.removeItem('pr_art_note');
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    for (let i = 0; i < 100 && !(app.pitcherReport() && app.batterReport()); i++) { await new Promise(r => setTimeout(r, 20)); fixture.detectChanges(); }
    await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); await fixture.whenStable();
    expect(app.batter().name).toBe('Barry Bonds');
    expect(events.map(e => e.name)).toContain('first_view');
    expect(calls.some(u => u.includes('/api/pitch'))).toBe(false);
  });

  it('a challenge link with matchup fields is left to the challenge screen', async () => {
    history.replaceState(null, '', '/c/new?b=bondb001&by=2001&p=gibsb101&py=1968');
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 50)); fixture.detectChanges(); await fixture.whenStable();
    expect(calls.some(u => u.includes('/api/matchup?b=bondb001'))).toBe(false);
  });
});
