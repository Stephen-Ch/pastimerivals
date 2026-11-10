// Plan 59 Round 5 test 10: the side and windup backdrops draw exactly as before (the CF view's home stands and the
// inside-the-park pieces are CF only). A fake canvas records every draw call; the hash was taken on d99fdea.
import { ParkLook } from './art';
import { ParkPainter } from './park-draw';
import { backdropPlace } from './pitch-scene';

function log(look: ParkLook, view: 'side' | 'windup', mirror: boolean): string {
  const out: string[] = [];
  const grad = { addColorStop: (...a: unknown[]) => out.push(`stop ${a.join(',')}`) };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => k === 'createLinearGradient' ? (...a: number[]) => { out.push(`lg ${a.map(v => v.toFixed(3)).join(',')}`); return grad; }
      : k === 'createPattern' ? () => null
      : (...a: unknown[]) => { out.push(`${k} ${a.map(v => typeof v === 'number' ? v.toFixed(3) : typeof v === 'string' ? v : typeof v).join(',')}`); },
    set: (_t, k: string, v: unknown) => { out.push(`${k}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`); return true; },
  });
  const pl = backdropPlace(view, mirror, 390, 507);
  new ParkPainter(ctx as unknown as CanvasRenderingContext2D).backdrop(look, pl.cam, 390, 507, pl.f, pl.cx, pl.cy, view !== 'side');
  return out.join('\n');
}
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };

describe('plan 59 r5 test 10: side and windup backdrops unchanged', () => {
  it('draw-call hash for every look, side (both hands) and windup', () => {
    const parts: string[] = [];
    for (const look of ['1901', '1920', '1956', '1970', '1990'] as ParkLook[]) {
      parts.push(log(look, 'side', false), log(look, 'side', true), log(look, 'windup', false));
    }
    const all = parts.join('\n#\n');
    expect({ hash: fnv(all), calls: all.split('\n').length }).toEqual({ hash: '55366cc4', calls: 63507 });
  });
});
