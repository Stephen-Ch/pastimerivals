import { Component, ElementRef, inject, input, viewChild } from '@angular/core';
import { cameraAt, ParkPlay } from './park';
import { FielderSheet, H, ParkPainter, W } from './park-draw';

/** Plan 44: the field-level park view. One canvas, sized to the panel at devicePixelRatio capped at 2.
 *  PitchScene's animation loop calls draw(t); this component never runs its own loop. */
@Component({
  selector: 'pr-ballpark-view',
  template: `<canvas #cv aria-hidden="true"></canvas>`,
  styles: `:host { display: block; position: absolute; inset: 0; } canvas { display: block; width: 100%; height: 100%; }`,
})
export class BallparkView {
  readonly play = input.required<ParkPlay>();
  readonly sheet = input.required<FielderSheet>();
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly host = inject(ElementRef<HTMLElement>);
  private painter: ParkPainter | null = null;
  private ready = false;

  /** Pixel size of the canvas: the panel's size x devicePixelRatio (at most 2). */
  static canvasSize(cssW: number, cssH: number, dpr: number): [number, number] {
    const k = Math.min(2, Math.max(1, dpr || 1));
    return [Math.max(1, Math.round(cssW * k)), Math.max(1, Math.round(cssH * k))];
  }

  private setup(): boolean {
    if (this.ready) return !!this.painter;
    this.ready = true;
    const cv = this.cv().nativeElement, el = this.host.nativeElement as HTMLElement;
    const [w, h] = BallparkView.canvasSize(el.clientWidth || W, el.clientHeight || H, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    cv.width = w; cv.height = h;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext('2d'); } catch { ctx = null; }
    if (!ctx) return false;
    ctx.scale(w / W, h / H);
    this.painter = new ParkPainter(ctx);
    return true;
  }

  draw(t: number) {
    if (!this.setup() || !this.painter) return;
    const p = this.play();
    this.painter.draw(p, cameraAt(p, t, W / H), t, this.sheet());
  }
}
