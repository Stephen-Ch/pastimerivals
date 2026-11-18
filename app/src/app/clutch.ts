/** Plan 73 Part C: one clutch setup for the Duel, shown above the at-bat, and what each result would mean in it.
 *  For fun only: the odds are unchanged, and the lines are never spoken or shared. Baseball-checked for this one
 *  situation (bottom of the 9th, two outs, down a run, tying run on second). */
import { OutcomeKey } from './logic';

export const CLUTCH_SETUP = 'If it\'s the bottom of the 9th, two outs, down a run, tying run on second...';

const NEXT: Record<OutcomeKey, string> = {
  hr: '...that\'s a walk-off.',
  triple: '...that ties it, winning run on third.',
  double: '...that ties it, winning run on second.',
  single: '...the tying run heads for home.',
  bb: '...the inning stays alive.',
  hbp: '...the inning stays alive.',
  k: '...that\'s the ballgame.',
  oip: '...that\'s the ballgame.',
};

/** What this result would mean in the setup. */
export function clutchNext(o: OutcomeKey): string { return NEXT[o]; }
