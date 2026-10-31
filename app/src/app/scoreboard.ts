// Plan 59 Round 2a: one scoreboard for The Duel and Last Licks, styled by the game's era (one graphics style per game:
// The Duel follows the batter's era, Last Licks the home side's era; the parent passes that ParkLook).
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ParkLook } from './art';

/** Board colors per era (style guide section 4). fg = text, num = numerals and filled dots, edge = borders only
 *  (the era accent is never text: red on green and blue on brown are under 3:1). */
export interface BoardColors { bg: string; fg: string; num: string; edge: string; }
export const ERA_BOARD: Record<ParkLook, BoardColors> = {
  '1901': { bg: '#efe6d2', fg: '#1d1b19', num: '#1d1b19', edge: '#8c2f22' },   // hand-painted board on wood
  '1920': { bg: '#ece8dc', fg: '#1d1b19', num: '#1d1b19', edge: '#24365c' },   // newspaper box score
  '1956': { bg: '#2f4a36', fg: '#ffffff', num: '#ffffff', edge: '#b02a2a' },   // green painted board
  '1970': { bg: '#3b2a1e', fg: '#ffffff', num: '#f4b23a', edge: '#2f5fb0' },   // bulb board
  '1990': { bg: '#14233d', fg: '#ffffff', num: '#ffffff', edge: '#e2b23a' },   // TV score bug
};

export interface BoardInput {
  names: [string, string];
  count: { balls: number; strikes: number } | null;
  scores: [number, number] | null;
  inning: string | null;
  outs: number | null;
  bases: [boolean, boolean, boolean] | null;
}
export interface BoardModel { count: string | null; countLabel: string; scores: [string, string] | null; state: string | null; }

/** Texts and the screen-reader strings (outs and bases wording kept from challenge.html before Round 2a). */
export function boardModel(i: BoardInput): BoardModel {
  const b = i.bases;
  return {
    count: i.count ? `${i.count.balls}-${i.count.strikes}` : null,
    countLabel: 'Balls and strikes',
    scores: i.scores ? [String(i.scores[0]), String(i.scores[1])] : null,
    state: i.outs === null || !b ? null
      : i.outs + ' out, ' + (b[0] ? 'runner on first ' : '') + (b[1] ? 'runner on second ' : '') + (b[2] ? 'runner on third' : ''),
  };
}

/** Last name for narrow boards ("Babe Ruth" -> "Ruth", "Ken Griffey Jr." -> "Griffey Jr."). */
export function lastName(full: string): string {
  const w = full.trim().split(/\s+/);
  if (w.length < 2) return full.trim();
  return /^(Jr\.?|Sr\.?|II|III|IV)$/.test(w[w.length - 1]) && w.length > 2 ? `${w[w.length - 2]} ${w[w.length - 1]}` : w[w.length - 1];
}

@Component({
  selector: 'pr-scoreboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-era]': 'look()',
    '[style.--b-bg]': 'colors().bg', '[style.--b-fg]': 'colors().fg', '[style.--b-num]': 'colors().num', '[style.--b-edge]': 'colors().edge',
  },
  template: `
    @let m = model();
    <span class="side">
      <span class="nm"><span class="full">{{ names()[0] }}</span><span class="short">{{ shortNames()[0] }}</span></span>
      @if (m.scores) { <strong class="num sc">{{ m.scores[0] }}</strong> }
    </span>
    <span class="mid">
      @if (inning()) { <span class="inn">{{ inning() }}</span> }
      @if (m.state) {
        <span class="state" [attr.aria-label]="m.state">
          <svg class="diamond" viewBox="0 0 44 30" aria-hidden="true">
            <polygon points="34,10 40,16 34,22 28,16" [class.on]="!!bases()?.[0]" />
            <polygon points="22,2 28,8 22,14 16,8" [class.on]="!!bases()?.[1]" />
            <polygon points="10,10 16,16 10,22 4,16" [class.on]="!!bases()?.[2]" />
          </svg>
          <span class="outs" aria-hidden="true">@for (o of [0, 1, 2]; track o) { <i [class.on]="o < (outs() ?? 0)"></i> }</span>
        </span>
      }
      @if (m.count) { <span class="num cnt" [attr.aria-label]="m.countLabel">{{ m.count }}</span> }
    </span>
    <span class="side end">
      @if (m.scores) { <strong class="num sc">{{ m.scores[1] }}</strong> }
      <span class="nm"><span class="full">{{ names()[1] }}</span><span class="short">{{ shortNames()[1] }}</span></span>
    </span>
  `,
  styles: `
    :host { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; flex: none;
      padding: 8px 12px; border-radius: 10px; background: var(--b-bg); color: var(--b-fg); font: 600 .95rem/1.2 var(--display); letter-spacing: .02em; }
    .side { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 0; }
    .end { justify-content: flex-end; }
    .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .short { display: none; }
    @media (max-width: 359px) { .full { display: none; } .short { display: inline; } }
    .mid { flex: none; display: flex; align-items: center; gap: 8px; }
    .inn { font-size: .8rem; white-space: nowrap; }
    .num { color: var(--b-num); font-variant-numeric: tabular-nums; }
    .sc { font-size: 1.4rem; line-height: 1; }
    .cnt { font-size: 1.1rem; min-width: 3ch; text-align: center; }
    .state { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .diamond { width: 44px; height: 30px; display: block; }
    polygon { fill: none; stroke: var(--b-fg); stroke-width: 1.5; }
    polygon.on { fill: var(--b-num); stroke: var(--b-num); }
    .outs { display: flex; gap: 4px; }
    .outs i { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--b-fg); box-sizing: border-box; }
    .outs i.on { background: var(--b-num); border-color: var(--b-num); }
    /* Era borders: drawn with inset shadows and outlines, so no era changes the board's size. */
    :host([data-era='1901']) { box-shadow: inset 0 0 0 3px var(--b-edge); }
    :host([data-era='1920']) { border-radius: 2px; box-shadow: inset 0 3px 0 -1px var(--b-edge), inset 0 -3px 0 -1px var(--b-edge); }
    :host([data-era='1956']) .num { outline: 1.5px solid currentColor; outline-offset: 1px; padding: 0 3px; border-radius: 2px; }
    :host([data-era='1970']) { box-shadow: inset 0 -3px 0 var(--b-edge); }
    :host([data-era='1970']) .num { text-shadow: 0 0 6px rgba(244, 178, 58, .6); }
    :host([data-era='1990']) { border-radius: 4px; box-shadow: inset 4px 0 0 var(--b-edge); }
  `,
})
export class Scoreboard {
  readonly look = input.required<ParkLook>();
  readonly names = input.required<[string, string]>();
  /** Shown instead of names under 360 px wide (the parent decides: last names, or the same names). */
  readonly short = input<[string, string] | null>(null);
  readonly count = input<{ balls: number; strikes: number } | null>(null);
  readonly scores = input<[number, number] | null>(null);
  readonly inning = input<string | null>(null);
  readonly outs = input<number | null>(null);
  readonly bases = input<[boolean, boolean, boolean] | null>(null);

  protected readonly shortNames = computed(() => this.short() ?? this.names());
  protected readonly colors = computed(() => ERA_BOARD[this.look()] ?? ERA_BOARD['1990']);
  protected readonly model = computed(() => boardModel({ names: this.names(), count: this.count(), scores: this.scores(),
    inning: this.inning(), outs: this.outs(), bases: this.bases() }));
}
