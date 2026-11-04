// PLAN-2026-11-04-59-r5-camera-v3 test 11: the center-field windup shot in the Duel. Toned pitcher + 1990s batter
// (righty, lefty, untoned batter): the CF layer shows at the windup cue, stage steady, no scroll. Untoned pitcher: no
// windup at all (D2). Screenshots go to $CF_SHOTS when set (pilot review only).
import { expect, Page, test } from '@playwright/test';
import { serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [390, 844], [568, 320]];
const fx = (tag: string): Record<string, string> => ({ 'card-bat.json': `card-bat-${tag}.json`, 'matchup.json': `matchup-${tag}.json`,
  'matchup-random.json': `matchup-random-${tag}.json`, ...(tag === 'cfnopit' ? { 'card-pit.json': 'card-pit-cfnopit.json' } : {}) });
const rect = (page: Page) => page.evaluate(() => { const r = document.querySelector('pr-pitch-scene .stage')!.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); });
const scrolls = (page: Page) => page.evaluate(() => { const se = document.scrollingElement!; return se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1; });

for (const tag of ['cf', 'cfl', 'cfline'] as const) {
  for (const [w, h] of SIZES) {
    test(`r5 CF shot ${tag} at ${w}x${h}: shows at the windup, stage steady, no scroll`, async ({ context, page }, info) => {
      test.skip(info.project.name !== 'phone', 'viewports set per test');
      const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: fx(tag) });
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Pitch', exact: true }).click();
      const cf = page.locator('pr-pitch-scene .windup.cf');
      await cf.waitFor({ timeout: 15_000 });
      const before = await rect(page);
      // umpire, catcher, batter, pitcher (plus the fading next pose); the CF backdrop is drawn from the first frame
      const got = await page.evaluate(() => ({ n: document.querySelectorAll('pr-pitch-scene .windup.cf .cfs').length,
        key: (document.querySelector('pr-pitch-scene .windup.cf canvas.bg') as HTMLCanvasElement | null)?.dataset['key'] ?? '' }));
      expect(got.n).toBeGreaterThanOrEqual(4);
      expect(got.key).toContain('|cf|');
      if (process.env['CF_SHOTS']) {
        await page.waitForTimeout(250);   // the leg kick
        await page.locator('pr-pitch-scene .stage').screenshot({ path: `${process.env['CF_SHOTS']}/cf-${tag}-${w}x${h}.png` });
      }
      expect(await scrolls(page)).toBe(false);
      await page.locator('pr-pitch-scene .stage[data-cue="enter"], pr-pitch-scene .stage[data-cue="plate"]').first().waitFor({ timeout: 15_000 });
      expect(await rect(page)).toEqual(before);
      expect(hn.bad).toEqual([]);
    });
  }
}

test('r5 untoned pitcher: no windup and no CF shot (D2)', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size');
  const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: fx('cfnopit') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  let seen = 0;
  const poll = setInterval(() => { void page.evaluate(() => (document.querySelectorAll('pr-pitch-scene .windup').length + (document.querySelector('pr-pitch-scene .stage')?.getAttribute('data-cue') === 'windup' ? 1 : 0))).then(n => { seen += n; }).catch(() => {}); }, 40);
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
  clearInterval(poll);
  expect(seen).toBe(0);
  expect(hn.requests.some(r => r.includes('/art/cf-'))).toBe(false);
  expect(hn.bad).toEqual([]);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('r5 CF art present: the scene still ends at once, no windup shown', async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'one size');
    await serve(context, { storage: { pr_seen: '1' }, fixtures: fx('cf') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 10_000 });
    await expect(page.locator('pr-pitch-scene .windup')).toHaveCount(0);
  });
});
