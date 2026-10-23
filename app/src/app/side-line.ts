/** Plan 40 B: one line telling which side of the plate the batter stands on.
 * Built from the batter's listed bats (L, R, B/S = switch) and the pitcher's throws; unknowns give no line.
 * Display text only: never part of stored captions or decoration versions. */
export function sideLine(bats: string | null | undefined, throws: string | null | undefined): string | null {
  const b = (bats ?? '').trim().toUpperCase(), t = (throws ?? '').trim().toUpperCase();
  if (b === 'R') return 'Bats right.';
  if (b === 'L') return 'Bats left: other side of the plate.';
  if (b === 'B' || b === 'S') {
    if (t === 'R') return 'Switch hitter: bats left vs a righty.';
    if (t === 'L') return 'Switch hitter: bats right vs a lefty.';
  }
  return null;
}
