// Plan 59 Round 1b test 9: the stage in the browser, righty and lefty Duel and one Last Licks at-bat, at every project
// size (320x568, 390x844, 568x320). Sampled at every data-cue. Test 10: reduced motion skips the scene.
import { expect, Page, test } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LL_CODE, RIGHTY, serve } from './harness';

interface Sample {
  cue: string; vw: number; vh: number; stage: [number, number, number, number]; main: [number, number];
  bat: number; skip: [number, number, number, number] | null; scroll: boolean; landscape: boolean;
}
const measure = (page: Page) => page.evaluate((): Sample | null => {
  const st = document.querySelector('pr-pitch-scene .stage') as HTMLElement | null;
  if (!st) return null;
  const r = st.getBoundingClientRect(), m = (st.closest('main') as HTMLElement).getBoundingClientRect();
  const bat = document.querySelector('pr-pitch-scene .bat')?.getBoundingClientRect();
  const sk = document.querySelector('pr-pitch-scene .skip')?.getBoundingClientRect();
  const se = document.scrollingElement!;
  return { cue: st.getAttribute('data-cue') ?? '', vw: innerWidth, vh: innerHeight, stage: [r.left, r.top, r.width, r.height], main: [m.width, m.height],
    bat: bat ? bat.height * 440 / 480 : 0, skip: sk ? [sk.left, sk.top, sk.right, sk.bottom] : null,
    scroll: se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1, landscape: innerWidth > innerHeight && innerHeight < 500 };
});
/** Distinct colors on a 12 x 12 grid of the side backdrop (0 when not drawn). The silhouette is two flat colors.
 *  Read from a copy, so the stage's own canvas is never read back. */
const backdropColors = (page: Page) => page.evaluate(() => {
  const src = document.querySelector('pr-pitch-scene .stage > canvas.bg') as HTMLCanvasElement | null;
  if (!src || src.width < 2) return 0;
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d')!, seen = new Set<string>();
  g.drawImage(src, 0, 0);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const d = g.getImageData(Math.floor((i + 0.5) * cv.width / 12), Math.floor((j + 0.5) * cv.height / 12), 1, 1).data;
    if (d[3] > 0) seen.add(`${d[0]},${d[1]},${d[2]}`);
  }
  return seen.size;
});
/** Pixel aspect vs the stage's aspect, for the side backdrop and (once the park cue has fired) the field view.
 *  The field view's canvas exists, hidden, from the final pitch's start and is sized at its first draw (park cue). */
const aspects = (page: Page) => page.evaluate(() => {
  const st = document.querySelector('pr-pitch-scene .stage') as HTMLElement, a = st.clientWidth / st.clientHeight;
  const out: [string, number, number][] = [];
  const bg = document.querySelector('pr-pitch-scene .stage > canvas.bg') as HTMLCanvasElement | null;
  if (bg && bg.width > 1) out.push(['backdrop', bg.width / bg.height, a]);
  const cv = document.querySelector('pr-pitch-scene .park canvas') as HTMLCanvasElement | null;
  if (st.dataset['cue'] === 'park' && cv && cv.width > 1) out.push(['field view', cv.width / cv.height, a]);
  return out;
});

/** Plays one at-bat, sampling the stage at each new cue; records the backdrop's colors at the first enter. */
async function playAndSample(page: Page, start: () => Promise<void>) {
  const samples: Sample[] = [];
  let colorsAtEnter = -1, last = '', windupShown = 0, windupBlank = 0;
  await start();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  for (let i = 0; i < 1500; i++) {
    const s = await measure(page);
    if (!s) break;
    // Plan 59 Round 2b: the at-bat is over once the stage is held (the result screen may size it differently).
    if (await page.locator('pr-pitch-scene .stage[data-held]').count()) break;
    // the windup layer only shows when its art loaded in time (app rule); whenever it shows, its backdrop is already drawn
    const wd = await page.evaluate(() => { const c = document.querySelector('pr-pitch-scene .windup canvas.bg') as HTMLCanvasElement | null; return c ? (c.dataset['key'] ? 1 : 0) : -1; });
    if (wd >= 0) { windupShown++; if (!wd) windupBlank++; }
    if (s.cue && s.cue !== last) {
      last = s.cue; samples.push(s);
      if (s.cue === 'enter' && colorsAtEnter < 0) colorsAtEnter = await backdropColors(page);
    }
    await page.waitForTimeout(10);
  }
  return { samples, colorsAtEnter, windupShown, windupBlank };
}

