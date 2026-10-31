import { afterRenderEffect, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { cameraAt, ParkPlay } from './park';
import { FielderSheet, H, ParkPainter, W } from './park-draw';

/** Plan 44: the field-level park view. One canvas, sized to the panel at devicePixelRatio capped at 2.
 *  PitchScene's animation loop calls draw(t); this component never runs its own loop.
 *  Plan 59 Round 1b: the canvas fills the stage at any shape. Painter units: height 480, width 480 x aspect, one scale. */
@Component({
  selector: 'pr-ballpark-view',
  template: `<canvas #cv aria-hidden="true"></canvas>`,
  styles: `:host { display: block; position: absolute; inset: 0; } canvas { display: block; width: 100%; height: 100%; }`,
})
export class BallparkView {
  readonly play = input.required<ParkPlay>();
  readonly sheet = input.required<FielderSheet>();
  /** Plan 59 Round 2b: a still at this play time (the scene was ended early); null while the scene's loop draws. */
  readonly holdAt = input<number | null>(null);
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly host = inject(ElementRef<HTMLElement>);
  private painter: ParkPainter | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ready = false;
  /** Painter units of the current canvas (height always 480). */
  private units: [number, number] = [W, H];
  private size: [number, number] = [0, 0];
  private lastT: number | null = null;
  private ro: ResizeObserver | null = null;

  constructor() {
    afterRenderEffect(() => { const t = this.holdAt(); if (t !== null) this.draw(t); });
    // Plan 59 Round 2b: fielders drawn as silhouettes before their sheet loaded are redrawn once it is in.
    const redraw = () => { if (this.lastT !== null) this.draw(this.lastT); };
    let watched: HTMLImageElement | null = null;
    effect(() => {
      const img = this.sheet().img;
      if (img === watched) return;
      watched?.removeEventListener('load', redraw);
      watched = img && !img.complete ? img : null;
      watched?.addEventListener('load', redraw, { once: true });
    });
    inject(DestroyRef).onDestroy(() => { this.ro?.disconnect(); watched?.removeEventListener('load', redraw); });
  }

  /** Pixel size of the canvas: the panel's size x devicePixelRatio (at most 2). */
  static canvasSize(cssW: number, cssH: number, dpr: number): [number, number] {
    const k = Math.min(2, Math.max(1, dpr || 1));
    return [Math.max(1, Math.round(cssW * k)), Math.max(1, Math.round(cssH * k))];
  }

  /** Plan 59 Round 1b: painter units for a box (any units): height 480, width 480 x aspect; k = box units per painter unit, same on both axes. */
  static fitScale(boxW: number, boxH: number): { w: number; h: number; k: number } {
    const k = boxH / H;
    return { w: boxW / k, h: H, k };
  }

  /** Sizes the canvas to the host; true when it changed. */
  private resize(): boolean {
    const el = this.host.nativeElement as HTMLElement, cv = this.cv().nativeElement;
    const cssW = el.clientWidth || W, cssH = el.clientHeight || H;
    if (this.ready && cssW === this.size[0] && cssH === this.size[1]) return false;
    this.size = [cssW, cssH];
    const [w, h] = BallparkView.canvasSize(cssW, cssH, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    cv.width = w; cv.height = h;
    const f = BallparkView.fitScale(w, h);
    this.units = [f.w, f.h];
    this.ctx?.setTransform(f.k, 0, 0, f.k, 0, 0);
    return true;
  }

  private setup(): boolean {
    if (this.ready) return !!this.painter;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = this.cv().nativeElement.getContext('2d'); } catch { ctx = null; }
    this.ctx = ctx;
    this.resize();
    this.ready = true;
    if (!ctx) return false;
    this.painter = new ParkPainter(ctx);
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => { if (this.resize() && this.lastT !== null) this.draw(this.lastT); });
      this.ro.observe(this.host.nativeElement as HTMLElement);
    }
    return true;
  }

  draw(t: number) {
    this.lastT = t;
    if (!this.setup() || !this.painter) return;
    const p = this.play(), [w, h] = this.units;
    this.painter.draw(p, cameraAt(p, t, w / h), t, this.sheet(), w, h);
  }
}
