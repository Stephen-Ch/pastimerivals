import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { resetArtNoteVisit } from './art-note';

const legends = [
  { id: 'ruthb101', name: 'Babe Ruth', years: '1914-1935', bats: 'L', throws: 'L', hof: true, year: 1927, line: '192 H' },
  { id: 'bondb001', name: 'Barry Bonds', years: '1986-2007', bats: 'L', throws: 'L', hof: false, year: 2001, line: '156 H' },
];

describe('Plan 76 B: the legends shelf', () => {
  let calls: string[] = [];
  let events: { name: string; source?: string }[] = [];
  let failFeatured = false;
  beforeEach(async () => {
    localStorage.setItem('pr_seen', '1'); localStorage.setItem('pr_art_note', '1');
    resetArtNoteVisit();
    calls = []; events = []; failFeatured = false;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url); calls.push(u);
      if (u.includes('/api/events')) { events.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
      if (u.includes('/api/players/featured')) return failFeatured ? new Response('no', { status: 500 }) : new Response(JSON.stringify(legends), { status: 200 });
      if (u.includes('/api/matchup') || u.includes('/api/card')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  const settle = async (f: any) => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 5)); f.detectChanges(); } };

  it('shows "Famous seasons" only in the search step with an empty box; typing hides it; fetched once per role', async () => {
    const f = TestBed.createComponent(App); await settle(f);
    const app = f.componentInstance as any, el = f.nativeElement as HTMLElement;
    app.openPicker('bat'); await settle(f);
    expect(el.querySelector('.legends-h')?.textContent).toBe('Famous seasons');
    const rows = Array.from(el.querySelectorAll('.legends button')).map(b => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Babe Ruth 1927 · Hall of Fame›', 'Barry Bonds 2001›']);
    app.onQuery('Ru'); f.detectChanges();
    expect(el.querySelector('.legends')).toBeNull();
    app.onQuery(''); f.detectChanges();
    expect(el.querySelector('.legends')).not.toBeNull();
    app.closePicker(); app.openPicker('bat'); await settle(f);
    expect(calls.filter(u => u.includes('/api/players/featured?role=bat')).length).toBe(1);
    app.choosePlayer({ id: 'x', name: 'X', years: '1', bats: 'R', throws: 'R', hof: false }); await settle(f);
    expect(el.querySelector('.legends')).toBeNull();   // the seasons step
  });

  it('a legend tap picks that season at once: one load, flip asked for, picker closed, featured_pick sent', async () => {
    const f = TestBed.createComponent(App); await settle(f);
    const app = f.componentInstance as any, el = f.nativeElement as HTMLElement;
    app.openPicker('bat'); await settle(f);
    let loads = 0; const real = app.load.bind(app); app.load = () => { loads++; return real(); };
    let flipWant: unknown = 'unset';
    const before = calls.length;
    (el.querySelector('.legends button') as HTMLButtonElement).click();
    flipWant = app.flipWant;
    expect(app.batter()).toEqual({ id: 'ruthb101', name: 'Babe Ruth', year: 1927, line: '192 H' });
    expect(loads).toBe(1);
    expect(flipWant === 'unset').toBe(false);
    await settle(f);
    expect(app.picking()).toBeNull();   // history popped (popstate closes the picker)
    expect(calls.slice(before).some(u => u.includes('/seasons'))).toBe(false);
    expect(events.filter(e => e.name === 'featured_pick').map(e => e.source)).toEqual(['ruthb101-1927']);
  });

  it('an error shows nothing', async () => {
    failFeatured = true;
    const f = TestBed.createComponent(App); await settle(f);
    const app = f.componentInstance as any, el = f.nativeElement as HTMLElement;
    app.openPicker('pit'); await settle(f);
    expect(el.querySelector('.legends-h')).toBeNull();
    expect(el.querySelector('.picker')).not.toBeNull();
  });
});
