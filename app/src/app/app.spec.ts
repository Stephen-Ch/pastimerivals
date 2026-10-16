import { TestBed } from '@angular/core/testing';
import { App } from './app';

const probs = { k: 0.3, bb: 0.12, hbp: 0.01, single: 0.12, double: 0.04, triple: 0.005, hr: 0.045, oip: 0.36 };
const matchup = {
  batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1927, hand: 'L' },
  pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 1999, hand: 'R' },
  sameHand: false, probabilities: probs, neutral: '1990-2019 MLB average', engineVersion: '0.1.0',
  steps: Object.entries(probs).map(([k, v]) => ({ outcome: k, batterObserved: v, batterLeague: v, pitcherObserved: v, pitcherLeague: v, neutral: v, final: v })),
};

describe('App', () => {
  beforeEach(async () => {
    globalThis.fetch = (async (url: string) =>
      new Response(JSON.stringify(String(url).includes('/api/matchup') ? matchup : []), { status: 200 })) as typeof fetch;
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the featured matchup with odds and the Retrosheet credit', async () => {
    const fixture = TestBed.createComponent(App);
    await new Promise(r => setTimeout(r, 0));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Pedro Martinez');
    expect(el.textContent).toContain('Babe Ruth');
    expect(el.textContent).toContain('Home run');
    expect(el.textContent).toContain('4.5%');
    expect(el.textContent).toContain('Retrosheet');
  });
});
