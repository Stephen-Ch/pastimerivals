// Plan 59 Round 1a: ?perf=1 shows the frame-time readout; without it nothing changes; it adds no network requests.
import { expect, Page, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { Harness, RIGHTY, serve } from './harness';

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
  const h = await serve(context);
  await page.goto('/');
  await playOnce(page);
  await expect(page.getByRole('status', { name: 'Frame times' })).toHaveCount(0);
  expect(h.bad).toEqual([]);
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
    expect(h.bad).toEqual([]);
    return [...new Set(h.requests.map(r => r.replace(/^GET \/(\?.*)?$/, 'GET /')))].sort();   // distinct requests: timer-driven repeats don't count
  };
  expect(await run('/?perf=1')).toEqual(await run('/'));
});

// Plan 59 Round 1b test 11 (cloud, relative only): field-view work per frame, and the backdrop render per view.
// Frame work = the length of each animation-frame callback while the field view shows (same wrapper on any build).
// PERF_BASE=<json from a run on the Part A tip> makes it compare: median frame work at most 1.25 x. Results go to
// <outputDir>/perf-r1b.json. Backdrops (performance.measure 'pr-backdrop-<view>') must render in 150 ms or less.
test('plan 59 r1b test 11: field-view frame work vs the Part A build, backdrop render per view', async ({ context, page }, info) => {
  test.setTimeout(120_000);
  const h = await serve(context, { fixtures: RIGHTY });
  await context.addInitScript(() => {
    const w = window as unknown as { __prFrames: number[]; requestAnimationFrame: typeof requestAnimationFrame };
    w.__prFrames = [];
    const raf = window.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = cb => raf(t => {
      const s = performance.now();
      cb(t);
      const p = document.querySelector('pr-pitch-scene .park') as HTMLElement | null;
      if (p && +(p.style.opacity || 0) > 0) w.__prFrames.push(performance.now() - s);
    });
  });
  await page.goto('/');
  await playOnce(page);
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Pitch again' }).click();
    await expect(page.locator('section.result')).toBeVisible({ timeout: 30_000 });
  }
  const r = await page.evaluate(() => {
    const f = [...(window as unknown as { __prFrames: number[] }).__prFrames].sort((a, b) => a - b);
    const q = (u: number) => f.length ? f[Math.min(f.length - 1, Math.floor(u * f.length))] : 0;
    const bd: Record<string, number> = {};
    for (const e of performance.getEntriesByType('measure')) if (e.name.startsWith('pr-backdrop-')) bd[e.name.slice(12)] = Math.max(bd[e.name.slice(12)] ?? 0, e.duration);
    return { n: f.length, median: q(0.5), p95: q(0.95), backdropMs: bd };
  });
  writeFileSync(info.outputPath('perf-r1b.json'), JSON.stringify({ [info.project.name]: r }));   // merge the projects' files for PERF_BASE
  console.log(`perf-r1b ${info.project.name} ${JSON.stringify(r)}`);
  expect(r.n).toBeGreaterThan(20);
  expect(Object.keys(r.backdropMs).sort(), 'both backdrops rendered and logged').toEqual(['side', 'windup']);
  for (const [view, ms] of Object.entries(r.backdropMs)) expect(ms, `backdrop ${view}`).toBeLessThanOrEqual(150);
  if (process.env['PERF_BASE']) {
    const base = JSON.parse(readFileSync(process.env['PERF_BASE'], 'utf8'))[info.project.name] as { median: number };
    expect(r.median, `median frame work vs Part A ${base.median.toFixed(2)} ms`).toBeLessThanOrEqual(1.25 * base.median);
  }
  expect(h.bad).toEqual([]);
});
