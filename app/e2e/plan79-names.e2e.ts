// Plan 79 A + B + A1 (planning/79-FRICTION-PLAN.md v3, planning/79-A1-TYPED-NAME-PLAN.md v6): team names on the friend's link page,
// the review screen (with the name sheet), the board and the final screen, with no page scroll at the 8 phone sizes of Plan 69 A1.
// The final-screen fixture carries the widest short name (12 W's) and the longest full name (24 W's), both typed.
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [360, 640], [390, 844], [414, 896], [375, 667], [844, 390], [568, 320], [667, 375]];
const pageScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight,
  document.documentElement.scrollWidth - document.documentElement.clientWidth));

for (const [w, h] of SIZES) {
  test(`plan 79 B at ${w}x${h}: the friend's link page names the challenger's team`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'challenge-inning.json': 'challenge-inning-open.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/c/${LL_CODE}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The Savannah Lamplighters challenged you');
    await expect(page.getByText('your hitters bat until 3 outs, then theirs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick your team' })).toBeInViewport();
    await expect(page.locator('main img')).toHaveCount(0);
    expect(await pageScroll(page), 'link page scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-link-${w}x${h}.png` });
    expect(hn.bad).toEqual([]);
  });

  test(`plan 79 A at ${w}x${h}: the review screen names your team; the name sheet fits`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'me.json': 'me-teams.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/c/new?vs=friend');
    await expect(page.locator('.team-now')).toHaveText('The Savannah Lamplighters');
    expect(await pageScroll(page), 'review scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-review-${w}x${h}.png` });
    await page.getByRole('button', { name: 'Change team name' }).click();
    await page.getByRole('button', { name: 'More names' }).click();
    await expect(page.getByRole('button', { name: 'The Erie Kingfishers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Type your own' })).toBeVisible();
    const sheet = (await page.locator('.team-sheet').boundingBox())!;
    expect(sheet.y, 'sheet top on screen').toBeGreaterThanOrEqual(0);
    expect(await pageScroll(page), 'sheet page scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-sheet-${w}x${h}.png` });
    await page.getByRole('button', { name: 'The Erie Kingfishers' }).click();
    await expect(page.locator('.team-now')).toHaveText('The Erie Kingfishers');
    await page.reload();
    await expect(page.locator('.team-now'), 'reload keeps the name').toHaveText('The Erie Kingfishers');
    expect(hn.bad).toEqual([]);
  });

  test(`plan 79 A1 at ${w}x${h}: long typed names fit the board and the final screen`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1', [`pr-watched-${LL_CODE}`]: '99' }, fixtures: { 'challenge-inning.json': 'challenge-inning-names.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/c/${LL_CODE}`);
    await expect(page.locator('pr-scoreboard')).toBeVisible();
    await expect(page.locator('.linescore')).toContainText('WWWWWWWWWWWW');
    await expect(page.getByRole('button', { name: /^Report name/ })).toHaveCount(1);
    const send = page.locator('.send-result');
    expect(await send.evaluate(b => b.scrollWidth - b.clientWidth), 'long name wraps inside the button').toBeLessThanOrEqual(1);
    expect(await pageScroll(page), 'final scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-shots/p79-names-${w}x${h}.png` });
    expect(hn.bad).toEqual([]);
  });
}

test('plan 79 A: Your games rows name the teams', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size');
  const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'mine.json': 'mine-names.json' } });
  await page.goto('/');
  await page.locator('header.bar button.link').first().click();
  await expect(page.locator('main ul.list .row-btn').first()).toContainText('You vs Erie Kingfishers');
  expect(hn.bad).toEqual([]);
});
