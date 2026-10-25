import { SideLook } from './art';
import { Call, OutcomeKey, PlayFacts } from './logic';

// Plan 44 (v4.2): follow the ball at field level. Pure logic, no Angular, no canvas.
// Feet. Home plate at (0, 0); y points to center field, x to right field. pol(d, a): a = degrees from center, + toward right.
// The camera sits 20 ft behind the plate, 10 ft up, and turns, tilts and zooms with the ball.

export type Pos = 'P' | 'C' | '1B' | '2B' | 'SS' | '3B' | 'LF' | 'CF' | 'RF';
export type XY = [number, number];
/** Fielder sheet frames (art/sprites/fielder, tools/slice-fielders.py). */
export const FR = { ready: 0, run: 1, high: 2, scoop: 3, throw: 4, stretch: 5, catcherUp: 6, catcherCatch: 7 } as const;

export const CAM = { x: 0, y: -20, z: 10 };
export const MAX_TURN = 100, MAX_TILT = 75, MIN_FOV = 22, START_FOV = 70;

const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const cl = (u: number) => Math.max(0, Math.min(1, u));
export const ease = (u: number) => { u = cl(u); return u * u * (3 - 2 * u); };
export const pol = (d: number, a: number): XY => [d * Math.sin(rad(a)), d * Math.cos(rad(a))];
export const dist = (p: XY, q: XY) => Math.hypot(p[0] - q[0], p[1] - q[1]);
/** Distance and angle of a point from home. */
export const polar = (p: XY): [number, number] => [Math.hypot(p[0], p[1]), deg(Math.atan2(p[0], p[1]))];

/** Fair wall: lines 330, alleys 375, center 400. */
export function wallDist(a: number): number {
  const t = Math.abs(a);
  if (t >= 22) return 375 + ((330 - 375) * (t - 22)) / 23;
  return 400 + ((375 - 400) * (1 - Math.cos((Math.PI * t) / 22))) / 2;
}
/** The field's edge all the way round: the fair wall, then the foul-side fence curving in toward home. */
export function edgeDist(a: number): number {
  const t = Math.abs(a);
  return t <= 45 ? wallDist(a) : lerp(330, 75, ease((t - 45) / 70));
}
export const BASE1: XY = [63.6, 63.6], BASE2: XY = [0, 127.3], BASE3: XY = [-63.6, 63.6];

/** Starting spots (distance, angle). 1901 and 1920 looks: outfielders 40 ft shallower. */
export function startOf(p: Pos, look: SideLook): XY {
  const of = look === '1901' || look === '1920' ? 40 : 0;
  switch (p) {
    case 'P': return [0, 60];
    case 'C': return [0, -5];
    case '1B': return pol(110, 33);
    case '2B': return pol(145, 13);
    case 'SS': return pol(148, -12);
    case '3B': return pol(115, -32);
    case 'LF': return pol(295 - of, -27);
    case 'CF': return pol(320 - of, 0);
    case 'RF': return pol(295 - of, 27);
  }
}
/** Catch zones (angle range, distance range) for outs. */
export const ZONE: Record<Pos, { a: [number, number]; d: [number, number] }> = {
  P: { a: [-12, 12], d: [40, 80] }, C: { a: [-180, 180], d: [0, 60] }, '1B': { a: [20, 75], d: [60, 150] },
  '2B': { a: [0, 30], d: [90, 180] }, SS: { a: [-30, 0], d: [90, 180] }, '3B': { a: [-75, -20], d: [60, 150] },
  LF: { a: [-60, -10], d: [150, 400] }, CF: { a: [-20, 20], d: [180, 410] }, RF: { a: [10, 60], d: [150, 400] },
};

