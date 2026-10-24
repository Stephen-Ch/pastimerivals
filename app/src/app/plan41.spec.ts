import { TestBed } from '@angular/core/testing';
import { Report } from './api';
import { ReportView } from './report';

const base: Report = { id: 'gibsj101', name: 'Josh Gibson', role: 'bat', year: 1936, age: 24, height: null, weight: null, bats: 'R', throws: 'R',
  position: 'C', places: ['Pittsburgh, Negro National League'], line: '67 H, 20 HR, 32 BB in 202 PA', grade: 'C', era: '1920-1945', hof: true,
  ratios: [{ label: 'Hits', timesLeague: 1.3 }, { label: 'Home runs', timesLeague: 3.8 }, { label: 'Walks', timesLeague: 1.6 }], bio: '' };

describe('plan 41: Negro Leagues on the scouting report', () => {
  async function back(r: Report) {
    const f = TestBed.createComponent(ReportView);
    f.componentRef.setInput('report', r);
    f.detectChanges();
    ((f.nativeElement as HTMLElement).querySelector('button.flip') as HTMLButtonElement).click();
    f.detectChanges();
    await f.whenStable();
    return (f.nativeElement as HTMLElement).textContent ?? '';
  }
  it('shows the league name and the incomplete-stats note', async () => {
    const t = await back({ ...base, note: 'Negro Leagues stats from surviving box scores (incomplete).' });
    expect(t).toContain('Negro National League');
    expect(t).toContain('surviving box scores');
    expect(t).not.toContain('Strikeouts');
  });
  it('shows no note for a major-league season', async () => {
    const t = await back({ ...base, places: ['New York, AL'], note: null });
    expect(t).not.toContain('surviving box scores');
  });
});
