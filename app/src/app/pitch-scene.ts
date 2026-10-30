import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { Era, FielderArt, SideArt, SideLook, WindupArt } from './art';
import { BallparkView } from './ballpark-view';
import { Call, countFor, Deco, finalCaption, FinalKind, OutcomeKey, PITCH_CAPTION, PitchKind, PlayFacts, Trajectory } from './logic';
import { buildPlay, hasPark, ParkPlay } from './park';
import { FielderSheet } from './park-draw';
import { parkOn } from './park-setting';

// Plan 32C: side-on pitch scene. Batter only, seen from the first-base side (right-handed) or the third-base side
// (left-handed: the whole panel is mirrored). Units are panel units: 760 x 480, x grows toward the pitcher.
// Cell units of the art (520 x 480) map to panel units by x - 60. Rules: planning/33-MOTION-PHYSICS-REVIEW.md.

export type Motion = 'hit' | 'miss' | 'take' | 'hbp' | 'out' | 'look' | 'foul' | 'tip';

/** Which animation plays for the final pitch. */
export function motionFor(o: OutcomeKey, finalKind: FinalKind | null = null): Motion {
  switch (o) {
    case 'k': return finalKind === 'called' ? 'look' : finalKind === 'tip' ? 'tip' : 'miss';
    case 'bb': return 'take';
    case 'hbp': return 'hbp';
    case 'oip': return 'out';
    default: return 'hit';
  }
}

/** Animation for a lead-up pitch in the count. */
export function leadMotion(k: PitchKind): Motion {
  return k === 'ball' ? 'take' : k === 'called' ? 'look' : k === 'swinging' ? 'miss' : 'foul';
}

export const PANEL_W = 760, PANEL_H = 480, CELL_X0 = 60, FOOT_Y = 470;
export const PLATE_X = 240;            // plate centre (cell x 300)
export const ENTER_X = 770;            // just past the pitcher's edge
export const BALL_D = 16;              // a baseball is about 18 units at this scale; drawn a touch smaller
/** Strike zone at the plate (knee hollow to mid-chest) and the bat line on the contact frame. */
export const ZONE_TOP = 205, ZONE_BOTTOM = 360;

export type PitchType = 'fast' | 'slider' | 'change' | 'curve';
/** Seconds from the pitcher's edge to the plate (curve about 1.25 x the fastball). */
export const PITCH_TIME: Record<PitchType, number> = { fast: 0.30, slider: 0.33, change: 0.36, curve: 0.375 };
/** Visible drop in the last third, units [min, max]. */
const DROP: Record<PitchType, [number, number]> = { fast: [0, 6], slider: [15, 25], change: [20, 30], curve: [35, 50] };
/** Downward angle of the straight part, degrees [min, max]. */
const ANGLE: Record<PitchType, [number, number]> = { fast: [4, 6], slider: [6, 8], change: [7, 9], curve: [8, 11] };

/** Timeline of one pitch (seconds). Lead-up pitches use a short version. */
export interface Timeline { enter: number; end: number; }
export const FINAL_TL: Timeline = { enter: 0.5, end: 1.9 };
export const LEAD_TL: Timeline = { enter: 0.2, end: 0.95 };

