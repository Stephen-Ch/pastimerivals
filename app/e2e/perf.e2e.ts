// Plan 59 Round 1a: ?perf=1 shows the frame-time readout; without it nothing changes; it adds no network requests.
import { expect, Page, test } from '@playwright/test';
import { Harness, serve } from './harness';

async function playOnce(page: Page) {
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(page.locator('section.result')).toBeVisible({ timeout: 30_000 });
}

test('?perf=1 shows p95, max, share under 20 ms and load time after an at-bat', async ({ context, page }) => {
  const h = await serve(context);
  await page.goto('/?perf=1');
  await playOnce(page);
  const box = page.getByRole('status', { name: 'Frame times' });
  await expect(box).toBeVisible();
  await expect(box).toContainText(/p95 \d+\.\d ms/);
  await expect(box).toContainText(/max \d+\.\d ms/);
  await expect(box).toContainText(/<20 ms \d+%/);
  await expect(box).toContainText(/load \d+ ms/);
  await expect(box).not.toContainText('n 0');
  expect(h.bad).toEqual([]);
});

test('without ?perf=1 there is no readout', async ({ context, page }) => {
  await serve(context);
  await page.goto('/');
  await playOnce(page);
  await expect(page.getByRole('status', { name: 'Frame times' })).toHaveCount(0);
});

test('the readout adds no network requests', async ({ browser }) => {
  const run = async (path: string) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const h = await serve(context);
    const page = await context.newPage();
    await page.goto(`http://pr.test${path}`);
    await playOnce(page);
    await page.waitForTimeout(1200);
    await context.close();
    return h.requests.map(r => r.replace(/^GET \/(\?.*)?$/, 'GET /')).sort();
  };
  expect(await run('/?perf=1')).toEqual(await run('/'));
});
