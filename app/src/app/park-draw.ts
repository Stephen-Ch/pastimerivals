import { ParkLook } from './art';
import { ballAt, Camera, edgeDist, fielderAt, FR, ParkPlay, pol, toCam, NEAR, wallDist } from './park';

// Plan 44: draws the park at field level on a 2D canvas, in W x H panel units (760 x 480), from the approved prototype
// (planning/44-park-prototype.html). Everything is placed in feet and drawn live with one camera, so the wall base meets the grass.

export const W = 760, H = 480;
const rad = (d: number) => (d * Math.PI) / 180;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
type V3 = [number, number, number];

interface Look { wall: string; wallTop: string; track: boolean; markers: number[]; stands: [string, string]; board: 'hand' | 'lit'; grass: string; sky: [string, string]; }
export const LOOKS: Record<ParkLook, Look> = {
  '1901': { wall: '#7a5532', wallTop: '#4f341d', track: false, markers: [], stands: ['#6d5a44', '#5d4c39'], board: 'hand', grass: '#5f8a45', sky: ['#9fb8cf', '#dfe6e6'] },
  '1920': { wall: '#6e4a2c', wallTop: '#4f341d', track: false, markers: [], stands: ['#655443', '#544535'], board: 'hand', grass: '#5c8a44', sky: ['#8fb0d0', '#dde6ea'] },
  '1956': { wall: '#9a9a92', wallTop: '#77776f', track: true, markers: [-45, 45], stands: ['#7d7f86', '#6b6d74'], board: 'hand', grass: '#4f8f3f', sky: ['#6fa0d8', '#d8e6f0'] },
  // Plan 59 Round 1b: 1970-1989 park (lit board, warning track). Provisional colors from 1956; Round 1b Part B draws its own look.
  '1970': { wall: '#9a9a92', wallTop: '#77776f', track: true, markers: [-45, 45], stands: ['#7d7f86', '#6b6d74'], board: 'lit', grass: '#4f8f3f', sky: ['#6fa0d8', '#d8e6f0'] },
  '1990': { wall: '#1f4f8a', wallTop: '#163a66', track: true, markers: [-45, -22, 0, 22, 45], stands: ['#3a5577', '#30496a'], board: 'lit', grass: '#3f8f3a', sky: ['#5a95dc', '#d5e5f4'] },
};
/** Stephen's own products by their real names, plus period concessions. No real sponsors, teams or league marks. */
export const SIGNS: Record<ParkLook, [string, number][]> = {
  '1901': [['Hot Dogs 10¢', -30], ['Scorecards', -10], ['DailyInventory', 12], ['Rawls Game', 32]],
  '1920': [['Mortality', -32], ['Hot Dogs 10¢', -12], ['Scorecards', 10], ['NYC Explorer', 32]],
  '1956': [['BlackJack Sensei', -31], ['Hot Dogs 25¢', -11], ['Dealer’s Choice', 11], ['DailyInventory', 31]],
  '1970': [['Mortality', -31], ['Hot Dogs 50¢', -11], ['Rawls Game', 11], ['NYC Explorer', 31]],
  '1990': [['NYC Explorer', -32], ['DailyInventory', -12], ['BlackJack Sensei', 11], ['Rawls Game', 32]],
};
/** Fallback silhouette color per fielder sheet (the uniform's accent), if the sheet is not loaded by contact. */
export const ACCENT: Record<string, string> = { '1901-1919': '#24365c', '1920-1945': '#24365c', '1946-1969': '#b02a2a', '1970-1989': '#2f5fb0', '1990-2025': '#222222' };

/** Rows of stands at an angle. 1901 (expert): a grandstand behind home and down the lines, low bleachers in the corners,
 *  and an open outfield where overflow fans stand on the grass behind a rope. */
export function standRows(look: ParkLook, a: number): number {
  if (look !== '1901') return 10;
  const t = Math.abs(a);
  return t >= 55 ? 10 : t >= 35 ? 3 : 0;
}
const STAND_RANGES = (look: ParkLook): [number, number, number][] =>
  look === '1901' ? [[-115, -55, 10], [-55, -35, 3], [35, 55, 3], [55, 115, 10]] : [[-115, 115, 10]];
