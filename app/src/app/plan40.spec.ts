import { TestBed } from '@angular/core/testing';
import { countFor } from './logic';
import { PitchScene, WINDUP_S, windupTimeline } from './pitch-scene';
import { sideLine } from './side-line';

describe('plan 40', () => {
  it('B: says which side of the plate the batter stands on, from listed bats and the pitcher arm', () => {
    expect(sideLine('R', 'L')).toBe('Bats right.');
    expect(sideLine('L', 'R')).toBe('Bats left: other side of the plate.');
    expect(sideLine('B', 'R')).toBe('Switch hitter: bats left vs a righty.');
    expect(sideLine('S', 'L')).toBe('Switch hitter: bats right vs a lefty.');
    expect(sideLine('B', '')).toBeNull();
    expect(sideLine(null, 'R')).toBeNull();
    expect(sideLine('', 'R')).toBeNull();
    for (const t of ['Bats right.', 'Bats left: other side of the plate.', 'Switch hitter: bats left vs a righty.', 'Switch hitter: bats right vs a lefty.'])
      expect(t.length).toBeLessThanOrEqual(44);
  });

  it('A: the pitcher winds up before every pitch, and the at-bat lasts the sum of the trimmed timelines', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const seed = 'p40-seed', outcome = 'single' as const;
      const lead = countFor(outcome, seed, '3').leadUp.length;
      expect(lead).toBeGreaterThan(0);
      const f = TestBed.createComponent(PitchScene);
      const frames = Array.from({ length: 8 }, () => ({}));
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', outcome);
      f.componentRef.setInput('seed', seed);
      f.componentRef.setInput('deco', '3');
      f.componentRef.setInput('side', { sheet: '/s.webp', frames, lineArt: false });
      f.componentRef.setInput('windup', { sheet: '/p.webp', mirror: false });
      let n = 0;
      f.componentInstance.done.subscribe(() => n++);
      f.detectChanges();
      const leadMs = (windupTimeline(false).end + WINDUP_S) * 1000 + 60;
      const total = lead * leadMs + (windupTimeline(true).end + WINDUP_S) * 1000;
      await vi.advanceTimersByTimeAsync(leadMs + 50);          // into pitch 2's windup
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('.windup')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(total - (leadMs + 50) - 30);
      expect(n).toBe(0);
      await vi.advanceTimersByTimeAsync(60);
      expect(n).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('A: no windup without the batter art (both or neither)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      const f = TestBed.createComponent(PitchScene);
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'single');
      f.componentRef.setInput('seed', 'p40-seed');
      f.componentRef.setInput('windup', { sheet: '/p.webp', mirror: false });
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(100);
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('.windup')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
