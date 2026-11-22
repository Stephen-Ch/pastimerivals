import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { ArtNoteSeen, artNoteDue, markArtNoteShown, resetArtNoteVisit } from './art-note';
import { feedbackDue, resetFeedbackVisit } from './feedback';

/** Plan 76 A: jsdom has no IntersectionObserver, so tests drive a small stub. */
class FakeIO {
  static all: FakeIO[] = [];
  els: Element[] = [];
  constructor(private readonly cb: (e: Partial<IntersectionObserverEntry>[]) => void) { FakeIO.all.push(this); }
  observe(el: Element) { this.els.push(el); }
  disconnect() { this.els = []; }
  unobserve() { /* unused */ }
  fire(el: Element, on: boolean) { if (this.els.includes(el)) this.cb([{ target: el, isIntersecting: on, intersectionRatio: on ? 1 : 0 }]); }
  static show(el: Element, on = true) { for (const io of FakeIO.all) io.fire(el, on); }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

@Component({
  imports: [ArtNoteSeen],
  template: `@if (on()) { <p class="n" (prArtNoteSeen)="n = n + 1" [prArtNotePaused]="paused()">note</p> }`,
})
class Host { on = signal(true); paused = signal(false); n = 0; }

describe('Plan 76 A: the art note line, no pop-up', () => {
  const realIO = (globalThis as any).IntersectionObserver;
  beforeEach(() => {
    localStorage.clear();
    resetArtNoteVisit(); resetFeedbackVisit();
    FakeIO.all = [];
    (globalThis as any).IntersectionObserver = FakeIO;
  });
  afterEach(() => { (globalThis as any).IntersectionObserver = realIO; history.replaceState(null, '', '/'); });

  it('counts as seen only after 1 s on screen without a break', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const f = TestBed.createComponent(Host); f.detectChanges();
    const el = f.nativeElement.querySelector('.n') as HTMLElement;
    FakeIO.show(el); await wait(600); FakeIO.show(el, false); await wait(600);
    expect(f.componentInstance.n).toBe(0);   // broken before 1 s
    FakeIO.show(el); await wait(1100);
    expect(f.componentInstance.n).toBe(1);
    FakeIO.show(el); await wait(1100);
    expect(f.componentInstance.n).toBe(1);   // once
  });

  it('a removed line never counts, and no IntersectionObserver means it never counts', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const f = TestBed.createComponent(Host); f.detectChanges();
    const el = f.nativeElement.querySelector('.n') as HTMLElement;
    FakeIO.show(el); await wait(300);
    f.componentInstance.on.set(false); f.detectChanges();
    await wait(1000);
    expect(f.componentInstance.n).toBe(0);
    (globalThis as any).IntersectionObserver = undefined;
    f.componentInstance.on.set(true); f.detectChanges();
    await wait(1100);
    expect(f.componentInstance.n).toBe(0);
  });

