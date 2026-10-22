import { isFirstVisit, windupArt, ArtManifest } from './art';
import { FINAL_TL, frameAt, LEAD_TL, planPitch, SMEAR_AFTER, SMEAR_BEFORE, WINDUP_S, windupFrameAt, windupTimeline, Motion } from './pitch-scene';

const C = { x: 220, y: 238 }, TIP = { x: 35, y: 102 };
const setup = (m: Motion, isFinal: boolean, windup: boolean) => planPitch({ m, kind: null, isFinal, outcome: 'single', era: '1990-2025', bats: 'R',
  call: { text: '', type: 'single', spot: 'center', trajectory: 'line' }, contact: C, seed: 's', index: 0, windup, tip: TIP });

describe('plan 36', () => {
  it('shows the first view only to new visitors with no link, and treats broken storage as seen', () => {
    const empty = { getItem: () => null }, seen = { getItem: () => '1' }, broken = { getItem: () => { throw new Error('private'); } };
    expect(isFirstVisit(false, empty)).toBe(true);
    expect(isFirstVisit(true, empty)).toBe(false);
    expect(isFirstVisit(false, seen)).toBe(false);
    expect(isFirstVisit(false, broken)).toBe(false);
    expect(isFirstVisit(false, null)).toBe(false);
  }, 30000);

  it('uses the pitcher windup only for a researched tone, mirrored for lefties', () => {
    const m = { tones: { p1: 'olive' }, sheets: { 'pitcher/1990-2025/light': '/p.webp' } } as unknown as ArtManifest;
    expect(windupArt(m, 'p1', '1990-2025', 'L')).toEqual({ sheet: '/p.webp', mirror: true });
    expect(windupArt(m, 'p1', '1990-2025', 'R')!.mirror).toBe(false);
    expect(windupArt(m, 'nobody', '1990-2025', 'R')).toBeNull();
  }, 30000);

  it('holds the kick and peak, and the windup adds about 0.43 s to a first pitch and 0.13 s to a final', () => {
    expect(WINDUP_S).toBeCloseTo(0.6, 5);
    expect(windupFrameAt(0.2)).toBe(2); expect(windupFrameAt(0.35)).toBe(3); expect(windupFrameAt(0.59)).toBe(6);
    expect(WINDUP_S + windupTimeline(false).end - LEAD_TL.end).toBeCloseTo(0.43, 2);
    expect(WINDUP_S + windupTimeline(true).end - FINAL_TL.end).toBeCloseTo(0.13, 2);
    const pl = setup('hit', true, true);
    expect(pl.p.enter).toBeCloseTo(0.03, 5);
    expect(frameAt(pl, 0.01).batter).toBe(2);   // already striding after the cut
  }, 30000);

  it('draws the swing smear only on swings, for at least 4 frames at 30 fps, ending at contact', () => {
    const pl = setup('hit', true, false);
    const shown = [...Array(300).keys()].map(i => i / 150).filter(t => !!frameAt(pl, t).fx.smear);
    expect(shown.length).toBeGreaterThanOrEqual(Math.floor((SMEAR_BEFORE + SMEAR_AFTER) * 30));
    expect(frameAt(pl, pl.p.tSwing - 0.01).fx.smear![1].d).toContain(`${C.x.toFixed(1)} ${C.y.toFixed(1)}`);
    const take = setup('take', false, false);
    expect([...Array(100).keys()].some(i => !!frameAt(take, i / 100).fx.smear)).toBe(false);
  }, 30000);
});
