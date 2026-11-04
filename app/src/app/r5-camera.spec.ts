// Plan 59 Round 5 (PLAN-2026-11-04-59-r5-camera-v3): center-field windup shot and fielder zoom.
import { ArtManifest, backArt, cfArt, cuArt, frontArt, SideLook } from './art';
import { Call, callFor, countFor, OutcomeKey, PlayFacts } from './logic';
import { ballAt, baseCameraAt, buildPlay, cameraAt, CF_BATTER_FT, cfLayout, fielderAt, ParkPlay, PITCHER_CELL_FT, project, RUBBER, toCam } from './park';
import { backdropKey } from './park-draw';

const LOOKS: SideLook[] = ['1901', '1920', '1956', '1990'];
const OUTS: PlayFacts[] = [
  { outType: 'ground', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'ground', doublePlay: true, sacFly: false, forceRunner: null },
  { outType: 'fly', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'fly', doublePlay: false, sacFly: true, forceRunner: null },
  { outType: 'line', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'line', doublePlay: true, sacFly: false, forceRunner: null },
  { outType: 'pop', doublePlay: false, sacFly: false, forceRunner: null },
  { outType: 'error', doublePlay: false, sacFly: false, forceRunner: null },
];
function plays(n: number): ParkPlay[] {
  const out: ParkPlay[] = [];
  for (let i = 0; i < n; i++) {
    const seed = `r5-${i}`, look = LOOKS[i % 4] as never, bats = i % 3 === 0 ? 'L' : 'R';
    for (const o of ['single', 'double', 'triple', 'hr'] as OutcomeKey[]) {
      const call = callFor(o, seed, countFor(o, seed, '1'), 'Babe Ruth', bats, 'R', '1', 1927);
      if (call.trajectory) out.push(buildPlay({ outcome: o, call, play: null, seed, look }));
    }
    const pf = OUTS[i % OUTS.length];
    const call: Call = callFor('oip', seed, countFor('oip', seed, '3'), 'Babe Ruth', bats, 'R', '3', 1927, pf);
    out.push(buildPlay({ outcome: 'oip', call, play: pf, seed, look }));
  }
  return out;
}
const MANY = plays(500);
const zoomed = (p: ParkPlay) => !!(p.named && p.named !== 'C' && p.touch && !p.noTurn && p.fielders.some(f => f.pos === p.named));

describe('plan 59 r5 test 3: center-field camera geometry (pure)', () => {
  for (const bats of ['R', 'L'] as const) {
    it(`bats ${bats}: rubber on the pitcher foot line, plate on the batter foot line, sizes from feet, batter on his side`, () => {
      const L = cfLayout(bats);
      // the pitcher's feet: projecting the rubber lands on the layout's pitcher foot point
      const cam = L.cam, r = toCam(cam, RUBBER.x, RUBBER.y, RUBBER.z);
      expect(Math.abs((r[0] / r[1]) * L.f - L.pitcher.x)).toBeLessThan(0.02);
      expect(Math.abs(-(r[2] / r[1]) * L.f - L.pitcher.y)).toBeLessThan(0.02);
      expect(Math.abs(L.pitcher.h - (PITCHER_CELL_FT * L.f) / r[1]) / L.pitcher.h).toBeLessThan(0.03);
      const b = toCam(cam, L.spot.batter.x, L.spot.batter.y, 0);
      expect(Math.abs(-(b[2] / b[1]) * L.f - L.batter.y)).toBeLessThan(0.02);
      expect(Math.abs(L.batter.h - (CF_BATTER_FT * L.f) / b[1]) / L.batter.h).toBeLessThan(0.03);
      // seen from center field a right-handed batter stands right of the plate; a lefty left of it
      const plate = toCam(cam, 0, 0.7, 0), px = (plate[0] / plate[1]) * L.f;
      if (bats === 'R') expect(L.batter.x).toBeGreaterThan(px); else expect(L.batter.x).toBeLessThan(px);
      // the pitcher sits on the other side of the frame, both on a portrait stage (0.75 wide per unit of height)
      expect(Math.sign(L.pitcher.x)).toBe(bats === 'R' ? -1 : 1);
      expect(Math.abs(L.batter.x) + 0.12).toBeLessThan(0.375);
      expect(Math.abs(L.pitcher.x) + 0.12).toBeLessThan(0.375);
      // the pitcher stands in front (bigger, lower)
      expect(L.pitcher.h).toBeGreaterThan(L.batter.h);
      expect(L.pitcher.y).toBeGreaterThan(L.batter.y);
    });
  }
  it('a lefty batter mirrors the righty layout', () => {
    const r = cfLayout('R'), l = cfLayout('L');
    for (const k of ['pitcher', 'batter', 'catcher', 'umpire'] as const) {
      expect(l[k].x).toBeCloseTo(-r[k].x, 6); expect(l[k].y).toBeCloseTo(r[k].y, 6); expect(l[k].h).toBeCloseTo(r[k].h, 6);
    }
  });
});