function stream(prefix: string, seed: string): () => number {
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
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const rad = (d: number) => (d * Math.PI) / 180;

/** Decoration-only random numbers for one pitch (stream p1; never touches counts or calls). */
export function pitchRand(seed: string, index: number): number[] {
  const r = stream('p1', `${seed}:${index}`);
  return Array.from({ length: 8 }, () => r());
}

/** Pitch type by the pitcher's era (sliders rare before 1950). */
export function pitchTypeFor(rnd: number, era: Era): PitchType {
  const early = era === '1901-1919' || era === '1920-1945';
  if (early) return rnd < 0.68 ? 'fast' : rnd < 0.73 ? 'slider' : rnd < 0.86 ? 'change' : 'curve';
  return rnd < 0.55 ? 'fast' : rnd < 0.75 ? 'slider' : rnd < 0.88 ? 'change' : 'curve';
}

export interface Pt { x: number; y: number; }
/** Where the pitch crosses the plate, by what happens to it. */
export function pitchTarget(m: Motion, kind: 'ball' | 'strike' | null, r: number[], contact: Pt): Pt {
  switch (m) {
    case 'hit': case 'out': case 'foul': case 'tip': return contact;
    case 'miss': return r[2] < 0.35 ? { x: PLATE_X, y: lerp(135, 165, r[3]) } : { x: PLATE_X, y: lerp(305, 345, r[3]) };
    case 'hbp': return r[2] < 0.5 ? { x: 190, y: 195 } : { x: 205, y: 300 };   // front shoulder or front hip
    case 'look': return { x: PLATE_X, y: lerp(ZONE_TOP + 12, ZONE_BOTTOM - 12, r[3]) };
    default: return kind === 'strike' ? { x: PLATE_X, y: lerp(ZONE_TOP + 12, ZONE_BOTTOM - 12, r[3]) }
      : r[2] < 0.05 ? { x: PLATE_X, y: lerp(110, 130, r[3]) }                    // rare one up at the head
      : r[2] < 0.5 ? { x: PLATE_X, y: lerp(175, 198, r[3]) }                     // most high balls just above the zone
      : r[2] < 0.9 ? { x: PLATE_X, y: lerp(368, 395, r[3]) } : { x: PLATE_X, y: lerp(420, 440, r[3]) };   // just below the knee, a few in the dirt
  }
}

export interface Pitch { type: PitchType; target: Pt; start: Pt; drop: number; tPlate: number; tTarget: number; tSwing: number; enter: number; }
/** The pitch path, worked back from its target; start clamped to y 20 or lower so it always enters from the side. */
export function makePitch(m: Motion, kind: 'ball' | 'strike' | null, r: number[], era: Era, contact: Pt, tl: Timeline): Pitch {
  const type = pitchTypeFor(r[0], era);
  const target = pitchTarget(m, kind, r, contact);
  const drop = lerp(DROP[type][0], DROP[type][1], r[4]);
  let ang = lerp(ANGLE[type][0], ANGLE[type][1], r[5]);
  const dx = ENTER_X - target.x;
  let sy = target.y - dx * Math.tan(rad(ang)) - drop;
  if (sy < 20) { ang = Math.max(0, Math.atan((target.y - drop - 20) / dx) * 180 / Math.PI); sy = target.y - dx * Math.tan(rad(ang)) - drop; }
  const speed = (ENTER_X - PLATE_X) / PITCH_TIME[type];
  return { type, target, start: { x: ENTER_X, y: sy }, drop, tPlate: tl.enter + PITCH_TIME[type], tTarget: tl.enter + dx / speed,
    tSwing: tl.enter + (ENTER_X - contact.x) / speed, enter: tl.enter };
}

/** Ball on the incoming path at time t (may run past the target toward the catcher's edge). */
export function pitchAt(p: Pitch, t: number): Pt {
  const dur = p.tTarget - p.enter;
  const u = (t - p.enter) / dur;                       // 0 at entry, 1 at target, >1 beyond
  const x = lerp(p.start.x, p.target.x, u);
  const lineY = lerp(p.start.y, p.target.y - p.drop, u);
  const late = clamp01((u - 2 / 3) * 3);               // drop shows in the last third, keeps going after
  const dropNow = p.drop * (u <= 1 ? late * late : 1 + (u - 1) * 2);
  return { x, y: lineY + dropNow };
}

export interface BallPos { x: number; y: number; d: number; o: number; }
const HIDDEN: BallPos = { x: 0, y: 0, d: 0, o: 0 };

/** Flight after contact, by trajectory. Angles up from flat toward the pitcher; 90+ = up and back. */
export interface Flight { kind: Trajectory | 'tip' | 'leadFoul' | 'hbpDrop'; angle: number; time: number; bounceX?: number; depth: number; }
export function makeFlight(tr: Trajectory | null, m: Motion, isFinal: boolean, hr: boolean, itp: boolean, deep: boolean, depth: number, r: number[]): Flight {
  const a = (lo: number, hi: number) => lerp(lo, hi, r[6]);
  if (m === 'tip') return { kind: 'tip', angle: 180 + a(3, 6), time: 0.3, depth: 0 };
  if (!isFinal && m === 'foul') return r[7] < 0.6 ? { kind: 'leadFoul', angle: a(120, 155), time: 0.3, depth: 0 } : { kind: 'leadFoul', angle: 180 - a(2, 6), time: 0.3, depth: 0 };
  switch (tr) {
    case 'ground': return { kind: 'ground', angle: -20, time: 0.3, bounceX: lerp(500, 580, r[7]), depth };
    case 'line': return itp ? { kind: 'line', angle: a(12, 18), time: 0.3, depth } : { kind: 'line', angle: a(10, 22), time: 0.3, depth };
    case 'bloop': return { kind: 'bloop', angle: a(25, 35), time: 0.4, depth };
    case 'pop': return { kind: 'pop', angle: a(60, 80), time: 0.4, depth };
    case 'foul': return { kind: 'foul', angle: depth === 0 ? a(95, 120) : a(50, 75), time: 0.4, depth };
    default:
      if (hr) return { kind: 'fly', angle: a(26, 30), time: 0.25, depth };
      if (deep) return { kind: 'fly', angle: a(30, 38), time: 0.3, depth };   // doubles and triples in the air
      return { kind: 'fly', angle: a(40, 50), time: 0.35, depth };
  }
}

/** Ball after contact at s seconds past contact. Returns null once it has left the panel. */
export function flightAt(f: Flight, from: Pt, s: number): BallPos | null {
  if (s < 0) return null;
  const grow = (u: number) => BALL_D * (1 + f.depth * 0.3 * u);   // depth -1 far side shrinks, +1 near side grows
  const u = s / f.time;
  if (f.kind === 'ground') {
    const bx = f.bounceX ?? 540, t1 = 0.4;   // 40% of the time to reach the dirt, the rest skimming out
    if (u <= t1) { const v = u / t1; return { x: lerp(from.x, bx, v), y: lerp(from.y, FOOT_Y - BALL_D / 2, v * v), d: grow(u), o: 1 }; }
    const v = (u - t1) / (1 - t1);
    const x = lerp(bx, PANEL_W + 30, v);
    const hop = Math.sin(Math.min(1, v * 1.6) * Math.PI) * 26;   // one low hop after the bounce
    const p = { x, y: FOOT_Y - BALL_D / 2 - hop, d: grow(u), o: 1 };
    return x > PANEL_W + 20 ? null : p;
  }
  if (f.kind === 'bloop') {
    const vx = (PANEL_W + 30 - from.x) / f.time, vy = Math.tan(rad(f.angle)) * vx, g = (2 * vy) / (f.time * 0.75);
    const p = { x: from.x + vx * s, y: from.y - vy * s + 0.5 * g * s * s, d: grow(u), o: 1 };
    return p.x > PANEL_W + 20 ? null : p;
  }
  if (f.kind === 'hbpDrop') {
    const v = clamp01(u);
    return u > 1 ? null : { x: from.x - 60 * v, y: lerp(from.y, FOOT_Y - BALL_D / 2, Math.min(1, v * 1.6)), d: BALL_D, o: 1 - Math.max(0, v - 0.6) / 0.4 };
  }
  // straight lines: speed set so the ball reaches the edge it is aimed at in the stated time
  const dx = Math.cos(rad(f.angle)), dy = -Math.sin(rad(f.angle));
  const toX = dx > 1e-6 ? (PANEL_W + 30 - from.x) / dx : dx < -1e-6 ? (-30 - from.x) / dx : Infinity;
  const toY = dy < -1e-6 ? (-30 - from.y) / dy : dy > 1e-6 ? (FOOT_Y - from.y) / dy : Infinity;
  const dist = Math.min(toX, toY);
  const v = dist / f.time;
  const p = { x: from.x + dx * v * s, y: from.y + dy * v * s, d: grow(u), o: 1 };
  return s > f.time ? null : p;
}

/** Which edge a finished flight left by: 'pitcher', 'catcher', 'top' or 'dirt'. */
export function exitEdge(f: Flight, from: Pt): string {
  let last: BallPos | null = null;
  for (let s = 0; s <= f.time + 0.001; s += 0.005) { const p = flightAt(f, from, s); if (p) last = p; }
  if (!last) return 'none';
  if (last.y < 20) return 'top';
  if (last.x > PANEL_W - 30) return 'pitcher';
  if (last.x < 30) return 'catcher';
  return 'dirt';
}

/** Depth cue for a fair or foul ball: +1 near side of the field (grows), -1 far side (shrinks), 0 none. */
export function depthFor(call: Call | null, bats: 'L' | 'R'): number {
  if (!call) return 0;
  const leftField = call.spot ? call.spot === 'left' || call.spot === 'left-center' : call.fielder ? ['3B', 'LF', 'SS'].includes(call.fielder) : null;
  const rightField = call.spot ? call.spot === 'right' || call.spot === 'right-center' : call.fielder ? ['1B', 'RF', '2B'].includes(call.fielder) : null;
  if (!leftField && !rightField) return 0;
  // camera on the first-base side for a right-handed batter: left field is far
  const far = bats === 'R' ? !!leftField : !!rightField;
  return far ? -1 : 1;
}

/** Batter frame at time t. Frames: 0 stance, 1 load, 3 contact, 4 follow, 5 flinch, 6 hit by pitch, 7 drops bat. */
export function batterFrame(m: Motion, p: Pitch, t: number, isFinal: boolean, highBall: boolean): number {
  if (p.enter < 0.1) { if (t < p.enter + 0.06) return 2; }   // plan 36: after a windup cut he is already striding
  else {
    if (t < p.enter - 0.3) return 0;
    if (t < p.enter) return 1;                     // leg kick before the ball appears
    if (t < p.enter + 0.06) return 2;              // foot down, hands back as it appears
  }
  switch (m) {
    case 'hit': case 'out': case 'foul': case 'tip': case 'miss':
      return t < p.tSwing - 0.03 ? 2 : t < p.tSwing + 0.12 ? 3 : 4;
    case 'hbp':
      return t < p.tTarget ? 2 : !isFinal || t < p.tTarget + 0.45 ? 6 : 7;
    default: {   // take, look
      if (t < p.tPlate + 0.08) return 2;
      if (isFinal && m === 'take') return t < p.tPlate + 0.45 ? (highBall ? 5 : 0) : 7;   // ball four: drops the bat
      return highBall && t < p.tPlate + 0.4 ? 5 : 0;
    }
  }
}

// ---- Effects ----
export interface FxLine { x1: number; y1: number; x2: number; y2: number; o: number; }
export interface FxWord { lines: string[]; x: number; y: number; size: number; rot: number; scale: number; o: number; fill: string; }
export interface Fx { lines: FxLine[]; burst?: { x: number; y: number; points: string; o: number }; word?: FxWord; shake: number; smear?: { d: string; o: number }[]; }
export const FX_NONE: Fx = { lines: [], shake: 0 };
export const BURST_S = 0.12;   // the contact frame shows from tSwing - 0.03 to tSwing + 0.12

/** The word for the final pitch, or null (outs and bloop singles get none). */
export function fxWord(o: OutcomeKey, m: Motion, tr: Trajectory | null, itp: boolean): string[] | null {
  switch (o) {
    case 'k': return m === 'look' ? ['STRIKE', 'THREE!'] : ['WHIFF!'];
    case 'bb': return ['BALL FOUR'];
    case 'hbp': return ['OUCH!'];
    case 'hr': return itp ? ['CRACK!'] : ['GONE!'];
    case 'oip': return null;
    default: return tr === 'bloop' ? null : ['CRACK!'];
  }
}

/** Solid contact gets the starburst: hits except bloops, outs except pops; never fouls or tips. */
export function solidContact(m: Motion, tr: Trajectory | null): boolean {
  if (m === 'hit') return tr !== 'bloop';
  if (m === 'out') return tr !== 'pop' && tr !== 'foul';
  return false;
}

export function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI * 2 * i) / 24 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r * (i % 4 ? 0.8 : 1);
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Ink lines behind the ball: start at its back edge and point back along its path (plan 31 v2.3 style). */
export function trail(cur: BallPos, prev: Pt, o = 1): FxLine[] {
  const dx = cur.x - prev.x, dy = cur.y - prev.y, len = Math.hypot(dx, dy);
  if (len < 0.5 || cur.o <= 0) return [];
  const vx = dx / len, vy = dy / len, nx = -vy, ny = vx, r = cur.d / 2;
  return [-0.6, 0, 0.6].map(k => {
    const back = Math.sqrt(1 - k * k) * r;
    const l = Math.min(60, Math.max(22, r * 3.2)) * (k === 0 ? 1 : 0.75);
    const sx = cur.x - vx * (back + 1.5) + nx * r * k, sy = cur.y - vy * (back + 1.5) + ny * r * k;
    return { x1: sx, y1: sy, x2: sx - vx * l, y2: sy - vy * l, o };
  });
}

