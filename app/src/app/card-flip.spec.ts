import { vi } from 'vitest';
import { CardFlip, FLIP_HALF, FLIP_HOLD_MAX, flipWanted } from './card-flip';

const OLD = { card: '/a.webp', mirror: false };
const FAKE = { toFake: ['setTimeout', 'clearTimeout'] as ('setTimeout' | 'clearTimeout')[] };

describe('plan 73 Part D: card flip', () => {
  it('only when the card picture changes', () => {
    expect(flipWanted(OLD, '/b.webp')).toBe(true);
    expect(flipWanted(OLD, '/a.webp')).toBe(false);
    expect(flipWanted(null, '/b.webp')).toBe(false);
    expect(flipWanted(OLD, null)).toBe(false);
  });

  it('out, then in at the middle when the picture loaded; clears after', async () => {
    vi.useFakeTimers(FAKE);
    try {
      const f = new CardFlip(async () => true, () => false);
      expect(f.start('bat', OLD, '/b.webp')).toBe(true);
      expect(f.state()?.phase).toBe('out');
      await vi.advanceTimersByTimeAsync(FLIP_HALF);
      expect(f.state()?.phase).toBe('in');
      await vi.advanceTimersByTimeAsync(FLIP_HALF);
      expect(f.state()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('no flip for the same picture or with reduced motion', () => {
    expect(new CardFlip(async () => true, () => false).start('pit', OLD, '/a.webp')).toBe(false);
    const r = new CardFlip(async () => true, () => true);
    expect(r.start('pit', OLD, '/b.webp')).toBe(false);
    expect(r.state()).toBeNull();
  });

  it('holds at the middle until the picture loads; opens on load', async () => {
    vi.useFakeTimers(FAKE);
    try {
      let done: (ok: boolean) => void = () => undefined;
      const f = new CardFlip(() => new Promise(res => (done = res)), () => false);
      f.start('bat', OLD, '/b.webp');
      await vi.advanceTimersByTimeAsync(FLIP_HALF);
      expect(f.state()?.phase).toBe('hold');
      done(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.state()?.phase).toBe('in');
    } finally { vi.useRealTimers(); }
  });

  it('a held flip gives up after FLIP_HOLD_MAX (shows as today); a failed picture clears at once', async () => {
    vi.useFakeTimers(FAKE);
    try {
      const f = new CardFlip(() => new Promise(() => undefined), () => false);
      f.start('bat', OLD, '/b.webp');
      await vi.advanceTimersByTimeAsync(FLIP_HALF + FLIP_HOLD_MAX - 1);
      expect(f.state()?.phase).toBe('hold');
      await vi.advanceTimersByTimeAsync(2);
      expect(f.state()).toBeNull();
      const g = new CardFlip(async () => false, () => false);
      g.start('pit', OLD, '/b.webp');
      await vi.advanceTimersByTimeAsync(FLIP_HALF);
      expect(g.state()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('a new start cancels the old one', async () => {
    vi.useFakeTimers(FAKE);
    try {
      const f = new CardFlip(async () => true, () => false);
      f.start('bat', OLD, '/b.webp');
      await vi.advanceTimersByTimeAsync(100);
      f.start('pit', OLD, '/c.webp');
      await vi.advanceTimersByTimeAsync(FLIP_HALF - 100);
      expect(f.state()).toEqual({ role: 'pit', phase: 'out', old: OLD });
    } finally { vi.useRealTimers(); }
  });
});
