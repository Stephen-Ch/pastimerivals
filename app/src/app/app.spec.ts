import { TestBed } from '@angular/core/testing';
import { App, vsFromSearch } from './app';

const probs = { k: 0.3, bb: 0.12, hbp: 0.01, single: 0.12, double: 0.04, triple: 0.005, hr: 0.045, oip: 0.36 };
const matchup = {
  batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1927, hand: 'L' },
  pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 1999, hand: 'R' },
  sameHand: false, probabilities: probs, neutral: '1990-2019 MLB average', engineVersion: '0.1.0',
  steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
};

const report = (role: 'bat' | 'pit', name: string, year: number) => ({
  id: name, name, role, year, age: 30, height: "6' 2\"", weight: '200 lb', bats: 'L', throws: 'R', position: role === 'pit' ? 'P' : 'RF',
  places: ['New York, AL'], line: 'a line', grade: 'A', era: year < 1946 ? '1920-1945' : '1990-2025', hof: true,
  ratios: [{ label: 'Home runs', timesLeague: 9.3 }],
});

describe('App', () => {
  beforeEach(async () => {
    globalThis.fetch = (async (url: string) =>
      new Response(JSON.stringify(
        String(url).includes('/api/matchup') ? matchup
        : String(url).includes('role=pit') && String(url).includes('/api/card') ? report('pit', 'Pedro Martinez', 1999)
        : String(url).includes('/api/card') ? report('bat', 'Babe Ruth', 1927) : []), { status: 200 })) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the featured matchup with odds and the Retrosheet credit', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    // Plan 27: Home first, with the three ways in.
    expect(el.textContent).toContain('Play the computer');
    expect(el.textContent).toContain('Challenge a friend');
    expect(el.textContent).toContain('20 Sunset Rd., Newark, DE 19711');
    (fixture.componentInstance as any).openPractice();
    fixture.detectChanges(); await fixture.whenStable();
    expect(el.textContent).toContain('Pedro Martinez');
    expect(el.textContent).toContain('Babe Ruth');
    expect(el.textContent).toContain('Out in play 36%');
    expect(el.textContent).toContain('Strikeout 30%');
    expect(el.textContent).toContain('20 Sunset Rd., Newark, DE 19711');
    expect(el.querySelectorAll('.pcard svg').length).toBe(2);   // no art in tests: drawn figures
    expect(el.textContent).toContain('Change');
  });

  it('picker: shows loading at once, ignores a repeat tap, and a newer player wins', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    const app = fixture.componentInstance as any;
    const calls: string[] = [];
    const resolvers: Record<string, (v: Response) => void> = {};
    globalThis.fetch = ((url: string) => {
      calls.push(String(url));
      return new Promise<Response>(res => { resolvers[String(url).includes('aaa') ? 'a' : 'b'] = res; });
    }) as typeof fetch;
    app.openPicker('pit');
    const a = { id: 'aaa', name: 'Player A', years: '1900', bats: 'R', throws: 'R', hof: false };
    const b = { id: 'bbb', name: 'Player B', years: '1950', bats: 'R', throws: 'R', hof: false };
    app.choosePlayer(a); app.choosePlayer(a);
    fixture.detectChanges();
    expect(calls.length).toBe(1);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Loading seasons');
    app.choosePlayer(b);
    resolvers['b'](new Response(JSON.stringify([{ year: 1950, teams: 'X', pa: 600, line: 'b', grade: 'A', isDefault: true }])));
    await new Promise(r => setTimeout(r, 0));
    resolvers['a'](new Response(JSON.stringify([{ year: 1900, teams: 'Y', pa: 600, line: 'a', grade: 'A', isDefault: true }])));
    await new Promise(r => setTimeout(r, 0));
    fixture.detectChanges();
    expect(app.seasons()[0].year).toBe(1950);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Use 1950 (most played)');
  });

  it('picker: a failed seasons request offers Retry', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    const app = fixture.componentInstance as any;
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    app.openPicker('bat');
    await app.choosePlayer({ id: 'ccc', name: 'C', years: '2000', bats: 'L', throws: 'L', hof: false });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Retry');
  });

  it('moves matchup -> at-bat -> result and back (plan 23)', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    await fixture.whenStable();
    const app = fixture.componentInstance as any;
    expect(app.screen()).toBe('home');
    app.openPractice();
    expect(app.screen()).toBe('matchup');
    app.pending.set({ outcome: 'hr', seed: 'x', engineVersion: '0.1.0' });
    app['enterPlay']();
    expect(app.screen()).toBe('atbat');
    app.sceneDone();
    expect(app.screen()).toBe('result');
    app['onPopState']();
    expect(app.screen()).toBe('matchup');
    app.openOverlay('details');
    expect(app.overlay()).toBe('details');
    app['onPopState']();
    expect(app.overlay()).toBeNull();
  });

  it('Back from practice returns Home, and ?vs= picks the game type (plan 27)', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    const app = fixture.componentInstance as any;
    app.openPractice();
    expect(app.screen()).toBe('matchup');
    app['onPopState']();
    expect(app.screen()).toBe('home');
    expect(vsFromSearch('?vs=cpu')).toBe('cpu');
    expect(vsFromSearch('?vs=friend')).toBe('friend');
    expect(vsFromSearch('?vs=x')).toBeNull();
    expect(vsFromSearch('')).toBeNull();
  });
});