// ---- The whole pitch on one clock ----
export interface Frame { ball: BallPos; batter: number; fx: Fx; }
export interface PitchSetup {
  m: Motion; kind: 'ball' | 'strike' | null; isFinal: boolean; outcome: OutcomeKey; era: Era; bats: 'L' | 'R';
  call: Call | null; contact: Pt; seed: string; index: number;
  /** Plan 36: windup before this pitch (the side view starts with the ball entering). */
  windup?: boolean;
  /** Plan 36: bat tip on frame 2 (start of the swing smear), panel units. */
  tip?: Pt;
}
export interface Plan { p: Pitch; f: Flight | null; tl: Timeline; r: number[]; s: PitchSetup; highBall: boolean; exitT: number; }

/** Plan 36/39: the pitcher's windup (front-view sheet frames: set, hands up, kick, peak, stride, cock, release).
 *  Plan 39: peak (leg up) and release hold a little longer, the in-betweens are shorter; the total stays 0.6 s. */
export const WINDUP: [number, number][] = [[0, 0.07], [1, 0.07], [2, 0.10], [3, 0.17], [4, 0.08], [5, 0.05], [6, 0.06]];
/** Plan 39: the next pose fades in over the last 30 ms of each pose (half the pose at most); release cuts to the side view. */
export const WINDUP_FADE = 0.03;
export interface WindupBlend { base: number; next: number | null; top: number; }
export function windupBlendAt(t: number): WindupBlend {
  let acc = 0;
  for (let i = 0; i < WINDUP.length; i++) {
    const [f, d] = WINDUP[i];
    const end = acc + d;
    if (t < end) {
      if (i === WINDUP.length - 1) return { base: f, next: null, top: 0 };   // release: nothing fades in
      const fade = Math.min(WINDUP_FADE, d / 2);
      const top = Math.min(1, Math.max(0, (t - (end - fade)) / fade));
      return { base: f, next: WINDUP[i + 1][0], top };
    }
    acc = end;
  }
  return { base: 6, next: null, top: 0 };
}
export const WINDUP_S = WINDUP.reduce((a, [, d]) => a + d, 0);
export function windupFrameAt(t: number): number {
  let acc = 0;
  for (const [f, d] of WINDUP) { acc += d; if (t < acc) return f; }
  return 6;
}
/** Side-view timeline after a windup cut: the ball is already entering. */
export function windupTimeline(isFinal: boolean): Timeline {
  const base = isFinal ? FINAL_TL : LEAD_TL;
  return { enter: 0.03, end: base.end - (base.enter - 0.03) };
}
export const SMEAR_BEFORE = 0.08, SMEAR_AFTER = 0.05;
/** Comic swing smear: three ink arcs along the barrel's path, from just past the hands to the contact point. */
export function smearPaths(tip: Pt, c: Pt): string[] {
  const q = (u: number, a: Pt, k: Pt, b: Pt) => ({ x: (1 - u) * (1 - u) * a.x + 2 * u * (1 - u) * k.x + u * u * b.x, y: (1 - u) * (1 - u) * a.y + 2 * u * (1 - u) * k.y + u * u * b.y });
  return [-14, 0, 14].map(off => {
    // the bat comes around level: from behind his back shoulder at bat height to the contact point, bowing slightly up
    const a = { x: tip.x, y: c.y - 35 + off }, b = { x: c.x, y: c.y + off * 0.6 };
    const k = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 28 + off * 0.3 };
    const s0 = q(0.35, a, k, b), k2 = q(0.7, a, k, b);
    return `M${s0.x.toFixed(1)} ${s0.y.toFixed(1)} Q${k2.x.toFixed(1)} ${k2.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  });
}

export function planPitch(s: PitchSetup): Plan {
  const tl = s.windup ? windupTimeline(s.isFinal) : s.isFinal ? FINAL_TL : LEAD_TL;
  const r = pitchRand(s.seed, s.index);
  const p = makePitch(s.m, s.kind, r, s.era, s.contact, tl);
  const tr = s.call?.trajectory ?? null;
  let f: Flight | null = null;
  if (s.m === 'hit' || s.m === 'out' || s.m === 'foul' || s.m === 'tip') {
    const deep = s.outcome === 'double' || s.outcome === 'triple';
    f = makeFlight(tr, s.m, s.isFinal, s.outcome === 'hr', !!s.call?.insideTheParkHr, deep, depthFor(s.call, s.bats), r);
  } else if (s.m === 'hbp') f = { kind: 'hbpDrop', angle: 0, time: 0.5, depth: 0 };
  const highBall = (s.m === 'take' || s.m === 'look') && p.target.y < 140;   // flinch only at a pitch up at the head
  // when the ball is gone (for the word): flight end, or the pitch leaving the catcher's edge
  let exitT = tl.end;
  if (f) exitT = p.tTarget + f.time;
  else { const v = (ENTER_X - PLATE_X) / PITCH_TIME[p.type]; exitT = p.tPlate + (PLATE_X + 30) / v; }
  return { p, f, tl, r, s, highBall, exitT };
}

export function frameAt(pl: Plan, t: number): Frame {
  const { p, f, s } = pl;
  const batter = batterFrame(s.m, p, t, s.isFinal, pl.highBall);
  if (t >= pl.tl.end) return { ball: HIDDEN, batter, fx: FX_NONE };
  let ball: BallPos = HIDDEN, prev: Pt | null = null;
  if (t >= p.enter && (!f || t < p.tTarget)) {
    const c = pitchAt(p, t);
    // Stephen 2026-10-22: a pitch he does not hit carries on in front of him and leaves the screen on the catcher's side
    // (drawn over him: it crosses the plate, nearer the camera than he is). No fade part way across his body.
    const fade = c.x > -20 ? 1 : 0;
    if (fade > 0) { ball = { ...c, d: BALL_D, o: fade }; prev = pitchAt(p, Math.max(p.enter, t - 0.03)); }
  } else if (f && t >= p.tTarget) {
    const cur = flightAt(f, p.target, t - p.tTarget);
    if (cur) { ball = cur; prev = flightAt(f, p.target, Math.max(0, t - p.tTarget - 0.03)) ?? p.target; }
  }
  if (f?.kind === 'tip' && t >= p.tTarget) {
    // a foul tip carries on past the bat on almost the same line
    const dir = rad(f.angle), v = (ENTER_X - PLATE_X) / PITCH_TIME[p.type], s2 = t - p.tTarget;
    const x = p.target.x + Math.cos(dir) * v * s2, y = p.target.y - Math.sin(dir) * v * s2;
    const fo = x > -20 ? 1 : 0;
    ball = fo > 0 ? { x, y, d: BALL_D, o: fo } : HIDDEN;
    prev = { x: p.target.x + Math.cos(dir) * v * Math.max(0, s2 - 0.03), y: p.target.y - Math.sin(dir) * v * Math.max(0, s2 - 0.03) };
  }
  const fx: Fx = { lines: ball.o > 0 && prev && t > p.enter + 0.03 ? trail(ball, prev) : [], shake: 0 };
  const swing = s.m === 'hit' || s.m === 'out' || s.m === 'foul' || s.m === 'tip' || s.m === 'miss';
  if (swing && s.tip && t >= p.tSwing - SMEAR_BEFORE && t < p.tSwing + SMEAR_AFTER) {
    const o = t < p.tSwing ? 0.9 : 0.9 * (1 - (t - p.tSwing) / SMEAR_AFTER);
    fx.smear = smearPaths(s.tip, s.contact).map(d => ({ d, o }));
  }
  const tr = s.call?.trajectory ?? null;
  if (solidContact(s.m, tr) && s.isFinal && t >= p.tSwing - 0.03 && t < p.tSwing + BURST_S) {   // exactly while the contact frame shows
    const u = clamp01((t - p.tSwing + 0.03) / (BURST_S + 0.03));
    fx.burst = { x: p.target.x, y: p.target.y, points: starPoints(p.target.x, p.target.y, 44 + 14 * Math.min(1, u * 3)), o: 1 };
  }
  const word = wordAt(pl, t, pl.tl.end);
  if (word) fx.word = word;
  fx.shake = shakeAt(pl, t);
  return { ball, batter, fx };
}

/** The impact word at time t; it fades out at `end` (the side view's end, or the park view's end in plan 44). */
export function wordAt(pl: Plan, t: number, end: number): FxWord | undefined {
  const { p, s } = pl;
  const tr = s.call?.trajectory ?? null;
  const words = s.isFinal ? fxWord(s.outcome, s.m, tr, !!s.call?.insideTheParkHr) : null;
  const w0 = Math.max(p.tTarget + 0.2, pl.exitT + 0.02);
  if (!words || t < w0 || w0 >= end - 0.15) return undefined;
  const u = (t - w0) / 0.15;
  const longest = Math.max(...words.map(x => x.length));
  const size = Math.min(s.outcome === 'hr' ? 72 : 62, 290 / (longest * 0.66));
  return {
    lines: words, x: 175, y: words.length > 1 ? 385 : 418, size, rot: (pl.r[1] - 0.5) * 8,
    scale: u < 0.6 ? 0.6 + (u / 0.6) * 0.55 : u < 1 ? 1.15 - ((u - 0.6) / 0.4) * 0.15 : 1,
    o: t > end - 0.2 ? Math.max(0, (end - t) / 0.2) : 1, fill: s.outcome === 'hr' && !s.call?.insideTheParkHr ? '#ffd23f' : '#ffffff',
  };
}

/** Home-run and hit-by-pitch shake (px) at time t. */
export function shakeAt(pl: Plan, t: number): number {
  const { p, s } = pl;
  if (!s.isFinal || !((s.outcome === 'hr' && s.m === 'hit') || s.m === 'hbp')) return 0;
  const u = (t - p.tTarget) / 0.2;
  return u >= 0 && u < 1 ? Math.round(3 * Math.sin(u * Math.PI * 4) * (1 - u) * 100) / 100 : 0;
}

/** Plan 44: the park view takes over at the final pitch's plate time and runs for the play's fixed length. */
export interface ParkTiming { play: ParkPlay; tPark: number; end: number; }
export function parkTiming(pl: Plan, play: ParkPlay | null): ParkTiming | null {
  if (!play) return null;
  const tPark = pl.p.tPlate;
  return { play, tPark, end: Math.max(pl.tl.end, tPark + play.len) };
}
/** Fade-in of the park view over 120 ms. */
export const PARK_FADE = 0.12;

export function prefersReducedMotion(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Plan 59 Round 1b: how the 760 x 480 side panel sits in a stage of any size. One scale s (px per panel unit), the panel
 *  box's left/top in stage px, and the visible panel range x0..x1. The batter's side is anchored (left edge for righties,
 *  right edge for lefties, whose panel is mirrored); panel x 0-560 always shows; stages wider than the panel center it.
 *  The foot line sits at 92% of the stage height. */
export interface StageFit { s: number; left: number; top: number; x0: number; x1: number; }
export const STAGE_MIN_X = 560, STAGE_FOOT = 0.92, STAGE_BODY = 0.8;
export function stageFit(w: number, h: number, mirror: boolean): StageFit {
  const s = Math.min((h * STAGE_BODY) / PANEL_H, w / STAGE_MIN_X);
  const v = w / s;
  const x0 = v >= PANEL_W ? -(v - PANEL_W) / 2 : 0;
  const centered = (w - PANEL_W * s) / 2;
  const left = v >= PANEL_W ? centered : mirror ? w - PANEL_W * s : 0;
  return { s, left, top: STAGE_FOOT * h - FOOT_Y * s, x0, x1: x0 + v };
}

/** Side-on view of the whole at-bat: a short count for show, then the real result. */
/** Plan 42: index = pitch (leadUp.length = the final pitch). */
export interface SceneCue { index: number; final: boolean; moment: 'windup' | 'enter' | 'plate' | 'park' | 'end' | 'skipped'; }

@Component({
  selector: 'pr-pitch-scene',
  imports: [BallparkView],
  template: `
    @if (side(); as a) {
      <div class="stage" #stage [attr.data-cue]="lastCue()" [style.--hz]="fit() ? fit()!.top + 0.52 * 480 * fit()!.s + 'px' : null" [style.--dirt]="fit() ? fit()!.top + 0.92 * 480 * fit()!.s + 'px' : null">
      <div class="side" [class.mirror]="bats() === 'L'" [class.fit]="!!fit()" aria-hidden="true"
           [style.left.px]="fit()?.left" [style.top.px]="fit()?.top" [style.width.px]="fit() ? 760 * fit()!.s : null" [style.height.px]="fit() ? 480 * fit()!.s : null">
        <svg class="ground" viewBox="0 0 760 480" preserveAspectRatio="none">
          <path d="M175 474 L305 474 L318 466 L188 466 Z" fill="#fbf8f1" stroke="#2b2a28" stroke-width="2"/>
        </svg>
        <div class="shake" [style.transform]="frame().fx.shake ? 'translateX(' + frame().fx.shake + 'px)' : null">
          <div class="bat" [style.background-image]="'url(' + a.sheet + ')'" [style.--f]="frame().batter"></div>
          <svg class="fx" viewBox="0 0 760 480" preserveAspectRatio="none">
            @for (sm of frame().fx.smear ?? []; track $index) { <path [attr.d]="sm.d" [attr.opacity]="sm.o" fill="none" stroke="#1d1b19" stroke-width="3.5" stroke-linecap="round"/> }
            @if (frame().fx.burst; as b) { <polygon [attr.points]="b.points" [attr.opacity]="b.o" fill="#ffd23f" stroke="#1d1b19" stroke-width="3" stroke-linejoin="round"/> }
            @for (l of frame().fx.lines; track $index) { <line [attr.x1]="l.x1" [attr.y1]="l.y1" [attr.x2]="l.x2" [attr.y2]="l.y2" [attr.opacity]="l.o" stroke="#1d1b19" stroke-width="3.5" stroke-linecap="round"/> }
            @if (frame().ball.o > 0) { <circle class="ball" [attr.cx]="frame().ball.x" [attr.cy]="frame().ball.y" [attr.r]="frame().ball.d / 2" [attr.opacity]="frame().ball.o" fill="#fbf8f1" stroke="#2b2a28" stroke-width="2.5"/> }
          </svg>
        </div>
        @if (frame().fx.word; as w) {
          <svg class="words" viewBox="0 0 760 480" preserveAspectRatio="none">
            <g class="word" [attr.transform]="'translate(' + (bats() === 'L' ? 760 - w.x : w.x) + ' ' + w.y + ') rotate(' + w.rot + ') scale(' + w.scale + ')'" [attr.opacity]="w.o">
              <text text-anchor="middle" [attr.font-size]="w.size" [attr.fill]="w.fill" [attr.stroke-width]="w.size * 0.16">
                @for (line of w.lines; track $index) { <tspan x="0" [attr.dy]="$index === 0 ? (w.lines.length > 1 ? -w.size * 0.15 : w.size * 0.35) : w.size * 0.95">{{ line }}</tspan> }
              </text>
            </g>
          </svg>
        }
      </div>
      @if (park(); as pk) {
        <div class="park" aria-hidden="true" [style.opacity]="parkFade()" [style.transform]="parkShake() ? 'translateX(' + parkShake() + 'px)' : null">
          <pr-ballpark-view [play]="pk.play" [sheet]="sheet()" />
          @if (parkWord(); as w) {
            <svg class="words" viewBox="0 0 760 480" preserveAspectRatio="none">
              <g class="word" [attr.transform]="'translate(' + w.x + ' ' + w.y + ') rotate(' + w.rot + ') scale(' + w.scale + ')'" [attr.opacity]="w.o">
                <text text-anchor="middle" [attr.font-size]="w.size" [attr.fill]="w.fill" [attr.stroke-width]="w.size * 0.16">
                  @for (line of w.lines; track $index) { <tspan x="0" [attr.dy]="$index === 0 ? (w.lines.length > 1 ? -w.size * 0.15 : w.size * 0.35) : w.size * 0.95">{{ line }}</tspan> }
                </text>
              </g>
            </svg>
          }
        </div>
      }
      @if (windFrame() >= 0 && windup(); as w) {
        <div class="windup" aria-hidden="true">
          <div class="pit" [class.mirror]="w.mirror" [style.background-image]="'url(' + w.sheet + ')'" [style.--f]="windFrame()"></div>
          @if (windBlend().next !== null) {
            <div class="pit top" [class.mirror]="w.mirror" [style.background-image]="'url(' + w.sheet + ')'" [style.--f]="windBlend().next" [style.opacity]="windBlend().top"></div>
          }
        </div>
      }
      </div>
    }
    <div class="under">
      <span class="caption" [attr.aria-live]="quietCaption() ? 'off' : 'polite'"><span class="count" aria-label="Balls and strikes">{{ board().balls }}-{{ board().strikes }}</span>@if (board().caption && !quietCaption()) { · {{ board().caption }} }</span>
      <button type="button" class="skip" (click)="finish()">Skip to result</button>
    </div>
  `,
  styles: `
    :host { display: block; margin-top: 4px; }
    /* Plan 59 Round 1b: a tall stage (62 px keeps the 4 px margin and the 52 px caption and Skip row, plus 6 spare); the side panel sits inside it by stageFit. */
    .stage { position: relative; isolation: isolate; width: 100%; max-width: 900px; margin: 0 auto; height: min(calc(100cqh - 62px), 60dvh);
      overflow: hidden; border: 1px solid var(--border); border-radius: 14px; box-sizing: border-box;
      background: linear-gradient(#cfd9e3 0 var(--hz, 52%), #7d9a5f var(--hz, 52%) var(--dirt, 92%), #b48a5a var(--dirt, 92%) 100%); }
    .park { position: absolute; inset: 0; z-index: 4; overflow: hidden; background: #5c8a44; }
    .park .words { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
    .windup { position: absolute; inset: 0; z-index: 5; overflow: hidden;
      background: linear-gradient(#cfd9e3 0 58%, #7d9a5f 58% 100%); }
    .windup::after { content: ''; position: absolute; left: 25%; right: 25%; bottom: 0; height: 12%; border-radius: 50% 50% 0 0; background: #b48a5a; }
    .windup .pit { position: absolute; z-index: 1; height: 92%; aspect-ratio: 364 / 480; bottom: 4%; left: 50%; transform: translateX(-50%);
      background-repeat: no-repeat; background-size: 800% 100%; background-position: calc(var(--f, 0) * 100% / 7) 0; }
    .windup .pit.mirror { transform: translateX(-50%) scaleX(-1); }
    .windup .pit.top { z-index: 2; }
    .side { position: absolute; left: 0; bottom: 0; width: 100%; aspect-ratio: 760 / 480; transform-origin: center; }
    .side.fit { bottom: auto; aspect-ratio: auto; }
    .side.mirror { transform: scaleX(-1); }
    .side.mirror .words { transform: scaleX(-1); }
    .ground, .fx, .words { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .ground { z-index: 0; } .fx { z-index: 2; } .words { z-index: 3; }
    .shake { position: absolute; inset: 0; }
    .bat { position: absolute; z-index: 1; top: 0; height: 100%; left: calc(-60 / 760 * 100%); width: calc(520 / 760 * 100%);
      background-repeat: no-repeat; background-size: 800% 100%; background-position: calc(var(--f, 0) * 100% / 7) 0; }
    .words text { font-style: italic; font-weight: 900; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; letter-spacing: -.02em;
      stroke: #1d1b19; stroke-linejoin: round; paint-order: stroke; }
    .under { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 8px; }
    .caption { font-weight: 600; min-height: 1.2em; }
    .count { font: 600 1rem/1.2 ui-monospace, monospace; }
    /* Short landscape: the stage takes the full height on the left, caption and Skip in a 200 px column on the right. */
    @media (orientation: landscape) and (max-height: 500px) {
      :host { display: flex; gap: 14px; margin-top: 0; flex: 1 1 auto; min-height: 0; }
      .stage { flex: 1 1 auto; height: auto; min-width: 0; }
      .under { flex: none; width: 200px; margin-top: 0; flex-direction: column; align-items: stretch; justify-content: flex-start; }
    }
    .skip { font: inherit; font-size: .9rem; cursor: pointer; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); padding: 10px 16px; min-height: 44px; }
  `,
})
export class PitchScene {
  /** Pitcher's era (pitch types). */
  readonly era = input.required<Era>();
  readonly throws = input<string>('R');
  /** Side the batter hits from this at-bat (pass hitsFrom()). Left-handed batters mirror the whole panel. */
  readonly bats = input<string>('R');
  readonly outcome = input.required<OutcomeKey>();
  readonly seed = input<string>('');
  /** Plan 32A: decoration version (count and captions). */
  readonly deco = input<Deco>('1');
  /** Plan 32C: the batter's side-on sheet, already preloaded; null = text only. */
  readonly side = input<SideArt | null>(null);
  /** Plan 36/40: the pitcher's windup sheet, played before every pitch (only when the batter's side art shows too). */
  readonly windup = input<WindupArt | null>(null);
  protected readonly windFrame = signal(-1);
  /** Plan 39: the fading-in next pose over the current one (the bottom pose stays fully visible). */
  protected readonly windBlend = signal<WindupBlend>({ base: 0, next: null, top: 0 });
  /** Plan 21: the announcer call for the final pitch (trajectory and field). */
  readonly call = input<Call | null>(null);
  readonly done = output<void>();
  /** Plan 42: moments the announcer follows (fired in the same tick as the board update). */
  readonly cue = output<SceneCue>();
  /** Plan 59 Round 1b: the last cue's moment on the stage (data-cue), so browser tests can sample at each cue. No visible change. */
  protected readonly lastCue = signal<SceneCue['moment'] | null>(null);
  private emitCue(c: SceneCue) { this.lastCue.set(c.moment); this.cue.emit(c); }
  /** Plan 42: the announcer line replaces the short caption (count stays; caption no longer read aloud). */
  readonly quietCaption = input(false);
  /** Plan 44: fielder sheet for the pitcher's era (null = no park view). */
  readonly fielders = input<FielderArt | null>(null);
  /** Plan 44: the batter's look (park walls, crowd, signs). */
  readonly look = input<SideLook | null>(null);
  /** Plan 44: what the server decided about the play (inning and friend games; practice passes null). */
  readonly play = input<PlayFacts | null>(null);
  protected readonly park = signal<ParkTiming | null>(null);
  protected readonly parkFade = signal(0);
  protected readonly parkWord = signal<FxWord | null>(null);
  protected readonly parkShake = signal(0);
  private readonly parkView = viewChild(BallparkView);
  /** Plan 59 Round 1b: the stage's size (CSS px) from a ResizeObserver; null until measured (and in jsdom). */
  private readonly stageEl = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly stageSize = signal<[number, number] | null>(null);
  protected readonly fit = computed<StageFit | null>(() => {
    const z = this.stageSize();
    return z && z[0] > 0 && z[1] > 0 ? stageFit(z[0], z[1], this.bats() === 'L') : null;
  });
  private observed: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private watchStage() {
    const el = this.stageEl()?.nativeElement ?? null;
    if (el === this.observed) return;
    this.ro?.disconnect();
    this.observed = el;
    if (!el) return;
    const measure = () => { const w = el.clientWidth, h = el.clientHeight; const z = this.stageSize(); if (!z || z[0] !== w || z[1] !== h) this.stageSize.set([w, h]); };
    measure();
    if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(measure); this.ro.observe(el); }
  }
  private sheetImg: HTMLImageElement | null = null;
  protected readonly sheet = computed<FielderSheet>(() => {
    const f = this.fielders();
    return { img: this.sheetImg, cell: f?.cell ?? [360, 420], footY: f?.footY ?? 410, era: f?.era ?? this.era() };
  });
  /** Starts loading the fielder sheet with the at-bat; if it is not loaded by contact, fielders are drawn as silhouettes. */
  private loadSheet() {
    const f = this.fielders();
    if (!f || this.sheetImg || typeof Image === 'undefined') return;
    const img = new Image();
    img.src = f.sheet;
    this.sheetImg = img;
  }
  /** Plan 44: the park play for the final pitch, or null (not in play, no art, switched off). */
  private parkPlayFor(m: Motion): ParkPlay | null {
    const call = this.call(), look = this.look();
    if (!this.side() || !this.fielders() || !look || !call || !parkOn()) return null;
    if (m !== 'hit' && m !== 'out') return null;
    if (!hasPark(this.outcome(), call)) return null;
    return buildPlay({ outcome: this.outcome(), call, play: this.play(), seed: this.seed(), look });
  }

  protected readonly count = computed(() => countFor(this.outcome(), this.seed(), this.deco()));
  /** Index into the lead-up pitches; equal to their length means the final pitch. */
  protected readonly step = signal(0);
  protected readonly board = signal<{ balls: number; strikes: number; caption: string }>({ balls: 0, strikes: 0, caption: '' });
  protected readonly frame = signal<Frame>({ ball: HIDDEN, batter: 0, fx: FX_NONE });

  protected readonly isFinal = computed(() => this.step() >= this.count().leadUp.length);
  protected readonly motion = computed<Motion>(() => {
    const c = this.count();
    return this.isFinal() ? motionFor(this.outcome(), c.finalKind) : leadMotion(c.leadUp[this.step()].kind);
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private finished = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => { clearTimeout(this.timer); this.clearFrames(); this.ro?.disconnect(); });
    afterRenderEffect(() => this.watchStage());
    this.timer = setTimeout(() => (prefersReducedMotion() ? this.finish() : this.next()), 0);
  }

  private clearFrames() {
    if (this.raf) { (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout)(this.raf as never); this.raf = 0; }
  }

  private batTip(): Pt | undefined {
    const b = this.side()?.frames?.[2]?.batTip;
    return b ? { x: b[0] - CELL_X0, y: b[1] } : undefined;
  }

  private contactPoint(): Pt {
    const c = this.side()?.frames?.[3]?.contact;
    return c ? { x: c[0] - CELL_X0, y: c[1] } : { x: 372, y: 200 };
  }

  private runPitch(): { plan: Plan; end: number } {
    this.clearFrames();
    const final = this.isFinal(), m = this.motion();
    const lead = final ? null : this.count().leadUp[this.step()];
    const kind: 'ball' | 'strike' | null = lead ? (lead.kind === 'ball' ? 'ball' : 'strike') : this.outcome() === 'bb' ? 'ball' : null;
    const bats = this.bats() === 'L' ? 'L' : 'R';
    const plan = planPitch({ m, kind, isFinal: final, outcome: this.outcome(), era: this.era(), bats,
      call: final ? this.call() : null, contact: this.contactPoint(), seed: this.seed(), index: this.step(),
      windup: !!this.windup() && !!this.side(), tip: this.batTip() });
    const fin = final ? finalCaption(this.outcome(), this.count().finalKind, this.deco()) : '';
    const pk = final ? parkTiming(plan, this.parkPlayFor(m)) : null;
    if (pk) { this.sheet(); this.park.set(pk); }
    const end = pk ? pk.end : plan.tl.end;
    let cleared = false, called = false, parked = false;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
    const lead0 = plan.s.windup ? WINDUP_S : 0;
    const idx = this.step();
    if (plan.s.windup) this.emitCue({ index: idx, final, moment: 'windup' });
    const start = performance.now();
    const tick = () => {
      const el = (performance.now() - start) / 1000;
      if (el < lead0) { const wb = windupBlendAt(el); this.windBlend.set(wb); this.windFrame.set(wb.base); this.frame.set(frameAt(plan, 0)); if (!this.finished) this.raf = raf(tick); return; }
      this.windFrame.set(-1);
      const t = Math.min(end, el - lead0);
      if (this.side() && (!pk || t < pk.tPark)) this.frame.set(frameAt(plan, Math.min(plan.tl.end, t)));   // the side view holds its last frame under the park
      if (!cleared && t >= plan.p.enter) { cleared = true; this.board.update(b => ({ ...b, caption: '' })); this.emitCue({ index: idx, final, moment: 'enter' }); }
      if (!called && t >= plan.p.tPlate) {
        called = true;
        if (lead) this.board.set({ balls: lead.balls, strikes: lead.strikes, caption: PITCH_CAPTION[lead.kind] });
        else if (fin) this.board.update(b => ({ ...b, caption: fin }));
        this.emitCue({ index: idx, final, moment: 'plate' });
      }
      if (pk && t >= pk.tPark) {
        if (!parked) { parked = true; this.emitCue({ index: idx, final, moment: 'park' }); }
        const pt = t - pk.tPark;
        this.parkFade.set(Math.min(1, pt / PARK_FADE));
        this.parkView()?.draw(Math.min(pk.play.len, pt));
        this.parkWord.set(wordAt(plan, t, end) ?? null);
        this.parkShake.set(shakeAt(plan, t));
      }
      if (!this.finished && t < end) this.raf = raf(tick);
    };
    tick();
    return { plan, end };
  }

  private next() {
    if (this.finished) return;
    this.loadSheet();
    const { plan, end } = this.runPitch();
    const ms = (end + (plan.s.windup ? WINDUP_S : 0)) * 1000 + (this.isFinal() ? 0 : 60);
    if (this.isFinal()) { this.timer = setTimeout(() => this.finish(false), ms); return; }
    this.timer = setTimeout(() => {
      const p = this.count().leadUp[this.step()];
      this.board.set({ balls: p.balls, strikes: p.strikes, caption: this.board().caption || PITCH_CAPTION[p.kind] });
      this.step.update(i => i + 1);
      this.next();
    }, ms);
  }

  /** Ends the scene once, whether by timer or the Skip button (or reduced motion: skipped). */
  finish(skipped = true) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.clearFrames();
    const c = this.count();
    this.emitCue({ index: c.leadUp.length, final: true, moment: skipped ? 'skipped' : 'end' });
    this.done.emit();
  }
}