describe('plan 59 r5 test 4: fielder zoom (pure)', () => {
  const W = 480;
  it('named fielder in the middle third from touchT - 0.2 s to touchT, ball inside 70%, back to the base camera by touchT + 0.3 s', { timeout: 60_000 }, () => {
    const bad: string[] = [];
    let n = 0;
    for (const aspect of [0.75, 760 / 480]) {
      const w = W * aspect;
      for (const p of MANY) {
        if (!zoomed(p)) continue;
        n++;
        const fp = p.fielders.find(f => f.pos === p.named)!;
        for (const t of [p.touchT - 0.2, p.touchT - 0.1, p.touchT]) {
          if (t < 0) continue;
          const cam = cameraAt(p, t, aspect), f = fielderAt(fp, t), s = project(cam, w, W, f.at[0], f.at[1], 3);
          if (!s || s[0] < w / 3 || s[0] > (2 * w) / 3 || s[1] < W / 3 || s[1] > (2 * W) / 3) { bad.push(`${p.kind} ${aspect.toFixed(2)} t=${t.toFixed(2)} fielder ${s?.map(v => v.toFixed(0))}`); continue; }
          const b = ballAt(p, t), q = project(cam, w, W, b[0], b[1], b[2]);
          if (!q || Math.abs(q[0] - w / 2) > 0.7 * (w / 2) || Math.abs(q[1] - W / 2) > 0.7 * (W / 2)) bad.push(`${p.kind} ${aspect.toFixed(2)} t=${t.toFixed(2)} ball`);
        }
        const tb = Math.min(p.len, p.touchT + 0.3);
        if (tb < p.len) {
          const a = cameraAt(p, tb, aspect), b = baseCameraAt(p, tb, aspect);
          if (Math.abs(a.yaw - b.yaw) > 1e-9 || Math.abs(a.pitch - b.pitch) > 1e-9 || Math.abs(a.fov - b.fov) > 1e-9) bad.push(`${p.kind} not released`);
        }
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(bad.length, bad.slice(0, 8).join('; ')).toBe(0);
  });
  it('plays with no named fielder or a straight-back pop keep the base camera on every frame', () => {
    let n = 0;
    for (const p of MANY) {
      if (zoomed(p)) continue;
      n++;
      for (let i = 0; i <= Math.round(p.len * 30); i++) {
        const t = Math.min(p.len, i / 30);
        expect(cameraAt(p, t, 0.75)).toEqual(baseCameraAt(p, t, 0.75));
      }
    }
    expect(n).toBeGreaterThan(50);
  });
  it('before the zoom window the camera is the base camera', () => {
    for (const p of MANY.filter(zoomed).slice(0, 300)) {
      const t = p.touchT - 0.55;
      if (t > 0) expect(cameraAt(p, t, 0.75)).toEqual(baseCameraAt(p, t, 0.75));
    }
  });
});

const M = (over: Partial<ArtManifest> = {}): ArtManifest => ({
  cell: [364, 480], frames: 8, sheets: { 'pitcher/1990-2025/light': '/w.webp' }, cards: {},
  tones: { ruth: 'light', aaron: 'darkbrown', clem: 'mediumbrown', oli: 'olive' },
  cf: {
    cell: [364, 480],
    back: { '1990-2025/light': '/bl.webp', '1990-2025/darkbrown': '/bd.webp', '1920-1945/light': '/b20.webp' },
    front: { '1990/1990/light': '/fl.webp', '1990/1990/darkbrown': '/fd.webp', '1990/line': '/fline.webp', '1901/line': '/f01line.webp', '1920/line': '/f20line.webp', '1956/line': '/f56line.webp', '1920/1946/light': '/f2046.webp', '1956/1946/light': '/f5646.webp', '1956/1970/darkbrown': '/f5670.webp' },
    cu: { '1990-2025': '/cu.webp' },
  },
  ...over,
});

describe('plan 59 r5 test 6: back, front and cu art lookups', () => {
  it('back: toned only, olive to light, mediumbrown to darkbrown, lefty mirrors, missing gives null', () => {
    expect(backArt(M(), 'ruth', '1990-2025', 'R')).toEqual({ sheet: '/bl.webp', mirror: false });
    expect(backArt(M(), 'oli', '1990-2025', 'L')).toEqual({ sheet: '/bl.webp', mirror: true });
    expect(backArt(M(), 'clem', '1990-2025', 'R')).toEqual({ sheet: '/bd.webp', mirror: false });
    expect(backArt(M(), 'nobody', '1990-2025', 'R')).toBeNull();   // untoned pitcher: no CF shot (D2)
    expect(backArt(M(), 'aaron', '1970-1989', 'R')).toBeNull();
    expect(backArt(M({ cf: undefined }), 'ruth', '1990-2025', 'R')).toBeNull();
  });
  it('front: look by helmet rules, colours by card era, untoned gets the line strip and never a toned one', () => {
    expect(frontArt(M(), 'ruth', 1995, 'R')).toEqual({ sheet: '/fl.webp', mirror: false, line: false });
    expect(frontArt(M(), 'aaron', 2001, 'L')).toEqual({ sheet: '/fd.webp', mirror: true, line: false });
    expect(frontArt(M(), 'nobody', 1995, 'R')).toEqual({ sheet: '/fline.webp', mirror: false, line: true });
    expect(frontArt(M(), 'ruth', 1950, 'R')!.sheet).toBe('/f2046.webp');    // 1946-55: cap (look 1920), 1946 colours
    expect(frontArt(M(), 'ruth', 1960, 'R')!.sheet).toBe('/f5646.webp');    // look 1956, 1946 colours
    expect(frontArt(M(), 'clem', 1975, 'R')!.sheet).toBe('/f5670.webp');    // mediumbrown to darkbrown
    expect(frontArt(M(), 'ruth', 1975, 'R')).toBeNull();                   // missing key
    expect(frontArt(M(), 'nobody', 1930, 'R')!.sheet).toBe('/f20line.webp');
    for (const y of [1945, 1946, 1955, 1956, 1969, 1970, 1989, 1990]) {
      const a = frontArt(M(), 'nobody', y, 'R')!;
      expect(a.line).toBe(true); expect(a.sheet).toContain('line');
    }
  });
  it('cu by the pitcher era', () => {
    expect(cuArt(M(), '1990-2025')).toBe('/cu.webp');
    expect(cuArt(M(), '1901-1919')).toBeNull();
  });
});

describe('plan 59 r5 test 7: which windup an at-bat gets', () => {
  const pit = (id: string, year = 1995, throws = 'R') => ({ id, year, throws });
  const bat = (id: string, year = 1995, bats = 'R') => ({ id, year, bats });
  it('both CF pieces and the side art give the CF shot (front windup not used)', () => {
    const r = cfArt(M(), pit('ruth'), bat('ruth'), true)!;
    expect(r.kind).toBe('cf');
    expect(r.urls).not.toContain('/w.webp');
    expect(r.urls).toEqual(expect.arrayContaining(['/bl.webp', '/fl.webp', '/cu.webp']));
  });
  it('back sheet missing gives the front windup', () => {
    const r = cfArt(M(), pit('aaron', 1975), bat('ruth'), true);
    expect(r).toBeNull();
  });
  it('front strip missing gives the front windup', () => {
    expect(cfArt(M(), pit('ruth'), bat('ruth', 1975), true)).toBeNull();
  });
  it('untoned pitcher gives no CF shot', () => {
    expect(cfArt(M(), pit('nobody'), bat('ruth'), true)).toBeNull();
  });
  it('no side art gives no CF shot', () => {
    expect(cfArt(M(), pit('ruth'), bat('ruth'), false)).toBeNull();
  });
  it('an untoned batter facing a toned pitcher gets the line strip', () => {
    expect(cfArt(M(), pit('ruth'), bat('nobody'), true)!.front.line).toBe(true);
  });
});

describe('plan 59 r5: backdrop key', () => {
  it('the cf view keys on the batter side; the windup view does not', () => {
    expect(backdropKey('1990', 'cf', 'L', 390, 500, 2)).not.toBe(backdropKey('1990', 'cf', 'R', 390, 500, 2));
    expect(backdropKey('1990', 'windup', 'L', 390, 500, 2)).toBe(backdropKey('1990', 'windup', 'R', 390, 500, 2));
  });
});
