import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { resetArtNoteVisit } from './art-note';

/** Plan 76 D: vi.mock of relative imports is not possible in this builder, so Image is a stub the test loads by hand. */
class FakeImage {
  static pending = new Map<string, FakeImage[]>();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(v: string) { this._src = v; FakeImage.pending.set(v, [...(FakeImage.pending.get(v) ?? []), this]); }
  decode() { return Promise.resolve(); }
  static load(url: string) { for (const i of FakeImage.pending.get(url) ?? []) i.onload?.(); FakeImage.pending.delete(url); }
}

const ERAS = ['1901-1919', '1920-1945', '1946-1969', '1970-1989', '1990-2025'];
const manifest = {
  cell: [1, 1], frames: 8, sheets: {}, tones: { martp001: 'light', ruthb101: 'light', aaroh101: 'darkbrown', p2: 'light', b2: 'light' },
  cards: Object.fromEntries(ERAS.flatMap(e => ['pitcher', 'batter'].flatMap(r => ['light', 'darkbrown', 'line'].flatMap(t => ['a', 'b'].map(v => [`${r}/${e}/${t}/${v}`, `/art/card-${r}-${e}-${t}-${v}.webp`]))))),
};
const probs = { k: 0.3, bb: 0.12, hbp: 0.01, single: 0.12, double: 0.04, triple: 0.005, hr: 0.045, oip: 0.36 };
const matchup = {
  batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1927, hand: 'L' }, pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 1999, hand: 'R' },
  sameHand: false, probabilities: probs, neutral: 'x', engineVersion: '0.1.0',
  steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
};
const report = (role: 'bat' | 'pit', id: string, year: number) => ({
  id, name: id, role, year, age: 30, height: "6' 2\"", weight: '200 lb', bats: 'R', throws: 'R', position: role === 'pit' ? 'P' : 'RF',
  places: ['x'], line: 'a line', grade: 'A', era: '1990-2025', hof: true, ratios: [],
});
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Plan 76 D: no empty card frames', () => {
  let randomGate: Promise<void> | null = null;
  beforeEach(async () => {
    FakeImage.pending.clear();
    vi.stubGlobal('Image', FakeImage);
    localStorage.setItem('pr_art_note', '1');
    localStorage.removeItem('pr_seen');   // first visit: Pedro vs Ruth load at once
    resetArtNoteVisit();
    randomGate = null;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('art-manifest')) return new Response(JSON.stringify(manifest), { status: 200 });
      if (u.includes('/api/matchup/random')) {
        if (randomGate) await randomGate;
        return new Response(JSON.stringify([{ pitcher: { id: 'p2', name: 'Art Pitcher', year: 1960, line: 'x' }, batter: { id: 'b2', name: 'Art Batter', year: 1961, line: 'y' } }]), { status: 200 });
      }
      const m = /[?&]id=([^&]+)/.exec(u)?.[1], y = Number(/[?&]year=(\d+)/.exec(u)?.[1] ?? 1999);
      return new Response(JSON.stringify(
        u.includes('/api/matchup?') ? matchup
        : u.includes('/api/card') ? report(u.includes('role=pit') ? 'pit' : 'bat', m ?? 'x', y)
        : []), { status: 200 });
    }) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  afterEach(() => vi.unstubAllGlobals());

  const frames = (el: HTMLElement) => Array.from(el.querySelectorAll('.pcard .frame')).map(f =>
    f.querySelector('img') ? 'img' : f.querySelector('.skeleton') ? 'skeleton' : f.querySelector('.pempty') ? 'empty' : f.querySelector('.pblank') ? 'blank' : '?');
  const settle = async (f: any) => { for (let i = 0; i < 10; i++) { await wait(5); f.detectChanges(); } };

  it('each card shows a placeholder until its own picture loads', async () => {
    const f = TestBed.createComponent(App); await settle(f);
    const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
    const a = app.pair();
    expect(a).not.toBeNull();
    expect(frames(el)).toEqual(['skeleton', 'skeleton']);
    FakeImage.load(a.bat.card); await settle(f);
    expect(frames(el)).toEqual(['skeleton', 'img']);   // pitcher first, batter second
    FakeImage.load(a.pit.card); await settle(f);
    expect(frames(el)).toEqual(['img', 'img']);
  });

  it('after 1.5 s the img shows anyway (the file may still arrive)', async () => {
    const f = TestBed.createComponent(App); await settle(f);
    const el = f.nativeElement as HTMLElement;
    expect(frames(el)).toEqual(['skeleton', 'skeleton']);
    await wait(1600); f.detectChanges();
    expect(frames(el)).toEqual(['img', 'img']);
  });

  it('a new season with the same picture shows no placeholder; changing one card never touches the other', async () => {
    const f = TestBed.createComponent(App); await settle(f);
    const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
    const a = app.pair();
    FakeImage.load(a.pit.card); FakeImage.load(a.bat.card); await settle(f);
    expect(frames(el)).toEqual(['img', 'img']);
    // Same era, same tone: the same card picture.
    app.batter.set({ id: 'ruthb101', name: 'Babe Ruth', year: 1923, line: '' }); await app.load(); await settle(f);
    expect(app.pair().bat.card).toBe(a.bat.card);
    expect(frames(el)).toEqual(['img', 'img']);
    // A new picture for the batter only: his card waits, the pitcher's stays.
    app.batter.set({ id: 'aaroh101', name: 'Hank Aaron', year: 1971, line: '' }); await app.load(); await settle(f);
    expect(app.pair().bat.card).not.toBe(a.bat.card);
    expect(frames(el)).toEqual(['img', 'skeleton']);
  });

  describe('random opener (returning visitor)', () => {
    beforeEach(() => localStorage.setItem('pr_seen', '1'));

    it('shows placeholders (busy, "Loading players"), never "Pick a", while it waits', async () => {
      let open!: () => void;
      randomGate = new Promise(r => { open = r; });
      const f = TestBed.createComponent(App); await settle(f);
      const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
      expect(frames(el)).toEqual(['skeleton', 'skeleton']);
      const btns = Array.from(el.querySelectorAll('.pcard'));
      expect(btns.map(b => b.getAttribute('aria-busy'))).toEqual(['true', 'true']);
      expect(btns.map(b => b.getAttribute('aria-label'))).toEqual(['Loading players', 'Loading players']);
      expect(el.textContent).not.toContain('Pick a');
      open(); await settle(f); await wait(20); f.detectChanges();
      expect(app.pitcher().id).toBe('p2');
      expect(app.batter().id).toBe('b2');
      expect(btns.map(b => b.getAttribute('aria-busy'))).toEqual([null, null]);
    });

    it('at 3 s with no reply: Pedro vs Ruth, and the late reply is ignored', async () => {
      let open!: () => void;
      randomGate = new Promise(r => { open = r; });
      const f = TestBed.createComponent(App); await settle(f);
      const app = f.componentInstance as any;
      await wait(3100); await settle(f);
      expect(app.pitcher().id).toBe('martp001');
      expect(app.batter().id).toBe('ruthb101');
      open(); await wait(50); await settle(f);
      expect(app.pitcher().id).toBe('martp001');
      expect(app.batter().id).toBe('ruthb101');
    });

    it('a side the player picks while waiting is kept; the opener fills only the other side', async () => {
      let open!: () => void;
      randomGate = new Promise(r => { open = r; });
      const f = TestBed.createComponent(App); await settle(f);
      const app = f.componentInstance as any;
      app.pitcher.set({ id: 'koufs101', name: 'Sandy Koufax', year: 1965, line: '' });
      open(); await wait(30); await settle(f);
      expect(app.pitcher().id).toBe('koufs101');
      expect(app.batter().id).toBe('b2');
    });
  });
});
