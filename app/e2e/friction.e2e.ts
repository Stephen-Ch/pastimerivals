// Plan 79 (planning/79-FRICTION-PLAN.md v3), part E: the Last Licks final screen leads with the deciding play card,
// in view with no page scroll at the 8 phone sizes of Plan 69 A1. Fixture: the friend (away) loses on a walk-off double.
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [360, 640], [390, 844], [414, 896], [375, 667], [844, 390], [568, 320], [667, 375]];
const pageScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight,
  document.documentElement.scrollWidth - document.documentElement.clientWidth));

for (const [w, h] of SIZES) {
  test(`plan 79 E at ${w}x${h}: deciding play card on the final screen`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1', [`pr-watched-${LL_CODE}`]: '5' }, fixtures: { 'challenge-inning.json': 'challenge-inning-walkoff.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/c/${LL_CODE}`);
    const card = page.locator('pr-deciding-play .dp');
    await expect(card.locator('.dp-word')).toHaveText('DOUBLE');
    await expect(card.locator('.dp-line')).toHaveText('Mays 1960 doubles in a run. You lose 0-1.');
    const box = (await card.boundingBox())!;
    expect(box.y + box.height, 'card fully in view').toBeLessThanOrEqual(h);
    expect(await pageScroll(page), 'page scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-final-${w}x${h}.png` });
    expect(hn.bad).toEqual([]);
  });
}

// Plan 79 C: "Use YEAR" fills the slot in one tap, the shelf shows on an empty search, a reload keeps the team, no page scroll.
for (const [w, h] of SIZES) {
  test(`plan 79 C at ${w}x${h}: team builder like the Duel picker`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/c/new?vs=friend');
    await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick pick' })).toBeVisible();
    expect(await pageScroll(page), 'review scroll').toBeLessThanOrEqual(1);
    await page.locator('.lineup .row-btn').nth(1).click();   // Batting 1st
    await expect(page.locator('.legends-h')).toHaveText('Famous seasons');
    await expect(page.locator('.legends li').first()).toContainText('Babe Ruth 1927');
    expect(await pageScroll(page), 'pick scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-shelf-${w}x${h}.png` });
    await page.locator('input.search').fill('ru');
    await expect(page.locator('.legends')).toHaveCount(0);
    await page.getByRole('button', { name: /^Babe Ruth/ }).first().click();
    await expect(page.getByRole('button', { name: 'Use 1920 (best season)' })).toBeVisible();
    expect(await pageScroll(page), 'season list scroll').toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Use 1920 (best season)' }).click();
    await expect(page.locator('.chosen .pname')).toContainText('Babe Ruth 1920');
    await page.screenshot({ path: `dist/e2e-shots/p79-chosen-${w}x${h}.png` });
    await expect(page.getByRole('button', { name: 'Quick pick' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your team' })).toBeVisible();
    await expect(page.locator('.lineup li').nth(1)).toContainText('Babe Ruth 1920');
    await expect(page.getByRole('button', { name: 'Quick pick' })).toHaveCount(0);
    expect(await pageScroll(page), 'review scroll after reload').toBeLessThanOrEqual(1);
    expect(hn.bad).toEqual([]);
  });
}