export function stream(prefix: string, seed: string): () => number {
  let h = 2166136261;
  for (const ch of `${prefix}:${seed}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A piece of the ball's path. h = height in feet; peak adds a parabola; bounce adds hops; roll eases out. */
export interface Seg { t0: number; t1: number; a: XY; b: XY; h0: number; h1: number; peak?: number; bounce?: number; bh?: number; roll?: boolean; }
export interface Move { t0: number; t1: number; to: XY; frame: number; after: number; }
export interface FielderPlan { pos: Pos; start: XY; frame: number; moves: Move[]; }
export type PlayKind = 'hr' | 'itp' | 'xbh' | 'single' | 'fly' | 'line' | 'pop' | 'foul' | 'ground' | 'dp' | 'force' | 'error';
export interface ParkPlay {
  kind: PlayKind; look: SideLook; len: number; segs: Seg[]; fielders: FielderPlan[];
  /** Where a fly ball will come down (faint mark on the grass), or null. */
  mark: XY | null;
  /** Pops and fouls straight back: the camera does not turn. */
  noTurn: boolean;
  /** The fielder named in the call (or the one chasing a hit), or null on a home run with nobody near. */
  named: Pos | null;
  /** Where the ball is caught, fielded or picked up (first touch). */
  touch: XY | null; touchT: number;
  /** Real seconds per scene second (never below 1). */
  speed: number;
}
export interface ParkInput { outcome: OutcomeKey; call: Call; play: PlayFacts | null; seed: string; look: SideLook; }

/** Fixed scene lengths (s) by play [H-nit, Y1, Z3]. */
export const LEN = { groundSingle: 1.6, ground: 2.0, dp: 2.4, lineOF: 1.6, lineIF: 1.0, fly: 2.2, pop: 2.6, xbh: 2.2, hr: 2.4, itp: 2.2 };
// Real speeds (ft/s): batted ground ball, line drive, infield and outfield throws, a fielder running.
const V = { ground: 95, line: 125, throwIF: 120, throwOF: 105, run: 27 };

/** Only plays put in play get a park view: hits, outs in play (including foul outs) with a call that has a trajectory. */
export function hasPark(outcome: OutcomeKey, call: Call | null): boolean {
  if (!call?.trajectory) return false;
  return outcome === 'single' || outcome === 'double' || outcome === 'triple' || outcome === 'hr' || outcome === 'oip';
}

/** Same reading of the call text as pbp.callDetail() (copied: pbp imports pitch-scene, which imports this file). */
export function callDetail(c: Call): { deep: boolean; where: 'line' | 'corner' | 'gap' | 'over' | null } {
  const t = c.text;
  const where = /down the [a-z]+-field line/.test(t) ? 'line' : /corner/.test(t) ? 'corner' : /gap/.test(t) ? 'gap' : /center fielder's head/.test(t) ? 'over' : null;
  return { deep: / deep /.test(` ${t} `) && c.type === 'fly', where };
}

/** Middle infielders field and catch on the dirt (expert: deeper than 142 ft reads as outfield grass from the low camera). */
const MID_IF = 142;
const SPOT_A: Record<string, number> = { left: -32, 'left-center': -18, center: 0, 'right-center': 18, right: 32 };
const isOF = (p: Pos) => p === 'LF' || p === 'CF' || p === 'RF';
const isIF = (p: Pos) => !isOF(p) && p !== 'C';
const toPos = (s: string | undefined, fb: Pos): Pos => (['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'].includes(s ?? '') ? s as Pos : fb);
/** Height of the stands at a distance beyond the edge (rows rise 4.2 ft every 7 ft). */
export function standHeight(a: number, d: number): number {
  const beyond = d - edgeDist(a) - 6;
  return beyond <= 0 ? 10 : 8 + Math.min(9, beyond / 7) * 4.2;
}

export function buildPlay(inp: ParkInput): ParkPlay {
  const r = stream('cam', inp.seed);
  const u = (lo: number, hi: number) => lerp(lo, hi, r());
  const c = inp.call, look = inp.look, det = callDetail(c);
  const spotA = SPOT_A[c.spot ?? 'center'] ?? 0;
  const ofFor = (a: number): Pos => {   // the outfielder for a ball at angle a (gaps by the stream)
    if (a <= -24) return 'LF';
    if (a >= 24) return 'RF';
    if (a < -8) return r() < 0.5 ? 'LF' : 'CF';
    if (a > 8) return r() < 0.5 ? 'RF' : 'CF';
    return 'CF';
  };
  const HOME: XY = [0, 2];
  const base = (p: Pos) => ({ pos: p, start: startOf(p, look), frame: p === 'C' ? FR.catcherUp : FR.ready, moves: [] as Move[] });
  /** Fielder runs to a spot, arriving at tArrive (scene s) at real running speed x speed-up, never leaving before 0.1 s. */
  const runTo = (f: FielderPlan, from: XY, to: XY, tArrive: number, s: number, frame: number, after: number) => {
    const need = dist(from, to) / (V.run * s);
    const t0 = Math.max(0.1, tArrive - need);
    f.moves.push({ t0: Math.min(t0, tArrive - 0.05), t1: tArrive, to, frame, after });
  };
  const play = (kind: PlayKind, len: number, speed: number, segs: Seg[], fielders: FielderPlan[], named: Pos | null, touch: XY | null, touchT: number,
    mark: XY | null = null, noTurn = false): ParkPlay => ({ kind, look, len, speed, segs, fielders, named, touch, touchT, mark, noTurn });
  const hold = (p: XY, h: number, t0: number, len: number): Seg => ({ t0, t1: len, a: p, b: p, h0: h, h1: h });

  // ---- hits ----
  if (inp.outcome === 'hr' && !c.insideTheParkHr) {
    // lands well into the seats (expert: 10 ft past the wall read as off the wall)
    const a = Math.max(-42, Math.min(42, spotA + u(-4, 4))), d = wallDist(a) + u(25, 60), land = pol(d, a);
    // 1901: open outfield with no stands, so the ball is still clearing the fence when the scene ends
    const h = look === '1901' && Math.abs(a) < 35 ? 16 : standHeight(a, d);
    const s = 2.3, tl = 1.95;
    const of = ofFor(a), f = base(of), watch = pol(wallDist(a) - 5, a + (a > 0 ? -2 : 2));
    runTo(f, f.start, watch, Math.min(1.7, tl - 0.2), s, FR.run, FR.ready);
    return play('hr', LEN.hr, s, [{ t0: 0, t1: tl, a: HOME, b: land, h0: 3, h1: h, peak: u(85, 110) }, hold(land, h, tl, LEN.hr)], [f], of, null, tl, land);
  }
  if (inp.outcome === 'double' || inp.outcome === 'triple' || (inp.outcome === 'hr' && c.insideTheParkHr)) {
    const itp = inp.outcome === 'hr';
    const len = itp ? LEN.itp : LEN.xbh, s = itp ? 4 : 3;
    let a: number;
    const side = spotA < 0 ? -1 : spotA > 0 ? 1 : (r() < 0.5 ? -1 : 1);
    if (itp || det.where === 'gap' || (det.where === null && c.spot !== 'left' && c.spot !== 'right' && c.spot !== 'center')) a = side * u(14, 21);
    else if (det.where === 'over' || c.spot === 'center') a = u(-6, 6);
    else a = side * u(38, 43);   // corner or down the line
    const low = c.trajectory === 'line';
    const wall = wallDist(a), bounce = pol(wall - u(25, 50), a), atWall = pol(wall - 2, a + side * u(0.5, 2)), pick = pol(wall - 8, a + side * u(0, 1.5));
    const t1 = 0.75, t2 = 1.3, t3 = Math.min(len - 0.45, 1.75);
    const of = det.where === 'over' || Math.abs(a) < 8 ? 'CF' : Math.abs(a) > 30 ? (a < 0 ? 'LF' : 'RF') : ofFor(a);
    const f = base(of);
    runTo(f, f.start, [pick[0] - 1, pick[1] - 1.5], t3, s, FR.run, FR.scoop);
    return play(itp ? 'itp' : 'xbh', len, s, [
      { t0: 0, t1, a: HOME, b: bounce, h0: 3, h1: 0, peak: low ? u(14, 22) : u(30, 55) },
      { t0: t1, t1: t2, a: bounce, b: atWall, h0: 0, h1: 0, roll: true, bounce: 2, bh: 5 },
      { t0: t2, t1: t3, a: atWall, b: pick, h0: 0, h1: 0, roll: true },
      hold(pick, 2.5, t3, len)], [f], of, pick, t3);
  }
  if (inp.outcome === 'single') {
    const len = LEN.groundSingle, s = 2, tp = 1.35;
    if (c.trajectory === 'ground') {
      const hole = c.spot === 'left' || c.spot === 'left-center' ? u(-27, -19) : c.spot === 'center' ? u(-3, 3) : u(19, 27);
      const of = ofFor(hole), f = base(of);
      const pick = pol(u(215, 245), hole + u(-2, 2));
      runTo(f, f.start, [pick[0], pick[1] + 2], tp, s, FR.run, FR.scoop);
      return play('single', len, s, [{ t0: 0, t1: tp, a: HOME, b: pick, h0: 2, h1: 0.5, bounce: 4, bh: 4, roll: true }, hold(pick, 1.5, tp, len)], [f], of, pick, tp);
    }
    const bloop = c.trajectory === 'bloop';
    // the call says "to left" / "into right" for left-center and right-center, so the corner outfielder takes it
    const of: Pos = c.spot === 'left' || c.spot === 'left-center' ? 'LF' : c.spot === 'center' ? 'CF' : 'RF', f = base(of);
    const [sd, sa] = polar(f.start);
    const land = pol(bloop ? u(165, 200) : sd - u(35, 65), sa + u(-6, 6));
    const tLand = bloop ? 1.0 : 0.7;
    const pick = pol(polar(land)[0] + u(8, 18), polar(land)[1]);
    runTo(f, f.start, [pick[0], pick[1] + 2], tp, s, FR.run, FR.scoop);
    return play('single', LEN.lineOF, s, [
      { t0: 0, t1: tLand, a: HOME, b: land, h0: 3, h1: 0, peak: bloop ? u(30, 40) : u(8, 14) },
      { t0: tLand, t1: tp, a: land, b: pick, h0: 0, h1: 0.5, roll: true, bounce: 1, bh: 3 }, hold(pick, 1.5, tp, LEN.lineOF)], [f], of, pick, tp, bloop ? land : null);
  }

  // ---- outs in play ----
  const fielderName = toPos(c.fielder, c.type === 'fly' ? 'CF' : 'SS');
  const zoneAngle = (p: Pos, a: number) => Math.max(ZONE[p].a[0] + 2, Math.min(ZONE[p].a[1] - 2, a));
  if (c.type === 'fly') {
    const f = base(fielderName), [sd, sa] = polar(f.start);
    const a = zoneAngle(fielderName, lerp(sa, spotA, 0.5) + u(-5, 5));
    const wall = wallDist(a);
    const d = det.deep ? wall - u(5, 40) : Math.min(wall - 45, sd + u(-45, 20));
    const at = pol(d, a), tc = 1.95, s = 2.2;
    runTo(f, f.start, [at[0], at[1] - 1], tc - 0.1, s, FR.run, FR.high);
    return play('fly', LEN.fly, s, [{ t0: 0, t1: tc, a: HOME, b: at, h0: 3, h1: 8, peak: det.deep ? u(95, 115) : u(75, 100) }, hold(at, 8, tc, LEN.fly)],
      [f], fielderName, at, tc, at);
  }
  if (c.type === 'pop' || c.type === 'foul') {
    const p = fielderName === 'P' ? 'SS' : fielderName;   // the pitcher never catches a pop [X-pop]
    const f = base(p);
    let at: XY, noTurn = false;
    if (p === 'C') {
      if (r() < 0.55) { at = [u(-6, 6), -u(5, 15)]; noTurn = true; }       // straight back, in front of the camera
      else { const side = r() < 0.5 ? -1 : 1; at = [side * u(25, 55), u(-15, 8)]; }   // drifting toward a dugout
    } else if (c.type === 'foul') {
      const side = p === '1B' || p === 'RF' ? 1 : -1;
      at = isOF(p) ? pol(u(185, 255), side * u(47, 53)) : pol(u(70, 115), side * u(50, 60));
    } else {
      const [sd, sa] = polar(f.start);
      at = pol(Math.max(30, sd + u(-25, 10)), zoneAngle(p, sa + u(-10, 10)));
    }
    const ofFoul = c.type === 'foul' && isOF(p);
    const len = ofFoul ? LEN.fly : LEN.pop, tc = len - 0.2, s = ofFoul ? 2.2 : 2.3;
    runTo(f, f.start, [at[0], at[1] - (p === 'C' ? 0 : 1)], tc - 0.15, s, p === 'C' ? FR.catcherUp : FR.run, p === 'C' ? FR.catcherUp : FR.high);
    const h = p === 'C' ? 5 : 7.5;
    return play(c.type === 'foul' ? 'foul' : 'pop', len, s, [{ t0: 0, t1: tc, a: HOME, b: at, h0: 3, h1: h, peak: ofFoul ? u(70, 95) : u(110, 150) }, hold(at, h, tc, len)],
      [f], p, at, tc, at, noTurn);
  }
  if (c.type === 'line') {
    const f = base(fielderName), [sd, sa] = polar(f.start);
    const dp = !!inp.play?.doublePlay;
    if (isOF(fielderName)) {
      const at = pol(sd - u(20, 55), sa + u(-6, 6)), tc = 1.3, s = 1.7;
      runTo(f, f.start, [at[0], at[1] - 1], tc - 0.05, s, FR.run, FR.high);
      return play('line', LEN.lineOF, s, [{ t0: 0, t1: tc, a: HOME, b: at, h0: 3, h1: 6, peak: u(6, 12) }, hold(at, 6, tc, LEN.lineOF)], [f], fielderName, at, tc);
    }
    const at = pol(Math.max(45, Math.min(MID_IF, sd + u(-8, 4))), sa + u(-4, 4)), h = u(4.5, 7), tc = Math.min(0.75, Math.max(0.35, polar(at)[0] / V.line));
    f.moves.push({ t0: 0.1, t1: tc, to: [at[0], at[1] - 1], frame: FR.high, after: FR.high });
    if (!dp) return play('line', LEN.lineIF, 1, [{ t0: 0, t1: tc, a: HOME, b: at, h0: 3, h1: h, peak: u(2, 5) }, hold(at, h, tc, LEN.lineIF)], [f], fielderName, at, tc);
    // lined into a double play: doubled off first
    const len = LEN.lineOF, s = 1.4, segs: Seg[] = [{ t0: 0, t1: tc, a: HOME, b: at, h0: 3, h1: h, peak: u(2, 5) }];
    const fs = [f];
    const bag: XY = [BASE1[0] - 1, BASE1[1] + 1];
    if (fielderName === '1B') {
      const tb = tc + 0.45;
      f.moves.push({ t0: tc + 0.05, t1: tb, to: [BASE1[0] + 1, BASE1[1] + 1], frame: FR.run, after: FR.stretch });
      segs.push({ t0: tc, t1: tb, a: at, b: bag, h0: h, h1: 4 }, hold(bag, 4, tb, len));
    } else {
      const tt = tc + 0.15, ta = tt + dist(at, bag) / (V.throwIF * s);
      f.moves.push({ t0: tc + 0.02, t1: tt, to: [at[0], at[1] - 1], frame: FR.throw, after: FR.throw });
      const fb = base('1B'); runTo(fb, fb.start, [BASE1[0] + 1, BASE1[1] + 1.5], ta - 0.1, s, FR.run, FR.stretch); fs.push(fb);
      segs.push(hold(at, h, tc, tt), { t0: tt, t1: ta, a: at, b: bag, h0: 6, h1: 5, peak: 3 }, hold(bag, 5, ta, len));
    }
    return play('dp', len, s, segs, fs, fielderName, at, tc);
  }

  // ground balls: ground out, force out, double play, error
  const g = isIF(fielderName) ? fielderName : 'SS';
  const f = base(g), [sd, sa] = polar(f.start);
  const field: XY = g === 'P' ? pol(u(52, 64), u(-7, 7)) : pol(Math.min(MID_IF, sd - u(0, 12)), sa + u(-5, 5));
  const dp = !!inp.play?.doublePlay, force = !!inp.play?.forceRunner && !dp, err = c.type === 'error';
  const s = dp ? 1.8 : 1.5, len = dp ? LEN.dp : LEN.ground;
  const tf = Math.min(0.85, Math.max(0.3, polar(field)[0] / (V.ground * s)));
  runTo(f, f.start, [field[0] + 1.2, field[1] + 1.8], tf, s, FR.run, FR.scoop);
  const segs: Seg[] = [{ t0: 0, t1: tf, a: HOME, b: field, h0: 2, h1: 0.5, bounce: 3, bh: 5 }];
  if (err) {   // the ball gets past him and rolls on 15-40 ft
    // the ball gets through him and rolls on behind (expert: 0-5 degrees off his line)
    const [fd, fa] = polar(field), past = pol(fd + u(25, 40), fa + (r() < 0.5 ? -1 : 1) * u(0, 1.5)), te = Math.min(len - 0.2, tf + 0.6);
    segs.push({ t0: tf, t1: te, a: field, b: past, h0: 0.5, h1: 0, roll: true, bounce: 1, bh: 1.5 }, hold(past, 0, te, len));
    return play('error', len, s, segs, [f], g, field, tf);
  }
  const fs = [f];
  const tt = tf + 0.15;   // transfer, then the throw from where he fielded it
  const throwTo = (from: XY, to: XY, t0: number) => t0 + dist(from, to) / (V.throwIF * s);
  const bag1: XY = [BASE1[0] - 1, BASE1[1] + 1], bag2: XY = [BASE2[0] + 1, BASE2[1] - 1.5];
  if (force || dp) {
    // who covers second: 6-4-3 and 5-4-3 the second baseman; 4-6-3, 3-6-3, 1-6-3 (and any force from that side) the shortstop
    const cov: Pos = g === 'SS' || g === '3B' ? '2B' : 'SS';
    const fc = base(cov); fs.push(fc);
    const ta = throwTo(field, bag2, tt);
    runTo(fc, fc.start, [bag2[0] + (cov === '2B' ? 1.5 : -1.5), bag2[1]], ta - 0.08, s, FR.run, FR.stretch);
    f.moves.push({ t0: tf + 0.02, t1: tt, to: [field[0] + 1.2, field[1] + 1.8], frame: FR.throw, after: FR.throw });
    segs.push(hold(field, 1, tf, tt), { t0: tt, t1: ta, a: field, b: bag2, h0: 4, h1: 5, peak: 2 });
    if (force) { segs.push(hold(bag2, 5, ta, len)); return play('force', len, s, segs, fs, g, field, tf); }
    const t2 = ta + 0.12, tb = throwTo(bag2, bag1, t2);
    fc.moves.push({ t0: ta + 0.02, t1: t2, to: [bag2[0] + (cov === '2B' ? 1.5 : -1.5), bag2[1]], frame: FR.throw, after: FR.throw });
    const fb = g === '1B' ? f : base('1B');
    if (g === '1B') f.moves.push({ t0: tt + 0.05, t1: tb - 0.08, to: [BASE1[0] + 1, BASE1[1] + 1.5], frame: FR.run, after: FR.stretch });   // 3-6-3: back to the bag
    else { runTo(fb, fb.start, [BASE1[0] + 1, BASE1[1] + 1.5], tb - 0.1, s, FR.run, FR.stretch); fs.push(fb); }
    segs.push(hold(bag2, 5, ta, t2), { t0: t2, t1: tb, a: bag2, b: bag1, h0: 5, h1: 5, peak: 4 }, hold(bag1, 5, tb, len));
    return play('dp', len, s, segs, fs, g, field, tf);
  }
  if (g === '1B') {
    if (r() < 0.5) {   // he steps on the bag himself
      const tb = tf + dist(field, BASE1) / (V.run * s) + 0.05;
      f.moves.push({ t0: tf + 0.05, t1: tb, to: [BASE1[0] + 1, BASE1[1] + 1], frame: FR.run, after: FR.stretch });
      segs.push({ t0: tf, t1: tb, a: field, b: [BASE1[0], BASE1[1] + 1], h0: 1, h1: 3 }, hold([BASE1[0], BASE1[1] + 1], 3, tb, len));
      return play('ground', len, s, segs, fs, g, field, tf);
    }
    const fp = base('P'); fs.push(fp);   // flips to the pitcher covering first
    const ta = tt + dist(field, bag1) / (60 * s);
    runTo(fp, fp.start, [BASE1[0] - 2, BASE1[1] + 2], ta - 0.05, s, FR.run, FR.high);
    f.moves.push({ t0: tf + 0.02, t1: tt, to: [field[0] + 1.2, field[1] + 1.8], frame: FR.throw, after: FR.throw });
    segs.push(hold(field, 1, tf, tt), { t0: tt, t1: ta, a: field, b: bag1, h0: 3, h1: 5, peak: 3 }, hold(bag1, 5, ta, len));
    return play('ground', len, s, segs, fs, g, field, tf);
  }
  const ta = throwTo(field, bag1, tt);
  const fb = base('1B'); fs.push(fb);
  runTo(fb, fb.start, [BASE1[0] + 1, BASE1[1] + 1.5], ta - 0.1, s, FR.run, FR.stretch);
  f.moves.push({ t0: tf + 0.02, t1: tt, to: [field[0] + 1.2, field[1] + 1.8], frame: FR.throw, after: FR.throw });
  segs.push(hold(field, 1, tf, tt), { t0: tt, t1: ta, a: field, b: bag1, h0: 4, h1: 5, peak: 4 }, hold(bag1, 5, ta, len));
  return play('ground', len, s, segs, fs, g, field, tf);
}

/** Ball position (x, y, height) at scene time t. */
export function ballAt(p: ParkPlay, t: number): [number, number, number] {
  let s = p.segs[0];
  for (const x of p.segs) if (t >= x.t0) s = x;
  const u = cl((t - s.t0) / Math.max(1e-6, s.t1 - s.t0)), uu = s.roll ? 1 - (1 - u) * (1 - u) : u;
  let h = lerp(s.h0, s.h1, u) + (s.peak ?? 0) * 4 * u * (1 - u);
  if (s.bounce) h += Math.abs(Math.sin(u * Math.PI * s.bounce)) * (s.bh ?? 0) * (1 - u);
  return [lerp(s.a[0], s.b[0], uu), lerp(s.a[1], s.b[1], uu), Math.max(0, h)];
}

/** Fielder spot and sheet frame at scene time t. */
export function fielderAt(f: FielderPlan, t: number): { at: XY; frame: number; moving: boolean } {
  let at = f.start, frame = f.frame;
  for (const m of f.moves) {
    if (t >= m.t1) { at = m.to; frame = m.after; continue; }
    if (t > m.t0) { const u = (t - m.t0) / (m.t1 - m.t0); return { at: [lerp(at[0], m.to[0], u), lerp(at[1], m.to[1], u)], frame: m.frame, moving: m.frame === FR.run }; }
    break;
  }
  return { at, frame, moving: false };
}

/** Camera like a TV operator: turn to the ball's bearing, tilt to its height, zoom with distance. fov = horizontal degrees. */
export interface Camera { yaw: number; pitch: number; fov: number; }
export function cameraAt(p: ParkPlay, t: number, aspect: number): Camera {
  const b = ballAt(p, t);
  const bx = b[0] - CAM.x, by = b[1] - CAM.y, d = Math.hypot(bx, by);
  const bearing = deg(Math.atan2(bx, by)), elev = deg(Math.atan2(b[2] - CAM.z, Math.max(0.5, d)));
  const k = ease(t / 0.2);
  let fov = lerp(START_FOV, Math.max(MIN_FOV, lerp(START_FOV, MIN_FOV, cl((d - 40) / 360))), ease(t / 0.6));   // gentler zoom: shallow plays keep grass in front of the wall
  fov = Math.min(80, Math.max(fov, (Math.max(elev, 0) + 9) / 0.6));
  const hHalf = fov / 2, vHalf = deg(Math.atan(Math.tan(rad(fov / 2)) / aspect));
  // turn smoothly toward the ball, but never let it get closer than 30% of the half-frame to the edge
  let yaw = lerp(0, bearing, k);
  yaw = Math.max(bearing - hHalf * 0.7, Math.min(bearing + hHalf * 0.7, yaw));
  yaw = p.noTurn ? 0 : Math.max(-MAX_TURN, Math.min(MAX_TURN, yaw));
  // aim between the ball and the top of the wall; on high balls keep the ball well inside the top of the frame
  const want = Math.max(Math.max(elev, 0) * 0.58 - 1, elev - vHalf * 0.6);
  let pitch = lerp(-3, want, k);
  pitch = Math.max(elev - vHalf * 0.7, Math.min(elev + vHalf * 0.7, pitch));
  pitch = Math.min(MAX_TILT, Math.max(-6, pitch));
  return { yaw, pitch, fov };
}

/** Camera-space point: [right, forward, up]. */
export function toCam(cam: Camera, x: number, y: number, z: number): [number, number, number] {
  const rx = x - CAM.x, ry = y - CAM.y, rz = z - CAM.z;
  const yw = rad(cam.yaw), sy = Math.sin(yw), cy = Math.cos(yw);
  const dx = rx * cy - ry * sy, dy = rx * sy + ry * cy;
  const pt = rad(cam.pitch), sp = Math.sin(pt), cp = Math.cos(pt);
  return [dx, cp * dy + sp * rz, -sp * dy + cp * rz];
}
export const NEAR = 1;
/** Screen point (W x H units) and depth, or null behind the camera. */
export function project(cam: Camera, W: number, H: number, x: number, y: number, z = 0): [number, number, number] | null {
  const v = toCam(cam, x, y, z);
  if (v[1] < NEAR) return null;
  const f = W / 2 / Math.tan(rad(cam.fov) / 2);
  return [W / 2 + (v[0] / v[1]) * f, H / 2 - (v[2] / v[1]) * f, v[1]];
}
