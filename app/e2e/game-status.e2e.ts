// Plan 69 (game status, "did my friend play?") with amendment A1 (small screens): status words, result-waiting badge,
// rows a page that fit every phone with no scrolling, top bar that fits, counted share-back.
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LL_CODE, serve } from './harness';

type Row = { code: string; stage: string | null; you: string; status: string; createdUtc: string; [k: string]: unknown };
const FIX = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as Row[];
const pageScroll = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight,
  document.documentElement.scrollWidth - document.documentElement.clientWidth));
/** Every element that can scroll (overflow auto/scroll) and has more content than room. */
const scrollers = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('*')].filter(e => {
  const s = getComputedStyle(e);
  return (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1);
}).map(e => `${e.tagName}.${e.className}`));

// A1 hard targets (measured on review 4's prototype).
const TARGET: Record<string, number> = { '320x568': 4, '360x640': 4, '390x844': 4, '414x896': 4, '375x667': 3, '844x390': 3, '568x320': 2, '667x375': 2 };
const SIZES = Object.keys(TARGET).map(k => k.split('x').map(Number) as [number, number]);
const linkKind = (w: number, h: number) => w > h ? 'wide' : h <= 640 ? 'small' : 'portrait';

/** Checks one page of the games list; returns rows shown. */
async function checkPage(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const ul = document.querySelector<HTMLElement>('main ul.list')!;
    const ub = ul.getBoundingClientRect();
    const rows = [...ul.querySelectorAll<HTMLElement>('.row-btn')].map(b => {
      const rb = b.getBoundingClientRect(), chev = b.querySelector('.chev')!.getBoundingClientRect();
      const l1 = b.querySelector<HTMLElement>('.l1'), st = b.querySelector<HTMLElement>('.st');
      const lines = (e: HTMLElement | null) => e ? Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) : 99;
      const namesEnd = l1 ? l1.getBoundingClientRect().right : 1e9;
      return { h: rb.height, bottom: rb.bottom, chevIn: chev.right <= rb.right + 0.5 && chev.left >= rb.left, namesBeforeChev: namesEnd <= chev.left + 0.5, l1: lines(l1), st: lines(st) };
    });
    const pager = document.querySelector<HTMLElement>('main .pager')?.getBoundingClientRect();
    return { ulBottom: ub.bottom, rows, pagerIn: !!pager && pager.bottom <= innerHeight && pager.top >= 0 };
  });
  for (const [i, x] of r.rows.entries()) {
    expect(Math.abs(x.h - 62), `${label} row ${i} height ${x.h}`).toBeLessThanOrEqual(1);
    expect(x.bottom, `${label} row ${i} cut by the list box`).toBeLessThanOrEqual(r.ulBottom + 0.5);
    expect(x.chevIn, `${label} row ${i} arrow inside the row`).toBe(true);
    expect(x.namesBeforeChev, `${label} row ${i} names end before the arrow`).toBe(true);
    expect(x.l1, `${label} row ${i} names on one line`).toBe(1);
    expect(x.st, `${label} row ${i} status at most 2 lines`).toBeLessThanOrEqual(2);
  }
  expect(r.pagerIn, `${label} pager on screen`).toBe(true);
  expect(await scrollers(page), `${label} scroll boxes`).toEqual([]);
  expect(await pageScroll(page), `${label} page scroll`).toBeLessThanOrEqual(1);
  return r.rows.length;
}

