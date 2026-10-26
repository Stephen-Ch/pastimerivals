import { TestBed } from '@angular/core/testing';
import { artNoteDue, markArtNoteShown, resetArtNoteVisit } from './art-note';
import { feedbackDue, resetFeedbackVisit } from './feedback';
import { ART_NOTE_TEXT, HowSim } from './how-sim';

describe('Plan 51 art note', () => {
  beforeEach(() => {
    localStorage.clear();
    resetArtNoteVisit();
    resetFeedbackVisit();
  });

  it('is due on fresh storage, then not due after marking shown', () => {
    expect(artNoteDue()).toBe(true);
    markArtNoteShown();
    expect(artNoteDue()).toBe(false);
  });

  it('private mode storage errors still show only once per visit', () => {
    const real = globalThis.localStorage;
    const throwing = {
      get length() { return 0; },
      clear() { throw new Error('private'); },
      getItem() { throw new Error('private'); },
      key() { return null; },
      removeItem() { throw new Error('private'); },
      setItem() { throw new Error('private'); },
    } as Storage;
    Object.defineProperty(globalThis, 'localStorage', { value: throwing, configurable: true });
    try {
      expect(artNoteDue()).toBe(true);
      markArtNoteShown();
      expect(artNoteDue()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
    }
  });

  it('marks pr_seen when shown', () => {
    markArtNoteShown();
    expect(localStorage.getItem('pr_seen')).toBe('1');
  });

  it('suppresses feedback the same visit after the art note shows', () => {
    markArtNoteShown();
    expect(feedbackDue('g1', 1, 1_800_000_000_000)).toBe(false);
  });

  it('renders the title, paragraph, Got it, and More buttons', async () => {
    await TestBed.configureTestingModule({ imports: [HowSim] }).compileComponents();
    const fixture = TestBed.createComponent(HowSim);
    fixture.componentRef.setInput('kind', 'artIntro');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Why don\'t the players look like the real ones?');
    expect(el.textContent).toContain(ART_NOTE_TEXT);
    expect(el.textContent).toContain('Got it');
    expect(el.textContent).toContain('More about the art');
  });
});