for (const who of ['righty', 'lefty'] as const) {
  test(`Duel ${who}: stage size, batter size, steady stage at every cue, Skip visible, no scroll, backdrop drawn by enter`, async ({ context, page }) => {
    const h = await serve(context, who === 'righty' ? { fixtures: RIGHTY } : {});
    await page.goto('/');
    await page.waitForLoadState('networkidle');   // windup art preloaded, so the windup shows (re-review note 1)
    const { samples, colorsAtEnter, windupShown, windupBlank } = await playAndSample(page, () => page.getByRole('button', { name: 'Pitch', exact: true }).click());
    expect(samples.length).toBeGreaterThan(2);
    expect(windupShown, 'the windup showed (art loaded before Pitch)').toBeGreaterThan(0);
    expect(windupBlank, `windup samples without its backdrop (of ${windupShown})`).toBe(0);
    const first = samples[0];
    for (const s of samples) {
      expect(s.stage, `stage moved at ${s.cue}`).toEqual(first.stage);
      expect(s.scroll, `page scrolls at ${s.cue}`).toBe(false);
      expect(s.skip).not.toBeNull();
      const [l, t, r, b] = s.skip!;
      expect(l >= 0 && t >= 0 && r <= s.vw + 0.5 && b <= s.vh + 0.5, `Skip visible at ${s.cue}`).toBe(true);
    }
    const [, , w, hgt] = first.stage;
    expect(w / hgt).toBeLessThanOrEqual(1.35 + 0.01);
    if (first.landscape) {
      expect(hgt / first.vh).toBeGreaterThanOrEqual(0.65);
      expect(hgt).toBeGreaterThanOrEqual(first.main[1] - 8);
    } else expect(hgt / first.vh).toBeGreaterThanOrEqual(0.55);
    const bat = Math.max(...samples.map(s => s.bat));
    expect(bat / hgt).toBeGreaterThanOrEqual(0.4);
    if (first.vw === 390 && first.vh === 844) expect(bat).toBeGreaterThanOrEqual(270);
    expect(colorsAtEnter, 'backdrop drawn (not the two-color silhouette) by the first enter cue').toBeGreaterThan(4);
    expect(h.bad).toEqual([]);
  });
}

test('Last Licks at-bat: stage uses all the room main gives it, steady at every cue, Skip visible, no scroll', async ({ context, page }) => {
  const h = await serve(context);
  await page.goto(`/c/${LL_CODE}`);
  const { samples, colorsAtEnter } = await playAndSample(page, () => page.getByRole('button', { name: 'Pitch', exact: true }).click());
  expect(samples.length).toBeGreaterThan(2);
  const first = samples[0];
  for (const s of samples) {
    expect(s.stage, `stage moved at ${s.cue}`).toEqual(first.stage);
    expect(s.scroll, `page scrolls at ${s.cue}`).toBe(false);
    const [l, t, r, b] = s.skip!;
    expect(l >= 0 && t >= 0 && r <= s.vw + 0.5 && b <= s.vh + 0.5, `Skip visible at ${s.cue}`).toBe(true);
  }
  const [, , w, hgt] = first.stage;
  expect(w / hgt).toBeLessThanOrEqual(1.35 + 0.01);
  // Stephen 2026-10-30: no 55% gate for Last Licks; the stage takes main's height minus the 62 px reserve, or 60dvh.
  const room = first.landscape ? first.main[1] : Math.min(first.main[1] - 62, 0.6 * first.vh);
  expect(hgt).toBeGreaterThanOrEqual(room - 8);
  expect(colorsAtEnter).toBeGreaterThan(4);
  expect(h.bad).toEqual([]);
});

