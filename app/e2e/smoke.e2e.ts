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

test('a first visit shows the art note on load, and it can be closed', async ({ context, page }) => {
  const h = await serve(context, { storage: { pr_art_note: null } });
  await page.goto('/');
  const note = page.getByRole('dialog');
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Got it' }).click();
  await expect(note).toBeHidden();
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await expect(page.locator('section.result')).toBeVisible({ timeout: 30_000 });
  expect(h.bad).toEqual([]);
});
