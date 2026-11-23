// Plan 79 E (planning/79-FRICTION-PLAN.md v3): Last Licks ends on its biggest moment, a "deciding play" card above the line score.
import { Component, computed, input } from '@angular/core';
import type { CAtBat, CGame } from './challenge-api';
import { lastName } from './scoreboard';

/** Index of the deciding play: the play that put the winner ahead for good (the go-ahead play the loser never answered).
 *  Tie: the final out (the last play). Null with no plays. Runs are the counted runs (points; a walk-off counts up to the winning run). */
export function decidingIndex(g: CGame): number | null {
  const n = g.atBats.length;
  if (!n) return null;
  if (g.winner !== 0 && g.winner !== 1) return n - 1;
  const w = g.winner, l = 1 - w, t = [0, 0];
  let at: number | null = null;
  g.atBats.forEach((a, i) => {
    const ahead = t[w] > t[l];
    t[a.battingSide] += a.points;
    if (!ahead && t[w] > t[l]) at = i;
  });
  return at ?? n - 1;
}

const isError = (a: CAtBat) => a.outcome === 'oip' && a.outType === 'error';
const isSacFly = (a: CAtBat) => a.outcome === 'oip' && !!a.sacFly;

/** The big word on the card, for every outcome that can decide a game. */
export function playWord(a: CAtBat): string {
  switch (a.outcome) {
    case 'single': return 'SINGLE';
    case 'double': return 'DOUBLE';
    case 'triple': return 'TRIPLE';
    case 'hr': return 'HOME RUN';
    case 'bb': return 'WALK';
    case 'hbp': return 'HIT BY PITCH';
    case 'k': return 'STRIKEOUT';
  }
  if (isError(a)) return 'ERROR';
  if (isSacFly(a)) return 'SAC FLY';
  return a.points > 0 ? 'RUN SCORES' : 'OUT';
}

const outVerb = (a: CAtBat) => a.outcome === 'k' ? 'strikes out' : a.doublePlay ? 'grounds into a double play'
  : ({ ground: 'grounds out', fly: 'flies out', line: 'lines out', pop: 'pops out' } as Record<string, string>)[a.outType ?? ''] ?? 'makes an out';
const runs = (n: number) => (n === 1 ? 'a run scores' : `${n} runs score`);
const hitIn = (verb: string, n: number) => `${verb} in ${n === 1 ? 'a run' : n}`;

/** What the batter did, in plain words ("doubles in 2", "hits a solo home run"). */
function playVerb(a: CAtBat): string {
  const n = a.points;
  switch (a.outcome) {
    case 'single': return n ? hitIn('singles', n) : 'singles';
    case 'double': return n ? hitIn('doubles', n) : 'doubles';
    case 'triple': return n ? hitIn('triples', n) : 'triples';
    case 'hr': return n >= 4 ? 'hits a grand slam' : n <= 1 ? 'hits a solo home run' : `hits a ${n}-run home run`;
    case 'bb': return n ? 'walks in a run' : 'walks';
    case 'hbp': return n ? 'is hit by a pitch, forcing in a run' : 'is hit by a pitch';
  }
  if (isError(a)) return n ? `reaches on an error as ${runs(n)}` : 'reaches on an error';
  if (isSacFly(a)) return n > 1 ? `hits a sacrifice fly as ${runs(n)}` : 'hits a sacrifice fly';
  return n ? `${outVerb(a)} as ${runs(n)}` : outVerb(a);
}

export interface DecidingCard { word: string; line: string; side: number; }

/** The card's text. you = the viewer's side (null for spectators); name = a side's plain name. */
export function decidingCard(g: CGame | null | undefined, you: number | null, name: (side: number) => string): DecidingCard | null {
  if (!g) return null;
  const i = decidingIndex(g);
  if (i === null) return null;
  const a = g.atBats[i], who = `${lastName(a.batter.name)} ${a.batter.year}`, side = a.battingSide;
  if (g.winner !== 0 && g.winner !== 1) {
    // A half stopped by the 30-batter cap can end on a hit or walk: then it is the last play, not the final out (diff review 1).
    const out = a.outcome === 'k' || (a.outcome === 'oip' && !isError(a));
    return { word: playWord(a), line: `Tied after ${g.innings ?? 1}. ${out ? `Final out: ${who} ${outVerb(a)}` : `Last play: ${who} ${playVerb(a)}`}.`, side };
  }
  const hi = Math.max(...g.totals), lo = Math.min(...g.totals);
  const result = you === null ? `${name(g.winner)} wins ${hi}-${lo}.` : g.winner === you ? `You win ${hi}-${lo}.` : `You lose ${lo}-${hi}.`;
  return { word: playWord(a), line: `${who} ${playVerb(a)}. ${result}`, side };
}

@Component({
  selector: 'pr-deciding-play',
  template: `@if (card(); as c) {
    <section class="dp" [style.border-left-color]="color()(c.side)" aria-label="Deciding play">
      <p class="dp-word">{{ c.word }}</p>
      <p class="dp-line">{{ c.line }}</p>
    </section>
  }`,
  styleUrl: './deciding-play.css',
})
export class DecidingPlay {
  readonly game = input<CGame | null>(null);
  readonly you = input<number | null>(null);
  readonly name = input<(side: number) => string>(s => String(s));
  readonly color = input<(side: number) => string>(() => 'currentColor');
  protected readonly card = computed(() => decidingCard(this.game(), this.you(), this.name()));
}
