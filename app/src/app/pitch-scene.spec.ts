import { TestBed } from '@angular/core/testing';
import { leadMotion, motionFor, PitchScene } from './pitch-scene';

describe('pitch scene', () => {
  it('maps every outcome to the planned motion', () => {
    expect(motionFor('k')).toBe('miss');
    expect(motionFor('k', 'called')).toBe('look');
    expect(motionFor('bb')).toBe('take');
    expect(motionFor('hbp')).toBe('hbp');
    expect(motionFor('oip')).toBe('out');
    for (const o of ['single', 'double', 'triple', 'hr'] as const) expect(motionFor(o)).toBe('hit');
    expect(leadMotion('ball')).toBe('take');
    expect(leadMotion('foul')).toBe('foul');
  });

  it('emits done only once, even when Skip is tapped twice', async () => {
    const f = TestBed.createComponent(PitchScene);
    f.componentRef.setInput('era', '1990-2025');
    f.componentRef.setInput('outcome', 'hr');
    f.componentRef.setInput('seed', 'x');
    let n = 0;
    f.componentInstance.done.subscribe(() => n++);
    await f.whenStable();
    const skip = (f.nativeElement as HTMLElement).querySelector('button.skip') as HTMLButtonElement;
    skip.click(); skip.click();
    f.componentInstance.finish();
    expect(n).toBe(1);
    expect((f.nativeElement as HTMLElement).querySelector('.scene button')).toBeNull();   // no nested buttons
  });

  it('goes straight to the result with reduced motion', async () => {
    const orig = globalThis.matchMedia;
    globalThis.matchMedia = ((q: string) => ({ matches: q.includes('reduce') })) as unknown as typeof matchMedia;
    try {
      const f = TestBed.createComponent(PitchScene);
      f.componentRef.setInput('era', '1990-2025');
      f.componentRef.setInput('outcome', 'k');
      let n = 0;
      f.componentInstance.done.subscribe(() => n++);
      await new Promise(r => setTimeout(r, 5));
      expect(n).toBe(1);
    } finally { globalThis.matchMedia = orig; }
  });
});