const range = (a0: number, a1: number, step: number) => { const o: number[] = []; for (let a = a0; a <= a1 + 1e-9; a += step) o.push(a); if (o[o.length - 1] < a1) o.push(a1); return o; };

function rng(s: number) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86e4a', '#7d4f33', '#5a3825'];

// ---- crowd: about 40 dressed figures per look, drawn once per look into a small sheet ----
const FW = 16, FH = 30, NV = 40;
export interface Crowd { img: HTMLCanvasElement; seats: [number, number, number, number, number][]; }
const crowds = new Map<ParkLook, Crowd>();
export function crowdFor(look: ParkLook): Crowd | null {
  const have = crowds.get(look);
  if (have) return have;
  if (typeof document === 'undefined') return null;
  const s = document.createElement('canvas'); s.width = FW * NV * 2; s.height = FH * 2;
  const g = s.getContext('2d');
  if (!g) return null;
  g.scale(2, 2);
  const L = +look, r = rng(L * 13 + 5);
  for (let i = 0; i < NV; i++) {
    const X = i * FW + FW / 2, Y = FH, k = 2.2;
    const woman = L >= 1990 ? r() < 0.45 : L >= 1956 ? r() < 0.3 : r() < 0.12;   // 1970: as 1956
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    let body: string;
    if (L <= 1920) body = woman ? pick(['#5b4a6b', '#3d4a5c', '#6b4f3a']) : pick(['#2b2b2e', '#3a3530', '#25303b', '#4a3f35']);
    else if (L === 1956) body = woman ? pick(['#c7564a', '#4f7fb5', '#e3c25a', '#7aa36b']) : pick(['#3b3f4a', '#e8e4da', '#6a5a48', '#2f3e57']);
    else body = pick(['#d64545', '#2f6fd1', '#f2f2f2', '#2b2b2b', '#f0b429', '#3aa36b', '#7b4fc2']);
    g.fillStyle = body;
    if (woman && L <= 1956) { g.beginPath(); g.moveTo(X - 2.6 * k, Y); g.lineTo(X + 2.6 * k, Y); g.lineTo(X + 1.5 * k, Y - 5.5 * k); g.lineTo(X - 1.5 * k, Y - 5.5 * k); g.fill(); }
    else g.fillRect(X - 1.8 * k, Y - 5.5 * k, 3.6 * k, 5.5 * k);
    if (L <= 1920 && !woman) { g.fillStyle = '#f4f0e6'; g.beginPath(); g.moveTo(X - 0.6 * k, Y - 5.5 * k); g.lineTo(X + 0.6 * k, Y - 5.5 * k); g.lineTo(X, Y - 3.6 * k); g.fill(); }
    const hy = Y - 7.1 * k;
    g.fillStyle = pick(SKIN); g.beginPath(); g.arc(X, hy, 1.45 * k, 0, 7); g.fill();
    const h = r();
    const ell = (cx: number, cy: number, rx: number, ry: number, col: string) => { g.fillStyle = col; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 7); g.fill(); };
    if (L <= 1920) {
      if (woman) { ell(X, hy - 1.1 * k, (L === 1901 ? 3.1 : 1.9) * k, 0.8 * k, pick(['#6b3a4a', '#2d2d3a', '#8a6d3b'])); if (L === 1920) { g.fillStyle = '#4a3a50'; g.beginPath(); g.arc(X, hy - 0.6 * k, 1.5 * k, Math.PI, 0); g.fill(); } }
      else if (h < 0.45) { ell(X, hy - 1 * k, 2.4 * k, 0.55 * k, '#e6cf8f'); g.fillStyle = '#e6cf8f'; g.fillRect(X - 1.35 * k, hy - 2.4 * k, 2.7 * k, 1.4 * k); g.fillStyle = '#222'; g.fillRect(X - 1.35 * k, hy - 1.55 * k, 2.7 * k, 0.45 * k); }
      else if (h < 0.75) { ell(X, hy - 1 * k, 2 * k, 0.5 * k, '#1d1d1d'); g.fillStyle = '#1d1d1d'; g.beginPath(); g.arc(X, hy - 1.1 * k, 1.35 * k, Math.PI, 0); g.fill(); }
      else ell(X + 0.4 * k, hy - 1 * k, 2 * k, 0.75 * k, '#5a5148');
    } else if (L === 1956) {
      if (woman) { if (h < 0.4) ell(X, hy - 1.1 * k, 1.8 * k, 0.6 * k, '#f5f5f0'); else { g.fillStyle = '#3b2a1d'; g.beginPath(); g.arc(X, hy - 0.3 * k, 1.6 * k, Math.PI, 0); g.fill(); } }
      else if (h < 0.9) { ell(X, hy - 1 * k, 2.2 * k, 0.55 * k, '#3c3a36'); g.fillStyle = '#3c3a36'; g.fillRect(X - 1.25 * k, hy - 2.4 * k, 2.5 * k, 1.5 * k); }
    } else {
      if (h < 0.4) ell(X + 0.6 * k, hy - 0.9 * k, 2 * k, 0.75 * k, pick(['#1f3b73', '#b02a2a', '#222', '#f2f2f2']));
      else { g.fillStyle = pick(['#2b1d14', '#5a3b22', '#c9a15a', '#111']); g.beginPath(); g.arc(X, hy - 0.3 * k, 1.5 * k, Math.PI, 0); g.fill(); }
    }
  }
  const seats: Crowd['seats'] = [], rr = rng(L * 3 + 1);
  for (let row = 0; row < 10; row++) {
    for (let a = -112; a <= 112; a += 0.9) {
      const d = edgeDist(a) + 10 + row * 7, z = 10 + row * 4.2;
      const step = (3 / d) * 57.3; if ((a + 112) % Math.max(0.9, step) > 0.9) continue;
      if (rr() < 0.15) continue;
      const aa = a + (rr() - 0.5) * 0.6;
      if (row >= standRows(look, aa)) continue;
      const [x, y] = pol(d, aa);
      seats.push([x, y, z, Math.floor(rr() * NV), row]);
    }
  }
  if (look === '1901') {   // overflow fans standing on the outfield grass behind a rope (row -1 = drawn in front of the fence)
    for (let a = -33; a <= 33; a += 1.1) for (let k = 0; k < 2; k++) {
      if (rr() < 0.25) continue;
      const aa = a + (rr() - 0.5) * 0.9, [x, y] = pol(wallDist(aa) - 3 - k * 4 - rr() * 2, aa);
      seats.push([x, y, 0, Math.floor(rr() * NV), -1]);
    }
  }
  const c: Crowd = { img: s, seats };
  crowds.set(look, c);
  return c;
}

