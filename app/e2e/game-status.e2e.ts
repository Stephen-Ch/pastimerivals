// Plan 69 (game status, "did my friend play?"): status words, result-waiting badge, Older/Newer paging, share-back counted.
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[390, 844], [320, 568], [568, 320]];
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
const MINE = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mine-status.json'), 'utf8')) as { code: string; stage: string | null }[];
/** Lines the element's text takes (1 = no wrap). */
const lines = (page: Page, sel: string) => page.locator(sel).first().evaluate(e => {
  const r = document.createRange(); r.selectNodeContents(e);
  const tops = new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
  return tops.size;
});

for (const [w, h] of SIZES) {
  test(`game status at ${w}x${h}: badge, words, paging, badge clears after watching`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' } });
    // Stateful "mine": once the creator opens the played game, the server has recorded "watched".
    let watched = false;
    await context.route('**/api/challenges/mine', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(MINE.map(m => m.code === LL_CODE && watched ? { ...m, stage: 'done' } : m)) }));
    await context.route(`**/api/challenges/${LL_CODE}`, async r => { watched = true; await r.fallback(); });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');

    const link = page.locator('header.bar button.link').first();
    await expect(link).toHaveText('Your games (11) · 2 results waiting');
    expect(await lines(page, 'header.bar button.link'), 'badge link on one line').toBe(1);
        expect(await pageScroll(page), 'duel home page scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-results/p69-duel-${w}x${h}.png` });

    await link.click();
    await expect(page.locator('.waiting-line')).toHaveText('2 results waiting');
    const rows = page.locator('ul.list .row-btn');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Played! See who won');
    await expect(rows.nth(0)).toHaveClass(/best/);   // highlighted with the existing .best border
    await expect(rows.nth(1)).toContainText('Your friend wants a rematch · Play');
    await expect(rows.nth(2)).toContainText('Your friend started picking');
    await expect(rows.nth(3)).toContainText('Opened · your friend is looking');
    await expect(page.getByRole('button', { name: '‹ Newer' })).toHaveCount(0);
    expect(await pageScroll(page), 'challenge home page scroll').toBeLessThanOrEqual(1);
    await page.screenshot({ path: `dist/e2e-results/p69-games-${w}x${h}.png` });

    await page.getByRole('button', { name: 'Older ›' }).click();
    await expect(rows.nth(0)).toContainText('Sent · waiting for your friend');
    await expect(rows.nth(1)).toContainText('Not sent yet · Send');
    await expect(rows.nth(2)).toContainText('You vs the Computer');
    await expect(rows.nth(3)).toContainText('Done · Rematch sent');
    expect(await pageScroll(page), 'page 2 scroll').toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Older ›' }).click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('You played · Rematch?');
    await expect(rows.nth(1)).toContainText('Expired · your friend tried to open it late · Send a new one');
    await expect(rows.nth(2)).toContainText('Expired · Send a new one');
    await expect(page.getByRole('button', { name: 'Older ›' })).toHaveCount(0);
    expect(await pageScroll(page), 'page 3 scroll').toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: '‹ Newer' }).click();
    await page.getByRole('button', { name: '‹ Newer' }).click();
    await expect(rows.nth(0)).toContainText('Played! See who won');

    // Watch the result, then go home: the badge is gone without a reload.
    await rows.nth(0).click();
    await page.getByRole('button', { name: 'Pitch', exact: true }).waitFor();
    expect(watched).toBe(true);
    await page.getByRole('button', { name: '‹ Home' }).first().click();
    await expect(link).toHaveText('Your games (11) · 1 result waiting');
    expect(hn.bad).toEqual([]);
  });
}

for (const who of ['friend', 'creator'] as const) {
  test(`share-back: ${who} share ${who === 'friend' ? 'pings told once' : 'never pings told'}`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'one size is enough');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: who === 'friend' ? { 'challenge-inning.json': 'challenge-inning-friend.json' } : {} });
    // No share sheet; the copy succeeds (the fake origin is not a secure context, so the real clipboard is missing).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
    });
    await page.goto(`/c/${LL_CODE}`);
    await page.getByRole('button', { name: 'Skip to final' }).click();
    await page.getByRole('button', { name: who === 'friend' ? /^Send the result to / : 'Share the game' }).click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    await page.waitForTimeout(300);
    expect(hn.requests.filter(r => r === `POST /api/challenges/${LL_CODE}/told`).length).toBe(who === 'friend' ? 1 : 0);
    expect(hn.bad).toEqual([]);
  });
}
