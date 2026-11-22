import { TestBed } from '@angular/core/testing';
import { SeasonItem, seasonKind, startSeason } from './api';
import { App } from './app';
import { resetArtNoteVisit } from './art-note';

const row = (year: number, extra: Partial<SeasonItem> = {}): SeasonItem => ({ year, teams: 'AL', pa: 600, line: 'x', grade: 'A', isDefault: false, ...extra });

describe('Plan 76 C: best season default', () => {
  it('starts on the best season; an old API (no isBest) starts on the most played', () => {
    const list = [row(1920, { isBest: true }), row(1923, { isDefault: true })];
    expect(startSeason(list)!.year).toBe(1920);
    expect(seasonKind(list[0])).toBe('best');
    expect(seasonKind(list[1])).toBe('most');
    const old = [row(1920), row(1923, { isDefault: true })];
    expect(startSeason(old)!.year).toBe(1923);
    expect(seasonKind(old[1])).toBe('most');
    expect(seasonKind(old[0])).toBeNull();
  });

  it('a fallback best season is labeled most played', () => {
    const list = [row(1923, { isDefault: true, isBest: true, bestFallback: true }), row(1924)];
    expect(startSeason(list)!.year).toBe(1923);
    expect(seasonKind(list[0])).toBe('most');
  });

  describe('in the Duel picker', () => {
    beforeEach(async () => {
      localStorage.setItem('pr_seen', '1'); localStorage.setItem('pr_art_note', '1');
      resetArtNoteVisit();
      globalThis.fetch = (async (url: string) => new Response(JSON.stringify(
        String(url).includes('/seasons') ? [row(1920, { isBest: true }), row(1923, { isDefault: true, pa: 697 }), row(1935, { pa: 92 })] : []),
        { status: /\/api\/(matchup|card)/.test(String(url)) ? 404 : 200 })) as typeof fetch;   // no matchup in this test
      await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    });

    it('offers "Use 1920 (best season)" and badges both seasons', async () => {
      const fixture = TestBed.createComponent(App);
      const app = fixture.componentInstance as any;
      await new Promise(r => setTimeout(r, 0));
      app.openPicker('bat');
      await app.choosePlayer({ id: 'ruthb101', name: 'Babe Ruth', years: '1914-1935', bats: 'L', throws: 'L', hof: true });
      await new Promise(r => setTimeout(r, 0)); fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.quick')?.textContent?.trim()).toBe('Use 1920 (best season)');
      const badges = Array.from(el.querySelectorAll('.picker .list .badge')).map(b => b.textContent);
      expect(badges.sort()).toEqual(['Best season', 'Most played', 'Small sample']);
      expect(el.querySelector('.picker .list button.best strong')?.textContent).toBe('1920');
    });
  });
});