test('turning the phone mid-scene: backdrop and field-view canvases match the stage shape', async ({ context, page }) => {
  const h = await serve(context, { fixtures: RIGHTY });
  await page.goto('/');
  const vp = page.viewportSize()!;
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage[data-cue="enter"]').waitFor({ timeout: 15_000 });
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(300);
  const mid = await aspects(page);
  expect(mid.length).toBe(1);
  for (const [sel, ca, sa] of mid) expect(Math.abs(ca / sa - 1), sel).toBeLessThanOrEqual(0.02);
  await page.locator('pr-pitch-scene .stage[data-cue="park"]').waitFor({ timeout: 15_000 });
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
  const after = await aspects(page);
  expect(after.length).toBe(2);
  for (const [sel, ca, sa] of after) expect(Math.abs(ca / sa - 1), sel).toBeLessThanOrEqual(0.02);
  expect(h.bad).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('the scene is skipped, the result shows, no page scroll', async ({ context, page }) => {
    const h = await serve(context);
    await page.goto('/');
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await expect(page.locator('section.result')).toBeVisible({ timeout: 15_000 });
    // Plan 59 Round 2b (intended change): the scene no longer disappears; it holds a still with the result over it, with no animation.
    await expect(page.locator('pr-pitch-scene .stage[data-held="1"]')).toHaveCount(1);
    await expect(page.locator('pr-pitch-scene .held-band section.result')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('pr-pitch-scene .stage')!.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1)).toBe(true);
    expect(h.bad).toEqual([]);
  });
});

