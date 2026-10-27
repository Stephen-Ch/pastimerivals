import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Report } from './api';
import { ReportView } from './report';
import { BLANK_NOTE_TEXT } from './how-sim';

const rep: Report = { id: 'nobody01', name: 'Joe Nobody', role: 'bat', year: 1927, age: 24, height: null, weight: null, bats: 'R', throws: 'R',
  position: 'RF', places: ['Boston, AL'], line: 'a line', grade: 'A', era: '1920-1945', hof: false,
  ratios: [{ label: 'Hits', timesLeague: 1.1 }], bio: '' };

describe('plan 52: blank-paper cards, no drawn figure', () => {
  function card(inputs: Record<string, unknown>) {
    const f = TestBed.createComponent(ReportView);
    f.componentRef.setInput('report', rep);
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return f;
  }
  const text = (el: HTMLElement) => el.textContent ?? '';

  it('report card with no card shows a blank paper frame and never an svg', () => {
    const el = card({ card: null }).nativeElement as HTMLElement;
    expect(el.querySelector('.art.blank')).not.toBeNull();
    expect(el.querySelector('svg')).toBeNull();
    expect(text(el)).not.toContain('Wrong look?');
    expect(text(el)).not.toContain('Why no face?');
  });

  it('a blank-paper card shows "Why no face?" instead of "Wrong look?" and emits on tap', () => {
    const f = card({ card: '/art/x.webp', line: true });
    const el = f.nativeElement as HTMLElement;
    let asked = 0;
    f.componentInstance.whyBlank.subscribe(() => asked++);
    expect(text(el)).toContain('Why no face?');
    expect(text(el)).not.toContain('Wrong look?');
    (Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Why no face?') as HTMLButtonElement).click();
    expect(asked).toBe(1);
    expect(el.querySelector('img')?.getAttribute('alt')).toContain('face not shown');
  });

  it('a toned card keeps "Wrong look?"', () => {
    const el = card({ card: '/art/x.webp', line: false }).nativeElement as HTMLElement;
    expect(text(el)).toContain('Wrong look? Tell us');
    expect(text(el)).not.toContain('Why no face?');
  });

  it('an image that fails to load turns into the blank frame', () => {
    const f = card({ card: '/art/missing.webp', line: true });
    const el = f.nativeElement as HTMLElement;
    el.querySelector('img')!.dispatchEvent(new Event('error'));
    f.detectChanges();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('.art.blank')).not.toBeNull();
  });
});

describe('plan 52: app wiring', () => {
  const probs = { k: 0.3, bb: 0.12, hbp: 0.01, single: 0.12, double: 0.04, triple: 0.005, hr: 0.045, oip: 0.36 };
  const matchup = {
    batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1927, hand: 'L' },
    pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 1999, hand: 'R' },
    sameHand: false, probabilities: probs, neutral: 'x', engineVersion: '0.1.0',
    steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
  };
  const report = (role: 'bat' | 'pit', id: string, year: number) => ({ ...rep, id, name: id, role, year, era: year < 1946 ? '1920-1945' : '1990-2025' });
  let events: { name: string; source?: string }[] = [];
  let manifest: (() => Promise<Response>) | null = null;

  beforeEach(async () => {
    history.replaceState(null, '', '/');   // other specs may leave a /c/ route behind
    localStorage.removeItem('pr_seen');   // first visit: Pedro vs Ruth load at once (no random opener)
    localStorage.setItem('pr_art_note', '1');
    events = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/events')) { events.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
      if (u.includes('art-manifest') && manifest) return manifest();
      return new Response(JSON.stringify(
        u.includes('/api/matchup') ? matchup
        : u.includes('role=pit') && u.includes('/api/card') ? report('pit', 'martp001', 1999)
        : u.includes('/api/card') ? report('bat', 'ruthb101', 1927) : []), { status: 200 });
    }) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  afterEach(() => { manifest = null; });

  async function start() {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as any;
    // wait (up to 2 s) until both reports are in, then one more round of change detection
    for (let i = 0; i < 100 && !(app.pitcherReport() && app.batterReport()); i++) { await new Promise(r => setTimeout(r, 20)); fixture.detectChanges(); }
    await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    return { fixture, app, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the shimmer while the manifest is still loading', async () => {
    manifest = () => new Promise<Response>(() => undefined);   // never settles
    const { el, app } = await start();
    expect(el.querySelectorAll('.pcard .skeleton').length, dbg(app)).toBe(2);
    expect(el.querySelectorAll('.pcard svg').length).toBe(0);
  });

  it('a failed manifest gives static blank frames and one art_fallback "missing" per pair', async () => {
    const { el, app, fixture } = await start();
    expect(el.querySelectorAll('.pcard .pblank').length, dbg(app)).toBe(2);
    expect(el.querySelector('.pcard .pblank.skeleton')).toBeNull();
    await app.load(); fixture.detectChanges(); await fixture.whenStable();
    expect(events.filter(e => e.name === 'art_fallback')).toEqual([{ name: 'art_fallback', session: expect.any(String), source: 'missing' }]);
  });

  it('"Why no face?" closes the card, then opens its own note; a normal close afterwards does not', async () => {
    const { app } = await start();
    const back = document.createElement('button'); document.body.appendChild(back);
    app.returnFocus = back;
    app.whyBlank();   // the card is not open in this test, so this runs the close handler itself
    expect(app.info()).toBe('blank');
    expect(BLANK_NOTE_TEXT).toContain('race or skin color');
    expect(events.some(e => e.name === 'art_blank_why')).toBe(true);
    app.closeInfo();
    await Promise.resolve();
    expect(document.activeElement).toBe(back);
    app.onDialogClosed();   // a later ordinary close
    expect(app.info()).toBeNull();
    back.remove();
  });

  it('a blank-note request never replaces a note that is already open', async () => {
    const { app } = await start();
    let ran = 0;
    app.openInfo('artIntro', () => ran++);
    app.openInfo('blank');
    expect(app.info()).toBe('artIntro');
    app.closeInfo();
    expect(ran).toBe(1);
  });
});


function dbg(app: any) { return JSON.stringify({ p: app.pitcher(), b: app.batter(), pr: !!app.pitcherReport(), err: app.error(), st: app.manifestState(), seen: localStorage.getItem('pr_seen'), ch: app.challenge?.(), screen: app.screen?.(), html: document.body.innerHTML.length, cards: document.querySelectorAll(".pcard").length, text: (document.body.textContent||"").slice(0,200) }); }