export interface FielderSheet { img: HTMLImageElement | null; cell: [number, number]; footY: number; era: string; }

export class ParkPainter {
  constructor(private c: CanvasRenderingContext2D) {}
  private cam!: Camera;
  private f = 1;
  /** Plan 59 Round 1b: painter units of this frame (height 480, width 480 x aspect). */
  private w = W;
  private h = H;
  /** Plan 59 Round 1b: where the camera's center lands (the field view: the canvas center; backdrops: set per view). */
  private cx = W / 2;
  private cy = H / 2;
  /** Backdrops (tele lenses close to the lines): chalk lines at their real 4 inches instead of the field view's 1.2 ft. */
  private thin = false;

  private scr(v: V3): [number, number] { return [this.cx + (v[0] / v[1]) * this.f, this.cy - (v[2] / v[1]) * this.f]; }
  private proj(x: number, y: number, z = 0): [number, number, number] | null {
    const v = toCam(this.cam, x, y, z);
    return v[1] < NEAR ? null : [...this.scr(v), v[1]];
  }
  private poly(pts: V3[], fill?: string, stroke?: string, lw = 1) {
    const ps = pts.map(p => toCam(this.cam, p[0], p[1], p[2]));
    const out: V3[] = [];
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i], b = ps[(i + 1) % ps.length], ai = a[1] >= NEAR, bi = b[1] >= NEAR;
      if (ai) out.push(a);
      if (ai !== bi) { const t = (NEAR - a[1]) / (b[1] - a[1]); out.push([lerp(a[0], b[0], t), NEAR, lerp(a[2], b[2], t)]); }
    }
    if (out.length < 3) return;
    const c = this.c;
    c.beginPath(); out.forEach((v, i) => { const s = this.scr(v); if (i) c.lineTo(s[0], s[1]); else c.moveTo(s[0], s[1]); }); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }

  /** One frame of the park view at scene time t. */
  draw(play: ParkPlay, cam: Camera, t: number, sheet: FielderSheet, w = W, h = H) {
    this.w = w; this.h = h; this.cx = w / 2; this.cy = h / 2; this.thin = false;
    this.cam = cam; this.f = w / 2 / Math.tan(rad(cam.fov) / 2);
    const c = this.c;
    c.clearRect(0, 0, w, h);
    this.park(play.look);
    if (play.mark) { const m: V3[] = []; for (let a = 0; a < 360; a += 30) m.push([play.mark[0] + Math.sin(rad(a)) * 3, play.mark[1] + Math.cos(rad(a)) * 3, 0.05]); this.poly(m, '#ffffff22', '#ffffff66', 1); }
    const b = ballAt(play, t);
    const sh = this.proj(b[0], b[1], 0.05);
    if (sh) { const r = Math.max(1.8, (0.7 * this.f) / sh[2]); c.fillStyle = '#00000055'; c.beginPath(); c.ellipse(sh[0], sh[1], r * 1.4, r * 0.45, 0, 0, 7); c.fill(); }
    const fs = play.fielders.map(f => fielderAt(f, t)).sort((p, q) => q.at[1] - p.at[1]);   // far first
    for (const f of fs) this.fielder(f.at, f.frame, f.moving, t, sheet);
    const bp = this.proj(b[0], b[1], b[2]);
    if (bp) { const r = Math.max(4, (0.6 * this.f) / bp[2]); c.fillStyle = '#fbf8f1'; c.strokeStyle = '#2b2a28'; c.lineWidth = 1.4; c.beginPath(); c.arc(bp[0], bp[1], r, 0, 7); c.fill(); c.stroke(); }
  }

  /** Plan 59 Round 1b: the static park (no ball, no fielders) for a backdrop, with an explicit focal length f and the
   *  camera's center at (cx, cy), all in the canvas's units. plate = false leaves the plate out (the side view's SVG plate stays). */
  backdrop(look: ParkLook, cam: Camera, w: number, h: number, f: number, cx: number, cy: number, plate: boolean) {
    this.w = w; this.h = h; this.cx = cx; this.cy = cy; this.cam = cam; this.f = f; this.thin = true;
    this.c.clearRect(0, 0, w, h);
    this.park(look, plate);
  }

  private fielder(at: [number, number], frame: number, moving: boolean, t: number, sheet: FielderSheet) {
    const b = this.proj(at[0], at[1], 0);
    if (!b) return;
    const c = this.c;
    // a 6 ft man is about 306 px of the sheet; never under 14 units tall (far outfielders a touch larger than true scale)
    const man = Math.max(14, (6 * this.f) / b[2]);
    const [cw, ch] = sheet.cell;
    const k = man / (306 * ch / 420);   // sheet cells are 420 tall at full size (tools/slice-fielders.py)
    const bob = moving ? Math.abs(Math.sin(t * 22)) * man * 0.04 : 0;
    c.fillStyle = '#00000035'; c.beginPath(); c.ellipse(b[0], b[1], man * 0.22, man * 0.06, 0, 0, 7); c.fill();
    if (sheet.img && sheet.img.complete && sheet.img.naturalWidth > 0) {
      c.drawImage(sheet.img, frame * cw, 0, cw, ch, b[0] - (cw / 2) * k, b[1] - sheet.footY * k - bob, cw * k, ch * k);
      return;
    }
    // fallback: plain silhouette in the uniform's accent color
    c.fillStyle = ACCENT[sheet.era] ?? '#333';
    const u = man / 12, X = b[0], Y = b[1] - bob;
    c.beginPath(); c.roundRect(X - 2 * u, Y - 10.5 * u, 4 * u, 10.5 * u, u); c.fill();
    c.beginPath(); c.arc(X, Y - 12 * u, 1.6 * u, 0, 7); c.fill();
    if (frame === FR.high) c.fillRect(X - 2.6 * u, Y - 16 * u, 1.2 * u, 6 * u);
  }

  private park(look: ParkLook, plate = true) {
    const L = LOOKS[look], c = this.c, cam = this.cam;
    const W = this.w, H = this.h;
    const hz = this.cy + Math.tan(rad(cam.pitch)) * this.f;
    const gr = c.createLinearGradient(0, hz - 400, 0, hz);
    gr.addColorStop(0, L.sky[0]); gr.addColorStop(1, L.sky[1]);
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    const edge: V3[] = []; for (let a = -115; a <= 115; a += 2.5) edge.push([...pol(edgeDist(a), a), 0]);
    this.poly([[0, -60, 0], ...edge], L.grass);
    // mowing stripes are modern (expert): 1990 only
    if (look === '1990') for (let d = 160; d < 400; d += 40) { const st: V3[] = []; for (let a = -45; a <= 45; a += 3) st.push([...pol(Math.min(d, wallDist(a)), a), 0]); for (let a = 45; a >= -45; a -= 3) st.push([...pol(Math.min(d + 20, wallDist(a)), a), 0]); this.poly(st, '#ffffff12'); }
    if (L.track) { const tr: V3[] = []; for (let a = -45; a <= 45; a += 2) tr.push([...pol(wallDist(a), a), 0]); for (let a = 45; a >= -45; a -= 2) tr.push([...pol(wallDist(a) - 15, a), 0]); this.poly(tr, '#a07a52'); }
    const dirt: V3[] = []; for (let a = -46; a <= 46; a += 3) dirt.push([...pol(155, a), 0]);
    this.poly([[0, -12, 0], ...dirt], '#b58a5c');
    this.poly([[0, 12, 0], [52, 52, 0], [0, 104, 0], [-52, 52, 0]], L.grass);
    { const m: V3[] = []; for (let a = 0; a < 360; a += 20) m.push([Math.sin(rad(a)) * 9, 60.5 + Math.cos(rad(a)) * 9, 0]); this.poly(m, '#b58a5c'); }
    for (const a of [-45, 45]) { const lw = this.thin ? 0.17 : 0.6, e = pol(wallDist(a), a), n = [Math.cos(rad(a)) * lw, -Math.sin(rad(a)) * lw]; this.poly([[n[0], n[1], 0], [e[0] + n[0], e[1] + n[1], 0], [e[0] - n[0], e[1] - n[1], 0], [-n[0], -n[1], 0]], '#fff'); }
    for (const [x, y] of [[63.6, 63.6], [0, 127.3], [-63.6, 63.6]]) this.poly([[x - 1.5, y - 1.5, 0.1], [x + 1.5, y - 1.5, 0.1], [x + 1.5, y + 1.5, 0.1], [x - 1.5, y + 1.5, 0.1]], '#fff');
    if (plate) this.poly([[-0.7, 0, 0.1], [0.7, 0, 0.1], [0.7, 0.7, 0.1], [0, 1.4, 0.1], [-0.7, 0.7, 0.1]], '#fff');
    const cs = crowdFor(look);
    // the stands' front wall under the first row (the low fence is 5-10 ft, the first row starts 8 ft up): no sky shows through
    for (const [a0, a1] of STAND_RANGES(look)) {
      const as = range(a0, a1, 2.5), base: V3[] = [];
      for (const a of as) base.push([...pol(edgeDist(a) + 6, a), 0]);
      for (const a of [...as].reverse()) base.push([...pol(edgeDist(a) + 6, a), 8]);
      this.poly(base, L.stands[1]);
      this.poly(base, '#00000040');
    }
    for (let row = 9; row >= 0; row--) {
      for (const [a0, a1, rows] of STAND_RANGES(look)) {
        if (row >= rows) continue;
        const as = range(a0, a1, 2.5);
        const band: V3[] = [], face: V3[] = [];
        for (const a of as) band.push([...pol(edgeDist(a) + 6 + row * 7, a), 8 + row * 4.2]);
        for (const a of [...as].reverse()) band.push([...pol(edgeDist(a) + 13 + row * 7, a), 12 + row * 4.2]);
        this.poly(band, L.stands[row % 2]);
        for (const a of as) face.push([...pol(edgeDist(a) + 6 + row * 7, a), 8 + row * 4.2]);
        for (const a of [...as].reverse()) face.push([...pol(edgeDist(a) + 6 + row * 7, a), 4 + row * 4.2]);
        this.poly(face, '#00000030');
      }
      // only the figures inside the view are drawn; in wide shots every other row and nothing too small to see (plan 44 budget)
      if (!cs || (cam.fov > 45 && row % 2)) continue;
      for (const s of cs.seats) {
        if (s[4] !== row) continue;
        const b = this.proj(s[0], s[1], s[2]); if (!b || b[0] < -20 || b[0] > W + 20 || b[1] < -20 || b[1] > H + 40) continue;
        const hgt = (6 * this.f) / b[2]; if (hgt < 3) continue;
        const wdt = (hgt * FW) / FH;
        c.drawImage(cs.img, s[3] * FW * 2, 0, FW * 2, FH * 2, b[0] - wdt / 2, b[1] - hgt, wdt, hgt);
      }
    }
    // scoreboard: high above the center-field stands; in 1901 a small hand board standing on the right-center fence
    const sb: [number, number, number, number] = look === '1901' ? [...pol(wallDist(18) + 1, 18), 11, 24] as never : [0, wallDist(0) + 90, 52, 82];
    const sw = look === '1901' ? 16 : 35, rot = look === '1901' ? 18 : 0;
    const sbp = (dx: number, z: number): V3 => { const r = (rot * Math.PI) / 180; return [sb[0] + dx * Math.cos(r), sb[1] - dx * Math.sin(r), z]; };
    { const q: V3[] = [sbp(-sw, sb[2]), sbp(sw, sb[2]), sbp(sw, sb[3]), sbp(-sw, sb[3])];
      this.poly(q, L.board === 'lit' ? '#111' : '#21402c', '#ddd', 1);
      const tl = this.proj(...sbp(-sw, sb[3])), br = this.proj(...sbp(sw, sb[2]));
      if (tl && br && br[1] - tl[1] > 14) { const w = br[0] - tl[0], h = br[1] - tl[1];   // digits only when big enough to read
        c.font = `${Math.max(4, h * 0.22)}px ${L.board === 'lit' ? 'monospace' : 'Georgia, serif'}`; c.textAlign = 'center';
        for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) { const cx = tl[0] + w * (0.08 + i * 0.105), cy = tl[1] + h * (0.38 + j * 0.38);
          if (L.board === 'lit') c.fillStyle = '#ffb33a'; else { c.fillStyle = '#f4f0e6'; c.fillRect(cx - w * 0.035, cy - h * 0.2, w * 0.07, h * 0.27); c.fillStyle = '#111'; }
          c.fillText((i * 3 + j) % 4 === 0 ? '1' : '0', cx, cy); } } }
    for (let a = -115; a < 115; a += 2.5) {
      const d0 = edgeDist(a), d1 = edgeDist(a + 2.5), p0 = pol(d0, a), p1 = pol(d1, a + 2.5);
      const fair = Math.abs(a + 1.25) <= 45, h = fair ? 10 : 5;
      this.poly([[...p0, 0], [...p1, 0], [...p1, h], [...p0, h]], fair ? L.wall : '#5b4a3a');
      this.poly([[...p0, h], [...p1, h], [...p1, h + 0.6], [...p0, h + 0.6]], L.wallTop);
      if (+look <= 1920 && fair) for (let k = 0; k < 2; k++) { const pp = pol(lerp(d0, d1, k / 2), a + k * 1.25); this.poly([[pp[0] - 0.15, pp[1], 0], [pp[0] + 0.15, pp[1], 0], [pp[0] + 0.15, pp[1], h], [pp[0] - 0.15, pp[1], h]], '#00000040'); }
    }
    c.textAlign = 'center';
    const lift = look === '1901' ? 2 : 0;   // 1901: signs sit higher so the standing fans do not hide them
    for (const [t, a] of SIGNS[look]) {
      const d = wallDist(a) - 0.3, l = pol(d, a - 3.2), r = pol(d, a + 3.2);
      this.poly([[...l, 2.2 + lift], [...r, 2.2 + lift], [...r, 8 + lift], [...l, 8 + lift]], +look <= 1920 ? '#efe3c4' : '#fff', '#222', 0.5);
      const m = this.proj(...pol(d, a), 4.4 + lift);
      if (m) { const sz = (3.6 * this.f) / m[2]; if (sz > 5) { c.font = `700 ${sz}px ${+look <= 1956 ? 'Georgia, serif' : 'Arial, sans-serif'}`; c.fillStyle = +look <= 1920 ? '#3b2a17' : '#14325c'; c.fillText(t, m[0], m[1]); } }
    }
    if (look === '1901' && cs) {   // the rope, then the standing fans in front of the fence
      const rope = range(-34, 34, 2).map(a => pol(wallDist(a) - 14, a));
      for (let i = 0; i + 1 < rope.length; i++) this.poly([[...rope[i], 3], [...rope[i + 1], 3], [...rope[i + 1], 3.25], [...rope[i], 3.25]], '#d9cfb8');
      for (const s of cs.seats) {
        if (s[4] !== -1) continue;
        const b = this.proj(s[0], s[1], 0); if (!b || b[0] < -20 || b[0] > W + 20 || b[1] < -20 || b[1] > H + 40) continue;
        const hgt = (5.6 * this.f) / b[2]; if (hgt < 3) continue;
        c.drawImage(cs.img, s[3] * FW * 2, 0, FW * 2, FH * 2, b[0] - (hgt * FW) / FH / 2, b[1] - hgt, (hgt * FW) / FH, hgt);
      }
    }
    for (const a of L.markers) { const d = Math.round(wallDist(a)); const m = this.proj(...pol(d - 0.3, a), 4); if (m) { const sz = (5 * this.f) / m[2]; if (sz < 5) continue; c.font = `700 ${sz}px Arial, sans-serif`; c.fillStyle = '#fff'; c.fillText(String(d), m[0], m[1]); } }
  }
}