  it('does not count while covered by a sheet; the 1 s restarts when uncovered', async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const f = TestBed.createComponent(Host); f.detectChanges();
    const el = f.nativeElement.querySelector('.n') as HTMLElement;
    FakeIO.show(el); await wait(600);
    f.componentInstance.paused.set(true); f.detectChanges(); await wait(1200);
    expect(f.componentInstance.n).toBe(0);
    f.componentInstance.paused.set(false); f.detectChanges(); await wait(600);
    expect(f.componentInstance.n).toBe(0);   // restarted, not resumed
    await wait(600);
    expect(f.componentInstance.n).toBe(1);
  });

  it('no feedback ask on the visit the note was marked seen', () => {
    markArtNoteShown();
    expect(feedbackDue('g2', 1, 1_800_000_000_000)).toBe(false);
  });

  describe('in the app', () => {
    const probs = { k: 0.3, bb: 0.12, hbp: 0.01, single: 0.12, double: 0.04, triple: 0.005, hr: 0.045, oip: 0.36 };
    const matchup = {
      batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1927, hand: 'L' }, pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 1999, hand: 'R' },
      sameHand: false, probabilities: probs, neutral: 'x', engineVersion: '0.1.0',
      steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
    };
    const report = (role: 'bat' | 'pit', id: string, year: number) => ({
      id, name: id, role, year, age: 30, height: "6' 2\"", weight: '200 lb', bats: 'L', throws: 'R', position: role === 'pit' ? 'P' : 'RF',
      places: ['x'], line: 'a line', grade: 'A', era: '1990-2025', hof: true, ratios: [],
    });
    let calls: string[] = [];
    let events: { name: string; source?: string }[] = [];
    beforeEach(async () => {
      calls = []; events = [];
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const u = String(url); calls.push(u);
        if (u.includes('/api/events')) { events.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
        if (u.includes('/api/pitch')) return new Response(JSON.stringify({ outcome: 'single', seed: 'abc', engineVersion: '0.1.0' }), { status: 200 });
        return new Response(JSON.stringify(
          u.includes('/api/matchup?') ? matchup
          : u.includes('role=pit') && u.includes('/api/card') ? report('pit', 'martp001', 1999)
          : u.includes('/api/card') ? report('bat', 'ruthb101', 1927) : []), { status: 200 });
      }) as typeof fetch;
      await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    });
    const settle = async (f: any) => { for (let i = 0; i < 20; i++) { await wait(10); f.detectChanges(); } await f.whenStable(); f.detectChanges(); };

    it('first visit: no sheet, the line shows, intro hidden; seen after 1 s: pr_art_note + pr_seen and one art_note_shown (home)', async () => {
      const f = TestBed.createComponent(App); await settle(f);
      const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
      expect(app.info()).toBeNull();
      expect(el.querySelector('[role=dialog]')).toBeNull();
      const line = el.querySelector('.art-line') as HTMLElement;
      expect(line).not.toBeNull();
      expect(el.querySelector('.pbp-intro')).toBeNull();
      FakeIO.show(line); await wait(1100); f.detectChanges();
      expect(localStorage.getItem('pr_art_note')).toBe('1');
      expect(localStorage.getItem('pr_seen')).toBe('1');
      expect(artNoteDue()).toBe(false);
      expect(el.querySelector('.art-line')).not.toBeNull();   // stays on this screen, no 1 s flash
      const shown = events.filter(e => e.name === 'art_note_shown');
      expect(shown).toEqual([{ name: 'art_note_shown', session: expect.any(String), source: 'home' }] as any);
      // The short form for short landscape was the same visit: never a second event.
      const short = el.querySelector('.art-short') as HTMLElement;
      FakeIO.show(short); await wait(1100);
      expect(events.filter(e => e.name === 'art_note_shown').length).toBe(1);
    });

    it('the picker open over the line stops it counting', async () => {
      const f = TestBed.createComponent(App); await settle(f);
      const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
      app.openPicker('bat'); await settle(f);
      FakeIO.show(el.querySelector('.art-line') as HTMLElement); await wait(1200);
      expect(events.some(e => e.name === 'art_note_shown')).toBe(false);
      expect(localStorage.getItem('pr_art_note')).toBeNull();
    });

    it('a matchup-page link arrives as page', async () => {
      history.replaceState(null, '', '/?b=ruthb101&by=1927&p=martp001&py=1999');
      const f = TestBed.createComponent(App); await settle(f);
      FakeIO.show((f.nativeElement as HTMLElement).querySelector('.art-line') as HTMLElement); await wait(1100);
      expect(events.filter(e => e.name === 'art_note_shown').map(e => e.source)).toEqual(['page']);
    });

    it('About the art from the line and from the standing link send art_note_more line / link and open the art sheet', async () => {
      localStorage.setItem('pr_seen', '1');
      const f = TestBed.createComponent(App); await settle(f);
      const el = f.nativeElement as HTMLElement, app = f.componentInstance as any;
      (el.querySelector('.art-line .inline-link') as HTMLButtonElement).click(); f.detectChanges();
      expect(app.info()).toBe('art');
      app.closeInfo(); f.detectChanges();
      (el.querySelector('.about-art-side') as HTMLButtonElement).click(); f.detectChanges();
      expect(app.info()).toBe('art');
      await wait(20);
      expect(events.filter(e => e.name === 'art_note_more').map(e => e.source)).toEqual(['line', 'link']);
    });

    it('a returning visitor who has seen the note gets no line and no event', async () => {
      localStorage.setItem('pr_seen', '1'); localStorage.setItem('pr_art_note', '1');
      calls = [];
      const f = TestBed.createComponent(App); await settle(f);
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.art-line')).toBeNull();
      expect(el.querySelector('.art-short')).toBeNull();
      expect(el.querySelector('.about-art')).not.toBeNull();
    });

    it('shared link: pitches at once with no sheet, sets pr_seen; the flash does not count; back on the matchup the line counts (share)', async () => {
      history.replaceState(null, '', '/?b=ruthb101&by=1927&p=martp001&py=1999&s=abc&v=x&d=1');
      const f = TestBed.createComponent(App);
      const app = f.componentInstance as any;
      for (let i = 0; i < 100 && !calls.some(u => u.includes('/api/pitch')); i++) { await wait(10); f.detectChanges(); }
      expect(calls.some(u => u.includes('/api/pitch'))).toBe(true);
      expect(app.info()).toBeNull();
      await settle(f);
      expect(localStorage.getItem('pr_seen')).toBe('1');
      expect(localStorage.getItem('pr_art_note')).toBeNull();
      expect(events.some(e => e.name === 'art_note_shown')).toBe(false);
      app.goHome(); f.detectChanges(); await settle(f);
      const line = (f.nativeElement as HTMLElement).querySelector('.art-line') as HTMLElement;
      expect(line).not.toBeNull();
      FakeIO.show(line); await wait(1100);
      expect(events.filter(e => e.name === 'art_note_shown').map(e => e.source)).toEqual(['share']);
    });
  });
});