// ---- Plan 59 Round 2a: one shared scoreboard, display face ----
/** Stage heights on f71d41e (before 2a), first frame after Pitch. 2a must not shrink any of them. */
const R2A_BASE: Record<string, Record<'duel' | 'll', number>> = {
  'phone-small': { duel: 313.1875, ll: 193.1875 },
  phone: { duel: 506.390625, ll: 484.78125 },
  landscape: { duel: 254, ll: 156.8125 },
};
async function startAtBat(page: Page, game: 'duel' | 'll') {
  await page.goto(game === 'duel' ? '/' : `/c/${LL_CODE}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
}

for (const game of ['duel', 'll'] as const) {
  test(`r2a ${game}: stage height unchanged, no scroll either way`, async ({ context, page }, info) => {
    const h = await serve(context);
    await startAtBat(page, game);
    const r = await page.evaluate(() => {
      const se = document.scrollingElement!;
      return { h: document.querySelector('pr-pitch-scene .stage')!.getBoundingClientRect().height,
        scroll: se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1 };
    });
    expect(Math.abs(r.h - R2A_BASE[info.project.name][game]), `stage ${r.h} vs ${R2A_BASE[info.project.name][game]}`).toBeLessThanOrEqual(1);
    expect(r.scroll).toBe(false);
    expect(h.bad).toEqual([]);
  });
}

test('r2a Duel: the scoreboard sits in the at-bat header and shows the count', async ({ context, page }) => {
  await serve(context);
  await startAtBat(page, 'duel');
  const board = page.locator('header.bar pr-scoreboard');
  await expect(board).toHaveCount(1);
  await expect(board.locator('[aria-label="Balls and strikes"]')).toHaveText(/^\d-\d$/);
});

test('r2a Last Licks: the score shows once (one scoreboard, none in the header)', async ({ context, page }) => {
  await serve(context);
  await startAtBat(page, 'll');
  await expect(page.locator('.game pr-scoreboard')).toHaveCount(1);
  await expect(page.locator('.game .scoreboard')).toHaveCount(0);
  await expect(page.locator('header.bar pr-scoreboard, header.bar strong')).toHaveCount(0);
});

for (const pbp of ['on', 'off'] as const) {
  test(`r2a characterize: the caption is the one live region and starts with the count (announcer ${pbp})`, async ({ context, page }) => {
    await serve(context, { storage: { pr_pbp: pbp } });
    await startAtBat(page, 'duel');
    // announcer off: the caption reads "B-S · Word" once a pitch is called; announcer on: the count alone
    const want = pbp === 'off' ? /^\d-\d · \S/ : /^\d-\d$/;
    await page.waitForFunction(src => new RegExp(src).test((document.querySelector('pr-pitch-scene .caption')?.textContent ?? '').replace(/\s+/g, ' ').trim()), want.source, { timeout: 15_000 });
    const r = await page.evaluate(() => {
      const cap = document.querySelector('pr-pitch-scene .caption') as HTMLElement;
      return { live: cap.getAttribute('aria-live'), text: cap.textContent!.replace(/\s+/g, ' ').trim(), inner: cap.querySelectorAll('[aria-live]').length };
    });
    expect(r.live).toBe(pbp === 'on' ? 'off' : 'polite');
    expect(r.text).toMatch(want);
    expect(r.inner).toBe(0);
  });
}

test('r2a font: the display face loads once on the play screen, same origin, under 20 KB', async ({ context, page }) => {
  const h = await serve(context);
  await startAtBat(page, 'duel');
  await page.evaluate(() => document.fonts.ready);
  const fonts = h.requests.filter(r => r.includes('/fonts/'));
  expect(fonts).toEqual(['GET /fonts/oswald-latin-600-normal.woff2']);
  expect(statSync(join(__dirname, '..', 'public', 'fonts', 'oswald-latin-600-normal.woff2')).size).toBeLessThan(20_000);
  expect(h.bad).toEqual([]);
});

// ---- Plan 59 Round 2b: the result over the held last frame ----
interface Box { l: number; t: number; r: number; b: number; h: number; w: number }
const box = (page: Page, sel: string) => page.evaluate((q): Box | null => {
  const e = document.querySelector(q); if (!e) return null;
  const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height, w: r.width };
}, sel);
const inside = (a: Box, b: Box, slack = 0.5) => a.l >= b.l - slack && a.t >= b.t - slack && a.r <= b.r + slack && a.b <= b.b + slack;
const noScroll = (page: Page) => page.evaluate(() => { const se = document.scrollingElement!; return se.scrollHeight <= innerHeight + 1 && se.scrollWidth <= innerWidth + 1; });
/** Distinct colors on a 12 x 12 grid of a canvas (read from a copy). */
const canvasColors = (page: Page, sel: string) => page.evaluate(q => {
  const src = document.querySelector(q) as HTMLCanvasElement | null;
  if (!src || src.width < 2) return 0;
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d')!, seen = new Set<string>();
  g.drawImage(src, 0, 0);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const d = g.getImageData(Math.floor((i + 0.5) * cv.width / 12), Math.floor((j + 0.5) * cv.height / 12), 1, 1).data;
    if (d[3] > 0) seen.add(`${d[0]},${d[1]},${d[2]}`);
  }
  return seen.size;
}, sel);
/** WCAG contrast of the band's text over a white backdrop under the scrim and band, and of the result word on its plate. */
const bandContrast = (page: Page) => page.evaluate(() => {
  const rgba = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top: number[], under: number[]) => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3]));
  const scrim = rgba(getComputedStyle(document.querySelector('pr-pitch-scene .held-scrim')!).backgroundColor);
  const band = document.querySelector('pr-pitch-scene .held-band') as HTMLElement;
  const behind = over(rgba(getComputedStyle(band).backgroundColor), over(scrim, [255, 255, 255]));
  const tag = band.querySelector('.outcome-tag, .held-line') as HTMLElement;   // white text (visually hidden in short landscape, same color)
  const word = band.querySelector('.result-word') as HTMLElement;
  return { text: ratio(rgba(getComputedStyle(tag).color), behind),
    word: ratio(rgba(getComputedStyle(word).color), rgba(getComputedStyle(word).backgroundColor)) };
});
/** Plays The Duel to its held result; returns the stage's at-bat height and whether the same stage element stayed. */
async function duelToHeld(page: Page, skip = false) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  await page.evaluate(() => { (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b: number }).r2b = 1; });
  if (skip) { await page.locator('pr-pitch-scene .windup').waitFor({ timeout: 15_000 }); await page.getByRole('button', { name: 'Skip to result' }).click(); }
  await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
  return page.evaluate(() => (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b?: number }).r2b === 1);
}

test('r2b test 8: Duel result over the held stage; band inside and at most half of it; links, actions and credit visible; no scroll; contrast', async ({ context, page }, info) => {
  const h = await serve(context);
  expect(await duelToHeld(page), 'the same stage element stays').toBe(true);
  await page.waitForTimeout(50);
  await page.screenshot({ path: `dist/e2e-results/r2b-duel-reveal50-${info.project.name}.png` });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `dist/e2e-results/r2b-duel-held-${info.project.name}.png` });
  const stage = (await box(page, 'pr-pitch-scene .stage'))!, band = (await box(page, 'pr-pitch-scene .held-band'))!;
  expect(inside(band, stage), 'band inside the stage').toBe(true);
  expect(band.h, `band ${band.h} of stage ${stage.h}`).toBeLessThanOrEqual(stage.h * 0.5 + 0.5);
  const vp = { l: 0, t: 0, r: page.viewportSize()!.width, b: page.viewportSize()!.height, h: 0, w: 0 };
  for (const name of ['Why this result', 'Pitch again', 'Share']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b && inside({ l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height, h: 0, w: 0 }, vp), `${name} on screen`).toBe(true);
  }
  await expect(page.locator('footer.notice')).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  const c = await bandContrast(page);
  expect(c.text).toBeGreaterThanOrEqual(4.5);
  expect(c.word).toBeGreaterThanOrEqual(4.5);
  expect(h.bad).toEqual([]);
});

test('r2b test 8: with the feedback row showing (3rd pitch), the held band still fits and nothing scrolls', async ({ context, page }) => {
  const h = await serve(context);
  await duelToHeld(page, true);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Pitch again' }).click();
    await page.locator('pr-pitch-scene .stage:not([data-held])').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Skip to result' }).click();
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 15_000 });
  }
  await expect(page.locator('pr-feedback .fb-row')).toBeVisible();
  await page.waitForTimeout(550);   // the band's rise has finished
  await page.screenshot({ path: `dist/e2e-results/r2b-duel-feedback-${test.info().project.name}.png` });
  const stage = (await box(page, 'pr-pitch-scene .stage'))!, band = (await box(page, 'pr-pitch-scene .held-band'))!;
  expect(inside(band, stage)).toBe(true);
  expect(band.h).toBeLessThanOrEqual(stage.h * 0.5 + 0.5);
  expect(stage.h, 'a held stage of useful size').toBeGreaterThan(100);
  expect(await noScroll(page)).toBe(true);
  expect(h.bad).toEqual([]);
});

test('r2b test 8: desktop keeps its width at the reveal', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one desktop size is enough');
  await page.setViewportSize({ width: 1280, height: 800 });
  await serve(context);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  const before = (await box(page, '.game'))!.w;
  await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
  expect((await box(page, '.game'))!.w).toBe(before);
});

test('r2b test 9: Pitch again mounts a new scene; Why opens its sheet', async ({ context, page }) => {
  const h = await serve(context);
  await duelToHeld(page, true);
  await page.getByRole('button', { name: 'Why this result' }).click();
  await expect(page.getByRole('dialog', { name: 'Why this result' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Why this result' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Pitch again' }).click();
  await page.locator('pr-pitch-scene .stage:not([data-held])').waitFor({ timeout: 15_000 });
  expect(await page.evaluate(() => (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b?: number }).r2b)).toBeUndefined();
  expect(h.bad).toEqual([]);
});

test('r2b test 9 (characterize): no batter art shows today\'s result card, no stage, no scroll', async ({ context, page }) => {
  const h = await serve(context);
  await page.route('**/art/side-*', r => r.fulfill({ status: 404 }));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(page.locator('main section.result')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('pr-pitch-scene .stage')).toHaveCount(0);
  await expect(page.locator('main section.result').getByRole('button', { name: 'Why this result' })).toBeVisible();
  expect(await noScroll(page)).toBe(true);
  expect(h.bad).toEqual([]);
});

test('r2b test 11: Skip during the windup holds the final frame: band shows, cue skipped, the field view is drawn', async ({ context, page }, info) => {
  const h = await serve(context);
  await duelToHeld(page, true);
  await expect(page.locator('pr-pitch-scene .stage')).toHaveAttribute('data-cue', 'skipped');
  await expect(page.locator('pr-pitch-scene .held-band section.result')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `dist/e2e-results/r2b-duel-skip-${info.project.name}.png` });
  expect(await canvasColors(page, 'pr-pitch-scene .park canvas'), 'the double is held on a drawn field view').toBeGreaterThan(4);
  expect(h.bad).toEqual([]);
});

// Plan 59 Round 2b test 10: Last Licks keeps the finished at-bat on screen, held, with the call over it.
const LL_EXTRAS = (page: Page) => page.evaluate(() => {
  const vis = (e: Element | null) => { if (!e) return 'none'; const cs = getComputedStyle(e); if (cs.display === 'none') return 'none';
    const r = e.getBoundingClientRect(); return r.width <= 1 || r.height <= 1 ? 'hidden' : 'shown'; };
  const band = document.querySelector('pr-pitch-scene .held-band .ll-extras'), below = document.querySelector('pr-pitch-scene .under .ll-extras');
  return { band: vis(band), below: vis(below), text: (band ?? below)?.textContent?.trim() ?? '' };
});
async function llToHeld(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const atBat = (await box(page, 'pr-pitch-scene .stage'))!;
  await page.evaluate(() => { (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b: number }).r2b = 1; });
  await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(550);
  return atBat;
}

test('r2b test 10: Last Licks holds the at-bat with the call over it; next batter below; same stage; extras where they fit; no scroll', async ({ context, page }, info) => {
  const h = await serve(context);
  await page.goto(`/c/${LL_CODE}`);
  const atBat = await llToHeld(page);
  await page.screenshot({ path: `dist/e2e-results/r2b-ll-held-${info.project.name}.png` });
  expect(await page.evaluate(() => (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b?: number }).r2b), 'same stage element').toBe(1);
  const stage = (await box(page, 'pr-pitch-scene .stage'))!, band = (await box(page, 'pr-pitch-scene .held-band'))!;
  for (const k of ['l', 't', 'w', 'h'] as const) expect(Math.abs(stage[k] - atBat[k]), `stage ${k}`).toBeLessThanOrEqual(1);
  expect(inside(band, stage)).toBe(true);
  expect(band.h).toBeLessThanOrEqual(stage.h * 0.5 + 0.5);
  expect(await page.evaluate(() => { const b = document.querySelector('pr-pitch-scene .held-band') as HTMLElement; return b.scrollHeight <= b.clientHeight + 1; })).toBe(true);
  await expect(page.locator('pr-pitch-scene .held-band .result-word')).toHaveText(/\S/);
  await expect(page.locator('pr-pitch-scene .under')).toContainText('Next:');
  const wrap = (await box(page, '.scene-wrap'))!;
  for (const sel of ['.ll-next', '.ll-half']) {
    const b = await box(page, `pr-pitch-scene .under ${sel}`);
    if (b && b.h > 1) expect(inside(b, wrap), `${sel} not clipped`).toBe(true);
  }
  const x = await LL_EXTRAS(page);
  expect(x.text.length, 'announcer on: recap or intro text exists').toBeGreaterThan(0);
  const want = info.project.name === 'phone' ? { band: 'shown', below: 'none' } : info.project.name === 'landscape' ? { band: 'none', below: 'shown' } : { band: 'hidden', below: 'none' };
  expect({ band: x.band, below: x.below }).toEqual(want);
  if (info.project.name === 'landscape') {
    const ex = (await box(page, 'pr-pitch-scene .under .ll-extras'))!;
    for (const sel of ['.game > .side-line', '.game > .pbp-row']) {
      const o = await box(page, sel);
      if (o && o.h > 1) expect(ex.b, `extras end above ${sel}`).toBeLessThanOrEqual(o.t + 0.5);
    }
  }
  expect(await noScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage:not([data-held])').waitFor({ timeout: 15_000 });
  expect(await page.evaluate(() => (document.querySelector('pr-pitch-scene .stage') as unknown as { r2b?: number }).r2b), 'a new scene').toBeUndefined();
  expect(h.bad).toEqual([]);
});

test('r2b test 10: worst case at the 420 px boundary (long names, capped half note): the band stays within half the stage', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one boundary size');
  const view = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'challenge-inning.json'), 'utf8'));
  const long = 'Bartholomew Featherstonehaugh-Montgomery';
  for (const a of view.game.atBats) { a.batter.name = `${long} ${a.batter.id}`; a.pitcher.name = `${long} Jr.`; }
  view.game.notes = [...(view.game.notes ?? []), 'A half inning was stopped after 30 batters.'];
  const h = await serve(context);
  await page.route(`**/api/challenges/${LL_CODE}`, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(view) }));
  for (const height of [700, 717, 735]) {
    await page.setViewportSize({ width: 390, height });
    await page.goto(`/c/${LL_CODE}`);
    await page.evaluate(code => localStorage.removeItem(`pr-watched-${code}`), LL_CODE);   // start the game over each time
    await page.reload();
    await llToHeld(page);
    const stage = (await box(page, 'pr-pitch-scene .stage'))!, band = (await box(page, 'pr-pitch-scene .held-band'))!;
    expect(band.h, `390x${height}: band ${band.h} of stage ${stage.h}`).toBeLessThanOrEqual(stage.h * 0.5 + 0.5);
    expect(await noScroll(page)).toBe(true);
  }
  expect(h.bad).toEqual([]);
});