for (const [w, h] of SIZES) {
  const key = `${w}x${h}`;
  test(`A1 games list at ${key}: ${TARGET[key]} rows a page, fixed rows, nothing cut, no scrolling`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'mine.json': 'mine-worst.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await page.locator('header.bar button.link').first().click();
    await page.locator('main ul.list .row-btn').first().waitFor();
    await page.waitForTimeout(300);   // the list measures itself once laid out
    const total = FIX('mine-worst.json').length, per = TARGET[key];
    const pages = Math.ceil(total / per);
    const older = async (n: number) => {   // wait for each page to render before reading it
      await page.getByRole('button', { name: 'Older ›' }).click();
      await expect(page.getByRole('group', { name: `Page ${n} of ${pages}` })).toBeAttached();
    };
    await expect(page.getByRole('group', { name: `Page 1 of ${pages}` })).toBeAttached();
    // A1: no "Your games" heading at any size; on short screens the title is screen-reader only and the intro is gone.
    await expect(page.locator('main h2')).toHaveCount(0);
    const short = (h > w && h <= 640) || (w > h && h <= 500);
    await expect(page.locator('main h1')).toHaveClass(short ? /sr-only/ : /^(?!.*sr-only).*$/);
    await expect(page.locator('main p.how')).toHaveCount(short ? 0 : 1);
    await expect(page.locator('main .how-link')).toHaveCount(short ? 0 : 1);
    expect(await checkPage(page, 'page 1'), 'rows on page 1').toBe(per);
    await page.screenshot({ path: `dist/e2e-results/a1-${key}-p1.png` });
    await older(2);
    expect(await checkPage(page, 'page 2'), 'rows on page 2').toBe(per);
    for (let p = 3; p <= pages; p++) await older(p);
    expect(await checkPage(page, 'last page'), 'rows on the last page').toBe(total - (pages - 1) * per);
    await expect(page.getByRole('button', { name: 'Older ›' })).toHaveCount(0);
    expect(hn.bad).toEqual([]);
  });

  test(`A1 top bar at ${key} fits with 0, 1 and 12 waiting and 99 games`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    let body = '[]';
    const hn = await serve(context, { storage: { pr_seen: '1' } });
    await context.route('**/api/challenges/mine', r => r.fulfill({ status: 200, contentType: 'application/json', body }));
    await page.setViewportSize({ width: w, height: h });
    const row = (i: number, waiting: boolean): Row => ({ code: `E2eTopBar${String(i).padStart(13, '0')}`, you: 'creator', creatorName: 'Me', opponentName: 'Pat',
      createdUtc: '2026-11-22T10:00:00Z', status: 'resolved', vsCpu: false, mode: 'inning', stage: waiting ? 'result' : 'done', rematchSent: false });
    const kind = linkKind(w, h);
    for (const waiting of [0, 1, 12]) {
      body = JSON.stringify(Array.from({ length: 99 }, (_, i) => row(i, i < waiting)));
      await page.goto('/');
      const link = page.locator('header.bar button.link').first();
      const want = waiting === 0 ? (kind === 'small' ? 'Games (99)' : 'Your games (99)')
        : kind === 'small' ? `Games (${waiting} new)` : kind === 'portrait' ? `Your games (${waiting} new)`
        : `Your games (99) · ${waiting} result${waiting === 1 ? '' : 's'} waiting`;
      await expect(link).toHaveText(want);
      const fit = await page.locator('header.bar').first().evaluate(b => ({ over: b.scrollWidth - b.clientWidth,
        linksRight: b.querySelector('.bar-links')!.getBoundingClientRect().right }));
      expect(fit.over, `header overflow with ${waiting} waiting`).toBeLessThanOrEqual(0);
      expect(fit.linksRight, `header links on screen with ${waiting} waiting`).toBeLessThanOrEqual(w);
      expect(await pageScroll(page)).toBeLessThanOrEqual(1);
    }
    if (kind === 'small') await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
    await page.screenshot({ path: `dist/e2e-results/a1-${key}-bar.png` });
    expect(hn.bad).toEqual([]);
  });
}