// ---- Plan 59 Round 1b: backdrops behind the windup and the side view, drawn once and cached ----
export type BackdropView = 'side' | 'windup';
/** Where a backdrop's camera sits on the stage: camera, focal length and center, in CSS px of the stage. */
export interface BackdropPlace { cam: Camera; f: number; cx: number; cy: number; }
const backdrops = new Map<string, HTMLCanvasElement>();
const BACKDROP_KEEP = 8;
/** The static park for one view into an offscreen canvas at the stage's size x density (capped at 2), cached by look,
 *  view, side, size and density (Last Licks reuses it across at-bats). Null when there is no canvas (jsdom). */
export function renderBackdrop(look: ParkLook, view: BackdropView, side: 'L' | 'R', cssW: number, cssH: number, dpr: number, place: BackdropPlace): HTMLCanvasElement | null {
  const k = Math.min(2, Math.max(1, dpr || 1));
  const key = `${look}|${view}|${side}|${cssW}x${cssH}|${k}`;
  const have = backdrops.get(key);
  if (have) { backdrops.delete(key); backdrops.set(key, have); return have; }
  if (typeof document === 'undefined' || cssW <= 0 || cssH <= 0) return null;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(cssW * k)); cv.height = Math.max(1, Math.round(cssH * k));
  let g: CanvasRenderingContext2D | null = null;
  try { g = cv.getContext('2d'); } catch { g = null; }
  if (!g) return null;
  g.setTransform(k, 0, 0, k, 0, 0);
  new ParkPainter(g).backdrop(look, place.cam, cssW, cssH, place.f, place.cx, place.cy, view !== 'side');
  backdrops.set(key, cv);
  while (backdrops.size > BACKDROP_KEEP) backdrops.delete(backdrops.keys().next().value!);
  try { performance.measure(`pr-backdrop-${view}`, { start: t0 }); } catch { /* perf log only (test 11) */ }
  return cv;
}
