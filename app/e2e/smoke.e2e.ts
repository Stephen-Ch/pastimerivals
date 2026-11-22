// Plan 59 Round 1a: an at-bat plays to the result screen with every /api call answered locally.
import { expect, test } from '@playwright/test';
import { serve } from './harness';

test('home loads, Pitch plays the at-bat to the result, nothing leaves pr.test', async ({ context, page }) => {
  const h = await serve(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(page.locator('section.result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Pitch again' })).toBeVisible();
  expect(h.requests).toContain('POST /api/pitch');
  expect(h.bad).toEqual([]);
});

test('a first visit has no art pop-up (plan 76 A): the one-line note shows and Pitch plays at once', async ({ context, page }) => {
  const h = await serve(context, { storage: { pr_art_note: null } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 340 px tall or less (568x320) has no room for the line: it stays due for a later visit.
  if (page.viewportSize()!.height > 340) await expect(page.locator('.art-line, .art-short').filter({ visible: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(page.locator('section.result')).toBeVisible({ timeout: 30_000 });
  expect(h.bad).toEqual([]);
});
