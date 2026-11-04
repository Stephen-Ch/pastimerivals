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

/** Rename polish (PLAN-2026-11-04-rename-polish-v3): short side line with the batter's last name, shown while his at-bat plays.
 *  Short on purpose: the long forms do not fit at 320 px or in the 200 px landscape column. Never null, so every batter is named. */
export function sideNameLine(last: string, bats: string | null | undefined, throws: string | null | undefined): string {
  const b = (bats ?? '').trim().toUpperCase(), t = (throws ?? '').trim().toUpperCase();
  if (b === 'R') return `${last} bats right.`;
  if (b === 'L') return `${last} bats left.`;
  if ((b === 'B' || b === 'S') && t === 'R') return `${last}, switch, bats left.`;
  if ((b === 'B' || b === 'S') && t === 'L') return `${last}, switch, bats right.`;
  return `${last} batting.`;
}
