import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, output, signal, viewChild } from '@angular/core';
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
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const ul = this.ul().nativeElement;
      const ro = new ResizeObserver(() => {
        const n = rowsFit(ul.clientHeight, parseFloat(getComputedStyle(ul).rowGap) || 0);
        if (n === this.per()) return;
        const hadFocus = ul.contains(document.activeElement);
        this.per.set(n);
        if (hadFocus) this.focusFirstRow(ul);
      });
      ro.observe(ul);
      destroy.onDestroy(() => ro.disconnect());
    });
  }

  protected names(m: CMine): string {
    if (m.vsCpu) return 'You vs the Computer';
    if (m.you === 'creator') return m.opponentName ? `You vs ${m.opponentName}` : 'Your challenge';
    return `${m.creatorName} vs you`;
  }

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
