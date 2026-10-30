// Plan 59 Round 1b test 9: the stage in the browser, righty and lefty Duel and one Last Licks at-bat, at every project
// size (320x568, 390x844, 568x320). Sampled at every data-cue. Test 10: reduced motion skips the scene.
import { expect, Page, test } from '@playwright/test';
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
/** Distinct colors on a 12 x 12 grid of the side backdrop image (0 when not drawn). The silhouette is two flat colors. */
const backdropColors = (page: Page) => page.evaluate(() => {
  const im = document.querySelector('pr-pitch-scene .stage > img.bg') as HTMLImageElement | null;
  if (!im || !im.complete || im.naturalWidth < 2) return 0;
  const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const g = cv.getContext('2d')!, seen = new Set<string>();
  g.drawImage(im, 0, 0);
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const d = g.getImageData(Math.floor((i + 0.5) * cv.width / 12), Math.floor((j + 0.5) * cv.height / 12), 1, 1).data;
    if (d[3] > 0) seen.add(`${d[0]},${d[1]},${d[2]}`);
  }
  return seen.size;
});
/** Pixel aspect vs the stage's aspect, for the side backdrop image and (once the park cue has fired) the field view.
 *  The field view's canvas exists, hidden, from the final pitch's start and is sized at its first draw (park cue). */
const aspects = (page: Page) => page.evaluate(() => {
  const st = document.querySelector('pr-pitch-scene .stage') as HTMLElement, a = st.clientWidth / st.clientHeight;
  const out: [string, number, number][] = [];
  const bg = document.querySelector('pr-pitch-scene .stage > img.bg') as HTMLImageElement | null;
  if (bg && bg.naturalWidth > 1) out.push(['backdrop', bg.naturalWidth / bg.naturalHeight, a]);
  const cv = document.querySelector('pr-pitch-scene .park canvas') as HTMLCanvasElement | null;
  if (st.dataset['cue'] === 'park' && cv && cv.width > 1) out.push(['field view', cv.width / cv.height, a]);
  return out;
});

/** Plays one at-bat, sampling the stage at each new cue; records the backdrop's colors at the first enter. */
async function playAndSample(page: Page, start: () => Promise<void>) {
  const samples: Sample[] = [];
  let colorsAtEnter = -1, last = '';
  await start();
  await page.locator('pr-pitch-scene .stage').waitFor({ timeout: 15_000 });
  for (let i = 0; i < 1500; i++) {
    const s = await measure(page);
    if (!s) break;
    if (s.cue && s.cue !== last) {
      last = s.cue; samples.push(s);
      if (s.cue === 'enter' && colorsAtEnter < 0) colorsAtEnter = await backdropColors(page);
    }
    await page.waitForTimeout(10);
  }
  return { samples, colorsAtEnter };
}

for (const who of ['righty', 'lefty'] as const) {
  test(`Duel ${who}: stage size, batter size, steady stage at every cue, Skip visible, no scroll, backdrop drawn by enter`, async ({ context, page }) => {
    const h = await serve(context, who === 'righty' ? { fixtures: RIGHTY } : {});
    await page.goto('/');
    const { samples, colorsAtEnter } = await playAndSample(page, () => page.getByRole('button', { name: 'Pitch', exact: true }).click());
    expect(samples.length).toBeGreaterThan(2);
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
    await expect(page.locator('pr-pitch-scene .stage')).toHaveCount(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1)).toBe(true);
    expect(h.bad).toEqual([]);
  });
});
