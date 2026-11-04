// PLAN-2026-11-04-rename-polish-v3: short side line with the batter's last name while his at-bat plays.
import { describe, expect, it } from 'vitest';
import { sideLine, sideNameLine } from './side-line';

describe('sideNameLine (rename polish)', () => {
  it('names the batter for every hand', () => {
    expect(sideNameLine('Ruth', 'L', 'R')).toBe('Ruth bats left.');
    expect(sideNameLine('Aaron', 'R', 'L')).toBe('Aaron bats right.');
    expect(sideNameLine('Mantle', 'B', 'R')).toBe('Mantle, switch, bats left.');
    expect(sideNameLine('Mantle', 'S', 'L')).toBe('Mantle, switch, bats right.');
    expect(sideNameLine('Cobb', null, 'R')).toBe('Cobb batting.');
    expect(sideNameLine('Rose', 'B', '')).toBe('Rose batting.');
  });
  it('leaves the long side line unchanged', () => {
    expect(sideLine('L', 'R')).toBe('Bats left: other side of the plate.');
  });
});
