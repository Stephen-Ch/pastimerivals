import { TestBed } from '@angular/core/testing';
import { App, sourceFromSearch, vsFromSearch } from './app';

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
    localStorage.setItem('pr_seen', '1');   // plan 36: returning player unless a test says otherwise
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
    // Plan 39: the matchup is home for everyone, with the ways to switch modes.
    await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); await fixture.whenStable();
    expect(el.textContent).toContain('Play an inning');
    expect(el.textContent).toContain('Challenge a friend');
    expect(el.textContent).toContain('About the art');
    expect(el.textContent).toContain('How the sim works');
    expect(el.textContent).not.toContain('More ways to play');
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

  it('every "Home" returns to the matchup, and ?vs= picks the game type (plan 27/39)', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    const app = fixture.componentInstance as any;
    app.openChallenge('cpu');
    expect(app.challenge()).toBeNull();
    app.leaveChallenge();
    await new Promise(r => setTimeout(r, 50));
    expect(app.challenge()).toBeUndefined();
    expect(app.screen()).toBe('matchup');
    expect(vsFromSearch('?vs=cpu')).toBe('cpu');
    expect(vsFromSearch('?vs=friend')).toBe('friend');
    expect(vsFromSearch('?vs=x')).toBeNull();
    expect(vsFromSearch('')).toBeNull();
  });

  it('a new player sees Pedro vs Ruth, the hint and the art note; Play an inning marks the visit seen (plan 36/39)', async () => {
    localStorage.removeItem('pr_seen');
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    await fixture.whenStable(); fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Pedro Martinez');
    expect(el.textContent).toContain('Tap Pitch to play this at-bat');
    expect(el.textContent).toContain('The drawings are generic ballplayers, not portraits.');
    (Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Play an inning') as HTMLButtonElement).click();
    expect(localStorage.getItem('pr_seen')).toBe('1');
  });

  it('a returning player gets a random pair, preferring one with art for both (plan 39)', async () => {
    const pairs = [
      { pitcher: { id: 'p1', name: 'No Art Pitcher', year: 1950, line: 'x' }, batter: { id: 'b1', name: 'No Art Batter', year: 1950, line: 'y' } },
      { pitcher: { id: 'p2', name: 'Art Pitcher', year: 1960, line: 'x' }, batter: { id: 'b2', name: 'Art Batter', year: 1961, line: 'y' } },
    ];
    const manifest = { cell: [1, 1], frames: 8, sheets: {}, cards: {}, tones: { p2: 'light', b2: 'dark' } };
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
      String(url).includes('/api/matchup/random') ? pairs : String(url).includes('art-manifest') ? manifest
      : String(url).includes('/api/matchup') ? matchup : String(url).includes('/api/card') ? report('bat', 'X', 1960) : []), { status: 200 })) as typeof fetch;
    try {
      const fixture = TestBed.createComponent(App);
      await new Promise(r => setTimeout(r, 30));
      const app = fixture.componentInstance as any;
      expect(app.pitcher().id).toBe('p2');   // names are refreshed from the (mocked) matchup afterward
      expect(app.batter().id).toBe('b2');
    } finally { globalThis.fetch = real; }
  });

  it('chooses pairs in order: both with art, else the first, else none (plan 39)', async () => {
    const { choosePair } = await import('./app');
    const pr = (a: string, b: string) => ({ pitcher: { id: a, name: a, year: 1, line: '' }, batter: { id: b, name: b, year: 1, line: '' } });
    const m = { tones: { a: 1, b: 1, c: 1 } } as never;
    expect(choosePair([pr('a', 'x'), pr('b', 'c')], m)?.pitcher.id).toBe('b');
    expect(choosePair([pr('a', 'x'), pr('y', 'z')], m)?.pitcher.id).toBe('a');
    expect(choosePair([pr('a', 'x')], null)?.pitcher.id).toBe('a');
    expect(choosePair([], m)).toBeNull();
    expect(choosePair(null, m)).toBeNull();
  });

  it('reads the visit source from utm_source or ref (plan 29)', () => {
    expect(sourceFromSearch('?utm_source=Facebook&utm_medium=social')).toBe('facebook');
    expect(sourceFromSearch('?ref=reddit-baseball')).toBe('reddit-baseball');
    expect(sourceFromSearch('?utm_source=<script>')).toBeNull();
    expect(sourceFromSearch('')).toBeNull();
  });
});