test('A1 words, order, focus after paging, and turning the phone keeps the page', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one run');
  const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'mine.json': 'mine-status.json' } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('header.bar button.link').first().click();
  await expect(page.locator('main .waiting-line')).toHaveText('2 results waiting');
  const rows = page.locator('main ul.list .row-btn');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Played! See who won');
  await expect(rows.nth(0)).toHaveClass(/best/);
  await expect(rows.nth(1)).toContainText('Your friend wants a rematch · Play');
  await expect(rows.nth(2)).toContainText('Your friend started picking');
  await expect(rows.nth(3)).toContainText('Opened · your friend is looking');
  await expect(page.getByRole('group', { name: 'Page 1 of 3' })).toBeAttached();
  // Turning the phone keeps focus on a row that stays on the page.
  await rows.nth(1).focus();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('group', { name: 'Page 1 of 4' })).toBeAttached();
  await expect(rows.nth(1)).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: 'Page 1 of 3' })).toBeAttached();
  await page.getByRole('button', { name: 'Older ›' }).click();
  await expect(rows.nth(0)).toBeFocused();
  await expect(rows.nth(0)).toContainText('Sent · waiting for your friend');
  await expect(rows.nth(1)).toContainText('Not sent yet · Send');
  await expect(rows.nth(1)).toContainText('Your challenge');
  await expect(rows.nth(2)).toContainText('You vs the Computer');
  await expect(rows.nth(3)).toContainText('Done · Rematch sent');
  // Turn the phone on page 2 and back: same first row, same page.
  // Sideways 3 rows a page: the page holding the anchor row (rows 4-6), so "Sent" stays on screen.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByRole('group', { name: 'Page 2 of 4' })).toBeAttached();
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Sent · waiting for your friend' })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: 'Page 2 of 3' })).toBeAttached();
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Sent · waiting for your friend');
  await page.getByRole('button', { name: 'Older ›' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText('Expired · your friend tried to open it late · Send a new one');
  await page.getByRole('button', { name: '‹ Newer' }).click();
  await expect(rows.nth(0)).toBeFocused();
  await expect(rows.nth(0)).toContainText('Sent · waiting for your friend');
  expect(hn.bad).toEqual([]);
});

test('A1 the waiting status line exists before any games load (screen readers announce it)', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one run');
  const hn = await serve(context, { storage: { pr_seen: '1' } });   // mine.json is [] here
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/c/new');
  await page.getByRole('button', { name: 'Play the computer' }).waitFor();
  await expect(page.locator('main [role=status].waiting-line')).toHaveCount(1);
  await expect(page.locator('main [role=status].waiting-line')).toHaveText('');
  await expect(page.locator('main .pager')).toHaveCount(0);
  expect(await pageScroll(page)).toBeLessThanOrEqual(1);
  expect(hn.bad).toEqual([]);
});

for (const fx of ['mine-status.json', 'mine-one.json']) {
  test(`badge clears after watching the result (${fx})`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'one run');
    const hn = await serve(context, { storage: { pr_seen: '1' } });
    const rows = FIX(fx);
    let watched = false;
    await context.route('**/api/challenges/mine', r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(rows.map(m => m.code === LL_CODE && watched ? { ...m, stage: 'done' } : m)) }));
    await context.route(`**/api/challenges/${LL_CODE}`, async r => { watched = true; await r.fallback(); });
    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto('/');
    const link = page.locator('header.bar button.link').first();
    const n = rows.length, w0 = rows.filter(m => m.stage === 'result' || m.stage === 'rematch_for_you').length;
    await expect(link).toHaveText(`Your games (${n}) · ${w0} result${w0 === 1 ? '' : 's'} waiting`);
    await link.click();
    await page.locator('main ul.list .row-btn').first().click();
    await page.getByRole('button', { name: 'Pitch', exact: true }).waitFor();
    expect(watched).toBe(true);
    await page.getByRole('button', { name: '‹ Home' }).first().click();
    await expect(link).toHaveText(w0 === 1 ? `Your games (${n})` : `Your games (${n}) · ${w0 - 1} result waiting`);
    expect(hn.bad).toEqual([]);
  });
}

test('A1 CSS sizes: app.css does not grow; component styles under 4000 bytes', async ({}, info) => {
  test.skip(info.project.name !== 'phone', 'one run');
  const { transformSync } = await import('esbuild');
  const size = (f: string) => transformSync(readFileSync(join(__dirname, '..', 'src', 'app', f), 'utf8'), { loader: 'css', minify: true }).code.length;
  expect(size('app.css')).toBeLessThanOrEqual(7494);
  // Plan 79: challenge.css (also used by feedback.ts) must not grow; EVERY other component CSS file stays under 4000 (globbed, so new files count).
  expect(size('challenge.css')).toBeLessThanOrEqual(3947);
  const { readdirSync } = await import('node:fs');
  const others = readdirSync(join(__dirname, '..', 'src', 'app')).filter(f => f.endsWith('.css') && f !== 'app.css');
  expect(others).toContain('deciding-play.css');
  for (const f of others) expect(size(f), f).toBeLessThan(4000);
});

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
