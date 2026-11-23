import { mineNames } from './team-names';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, input, output, signal, untracked, viewChild } from '@angular/core';
import type { CMine } from './challenge-api';
import { isWaiting, pageCountBy, pageForAnchor, rowsFit, stageWords, waitingText } from './game-status';

/** Plan 69 A1: "Your games". Rows have one fixed height; rows a page = whole rows that fit the list box (measured), 1 to 4.
 *  The waiting line and the pager line are always there, so the list box never depends on how many rows show. */
@Component({
  selector: 'pr-games-list',
  styleUrl: './games-list.css',
  templateUrl: './games-list.html',
})
export class GamesList {
  readonly list = input.required<CMine[]>();
  readonly waiting = input(0);
  readonly open = output<string>();
  protected readonly stageWords = stageWords;
  protected readonly isWaiting = isWaiting;
  protected readonly waitingText = waitingText;
  /** 1 until the first measure, so 4 rows never flash and overflow on load. */
  protected readonly per = signal(1);
  /** Index of the first row of the page the player chose. */
  private readonly anchor = signal(0);
  protected readonly pages = computed(() => pageCountBy(this.list().length, this.per()));
  protected readonly page = computed(() => pageForAnchor(this.anchor(), this.per(), this.list().length));
  protected readonly shown = computed(() => this.list().slice(this.page() * this.per(), (this.page() + 1) * this.per()));
  private readonly ul = viewChild.required<ElementRef<HTMLElement>>('ul');
  private readonly injector = inject(Injector);

  constructor() {
    // A list that shrank while open: pull a stale anchor back so a later turn does not jump to a different page.
    effect(() => {
      const n = this.list().length, p = this.page(), per = this.per();
      if (untracked(this.anchor) >= n) untracked(() => this.anchor.set(p * per));
    });
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const ul = this.ul().nativeElement;
      const ro = new ResizeObserver(() => {
        const n = rowsFit(ul.clientHeight, parseFloat(getComputedStyle(ul).rowGap) || 0);
        if (n === this.per()) return;
        // Focus moves only if the focused row leaves the page (rows are tracked by code, so a row that stays keeps its element).
        const rowsNow = [...ul.querySelectorAll<HTMLElement>('.row-btn')];
        const i = rowsNow.findIndex(b => b === document.activeElement);
        const focused = i < 0 ? -1 : this.page() * this.per() + i;
        this.per.set(n);
        const start = this.page() * n;
        if (focused >= 0 && (focused < start || focused >= start + n)) this.focusFirstRow(ul);
      });
      ro.observe(ul);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  /** Plan 79: team names, nicknames on old games. */
  protected names(m: CMine): string { return mineNames(m); }

  protected go(d: 1 | -1) {
    const p = Math.min(this.pages() - 1, Math.max(0, this.page() + d));
    this.anchor.set(p * this.per());
    this.focusFirstRow(this.ul().nativeElement);
  }

  /** After the new rows render (rows are tracked by code and redrawn). */
  private focusFirstRow(ul: HTMLElement) {
    afterNextRender(() => ul.querySelector<HTMLElement>('.row-btn')?.focus(), { injector: this.injector });
  }
}
