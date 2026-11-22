// Plan 76: the first 30 seconds. Part A: no art pop-up; the one-line note counts as seen only after 1 s on screen.
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LL_CODE, serve } from './harness';

const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
const flexScroll = (page: Page) => page.evaluate(() => { const f = document.querySelector('main.flex') as HTMLElement | null; return f ? f.scrollHeight - f.clientHeight : -1; });
/** Every /api/events body (this page's route wins over the harness's context route). */
async function events(page: Page) {
  const got: { name: string; source?: string }[] = [];
  await page.route('**/api/events', r => { got.push(r.request().postDataJSON()); return r.fulfill({ status: 204 }); });
  return got;
}
const shown = (ev: { name: string; source?: string }[]) => ev.filter(e => e.name === 'art_note_shown').map(e => e.source);
const SHARE = '/?b=ruthb101&by=1927&p=martp001&py=1999&s=123&v=x&d=1';
const phoneOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== 'phone', 'viewports set per test');

test.describe('plan 76 A: no pop-up', () => {
  test('no dialog on first visit, share link or Last Licks; nothing leaves pr.test', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null } });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
    await page.waitForTimeout(500);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(SHARE);
    await expect(page.locator('pr-pitch-scene')).toBeVisible({ timeout: 10_000 });   // the shared pitch plays at once
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(`/c/${LL_CODE}`);
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await expect(page.locator('pr-pitch-scene')).toBeVisible({ timeout: 10_000 });   // the first at-bat plays, no sheet first
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(h.bad).toEqual([]);
  });

  test('first visit at 390x844: the line shows, is logged once after 1 s, and a second visit shows none', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null } });
    const ev = await events(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const line = page.locator('.art-line');
    await expect(line).toBeVisible();
    await expect(page.locator('.pbp-intro')).toHaveCount(0);
    expect(shown(ev)).toEqual([]);
    await expect.poll(() => shown(ev), { timeout: 4000 }).toEqual(['home']);
    expect(await page.evaluate(() => [localStorage.getItem('pr_art_note'), localStorage.getItem('pr_seen')])).toEqual(['1', '1']);
    await page.waitForTimeout(1500);
    expect(shown(ev)).toEqual(['home']);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
    await expect(page.locator('.art-line')).toHaveCount(0);
    await expect(page.locator('.art-short')).toHaveCount(0);
    expect(h.bad).toEqual([]);
  });

  test('short landscape 844x390: the short form shows beside About the art and is logged', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null } });
    const ev = await events(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await expect(page.locator('.art-short')).toBeVisible();
    await expect(page.locator('.art-short')).toHaveText('Generic drawings, not portraits.');
    await expect(page.locator('.art-line')).toBeHidden();
    await expect.poll(() => shown(ev), { timeout: 4000 }).toEqual(['home']);
    expect(await pageScroll(page)).toBeLessThanOrEqual(1);
    expect(h.bad).toEqual([]);
  });

  test('share entry at 390x844: the matchup flash does not count; back on the matchup the line counts after 1 s', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null } });
    const ev = await events(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(SHARE);
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
    expect(shown(ev)).toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem('pr_art_note'), localStorage.getItem('pr_seen')])).toEqual([null, '1']);
    await page.getByRole('button', { name: '‹ Matchup' }).click();
    await expect(page.locator('.art-line')).toBeVisible();
    await expect.poll(() => shown(ev), { timeout: 4000 }).toEqual(['share']);
    expect(h.bad).toEqual([]);
  });

  test('Last Licks first at-bat: the short form on the note line, logged as challenge', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null, pr_seen: '1' } });
    const ev = await events(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${LL_CODE}`);
    const note = page.locator('.ll-art');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Generic drawings, not portraits.');
    await expect.poll(() => shown(ev), { timeout: 4000 }).toEqual(['challenge']);
    expect(h.bad).toEqual([]);
  });
});

test.describe('plan 76 A: fit with the note due', () => {
  for (const [w, hgt] of [[600, 341], [320, 568], [390, 844], [844, 390], [568, 320]] as [number, number][]) {
    test(`matchup at ${w}x${hgt}: no page scroll, matchup area fits`, async ({ context, page }, info) => {
      phoneOnly(info);
      const h = await serve(context, { storage: { pr_art_note: null } });
      await page.setViewportSize({ width: w, height: hgt });
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
      expect(await pageScroll(page), 'page scroll').toBeLessThanOrEqual(1);
      expect(await flexScroll(page), 'matchup area scroll').toBeLessThanOrEqual(w === 568 ? 4 : 1);
      if (w === 600) await expect(page.locator('.art-short')).toBeVisible();
      if (w === 568) await expect(page.locator('.art-short')).toBeHidden();   // 340 px or less: no room
      expect(h.bad).toEqual([]);
    });
  }

  test('320x568 back on the matchup after the first Pitch (note still due): fits', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null, pr_seen: '1' } });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();   // before 1 s: not seen yet
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: '‹ Matchup' }).click();
    await expect(page.locator('.art-line')).toBeVisible();
    expect(await pageScroll(page), 'page scroll').toBeLessThanOrEqual(14);
    expect(await flexScroll(page), 'matchup area scroll').toBeLessThanOrEqual(14);
    expect(h.bad).toEqual([]);
  });

  test('Last Licks first at-bat at 320x568: at most 14 px scroll and the next batter is visible', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_art_note: null, pr_seen: '1' } });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/c/${LL_CODE}`);
    await expect(page.locator('.ll-art')).toBeVisible();
    expect(await pageScroll(page), 'page scroll').toBeLessThanOrEqual(14);
    expect(await page.evaluate(() => { const c = document.querySelector('section.result p.call') as HTMLElement | null; if (!c) return false; const b = c.getBoundingClientRect(); return b.height > 1 && b.top >= 0 && b.bottom <= innerHeight; }), 'next batter visible').toBe(true);
    expect(h.bad).toEqual([]);
  });
});

// ---- Plan 76 D: no empty card frames ----
/** Samples every card frame on every animation frame from page start: skel / img (loaded) / img-empty / pick / other. */
async function watchFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __st: { s: string; t: number }[][] };
    w.__st = [];
    const tick = () => {
      document.querySelectorAll('.pcard .frame').forEach((f, i) => {
        const img = f.querySelector('img') as HTMLImageElement | null;
        const s = img ? (img.complete && img.naturalWidth > 0 ? 'img' : 'img-empty') : f.querySelector('.skeleton') ? 'skel'
          : (f.textContent ?? '').includes('Pick a') ? 'pick' : f.querySelector('.pblank') ? 'blank' : 'other';
        const list = (w.__st[i] ??= []);
        if (list[list.length - 1]?.s !== s) list.push({ s, t: Math.round(performance.now()) });
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const states = (page: Page) => page.evaluate(() => (window as unknown as { __st: { s: string; t: number }[][] }).__st);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const finalLoaded = (page: Page) => page.locator('.pcard img.pimg').evaluateAll(els => els.map(e => (e as HTMLImageElement).naturalWidth > 0));

test.describe('plan 76 D: no empty card frames', () => {
  test('pictures 800 ms late: placeholder, then the picture; never an empty frame or "Pick a"', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context);
    await page.route('**/art/card-*', async r => { await delay(800); await r.fallback(); });
    await watchFrames(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect.poll(() => finalLoaded(page), { timeout: 8000 }).toEqual([true, true]);
    await page.waitForTimeout(200);
    const st = await states(page);
    expect(st.length).toBe(2);
    for (const card of st) {
      expect(card.map(x => x.s), JSON.stringify(card)).toEqual(['skel', 'img']);
    }
    expect(h.bad).toEqual([]);
  });

  test('pictures 2 s late: the img shows at 1.5 s anyway and ends loaded', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context);
    await page.route('**/art/card-*', async r => { await delay(2000); await r.fallback(); });
    await watchFrames(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect.poll(() => finalLoaded(page), { timeout: 8000 }).toEqual([true, true]);
    await page.waitForTimeout(200);
    for (const card of await states(page)) {
      const seq = card.map(x => x.s);
      expect(seq[0]).toBe('skel');
      expect(seq[seq.length - 1]).toBe('img');
      expect(seq).not.toContain('pick');
      const skel = card.find(x => x.s === 'skel')!.t, shown = card.find(x => x.s !== 'skel')!.t;
      expect(shown - skel, JSON.stringify(card)).toBeGreaterThan(1200);   // waited for the 1.5 s limit (the skeleton starts after the reports)
      expect(shown - skel).toBeLessThan(1900);
    }
    expect(h.bad).toEqual([]);
  });

  async function returning(page: Page, context: import('@playwright/test').BrowserContext, ms: number) {
    const h = await serve(context, { storage: { pr_seen: '1' } });
    await page.route('**/api/matchup/random*', async r => {
      await delay(ms);
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ pitcher: { id: 'martp001', name: 'Pedro Martinez', year: 2000, line: 'x' }, batter: { id: 'ruthb101', name: 'Babe Ruth', year: 1930, line: 'y' } }]) });
    });
    await watchFrames(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    return h;
  }

  test('random pairs 1 s late: placeholders (busy), then that pair; never "Pick a"', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await returning(page, context, 1000);
    await expect(page.locator('.pcard[aria-busy="true"]')).toHaveCount(2);
    await expect(page.locator('.pcard').first()).toHaveAttribute('aria-label', 'Loading players');
    await expect(page.locator('.pcard-wrap .pname').first()).toContainText('2000', { timeout: 5000 });
    await expect(page.locator('.pcard-wrap .pname').nth(1)).toContainText('1930');
    await expect.poll(() => finalLoaded(page), { timeout: 8000 }).toEqual([true, true]);
    for (const card of await states(page)) {
      expect(card.map(x => x.s)).not.toContain('pick');
      expect(card.map(x => x.s)).not.toContain('img-empty');
    }
    expect(h.bad).toEqual([]);
  });

  test('random pairs 4 s late: Pedro 1999 vs Ruth 1927 at 3 s; the late reply is ignored', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await returning(page, context, 4000);
    await page.waitForTimeout(2500);
    await expect(page.locator('.pcard[aria-busy="true"]')).toHaveCount(2);
    await expect(page.locator('.pcard-wrap .pname').first()).toContainText('1999', { timeout: 1500 });
    await expect(page.locator('.pcard-wrap .pname').nth(1)).toContainText('1927');
    await page.waitForTimeout(1500);   // the reply has come and gone
    await expect(page.locator('.pcard-wrap .pname').first()).toContainText('1999');
    expect(h.requests.filter(r => r.startsWith('GET /api/matchup?')).length).toBe(1);
    await expect.poll(() => finalLoaded(page), { timeout: 8000 }).toEqual([true, true]);
    for (const card of await states(page)) expect(card.map(x => x.s)).not.toContain('pick');
    expect(h.bad).toEqual([]);
  });

  test('a same-picture season change shows no placeholder', async ({ context, page }, info) => {
    phoneOnly(info);
    const h = await serve(context, { storage: { pr_seen: null } });
    await page.route('**/api/card?*', async route => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('role') !== 'bat') return route.fallback();
      const body = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'card-bat.json'), 'utf8'));
      body.year = Number(u.searchParams.get('year'));
      await route.fulfill({ status: 200, json: body });
    });
    await watchFrames(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect.poll(() => finalLoaded(page)).toEqual([true, true]);
    const before = (await states(page)).map(c => c.length);
    await page.getByRole('button', { name: /Change batter/ }).click();
    await page.getByPlaceholder('Type a first or last name').fill('Ruth');
    await page.locator('.picker button.row-btn', { hasText: 'Babe Ruth' }).first().click();
    await page.locator('.picker .list button', { hasText: '1925' }).first().click();
    await expect(page.locator('.pcard-wrap .pname').nth(1)).toContainText('1925');
    await page.waitForTimeout(500);
    const after = await states(page);
    expect(after.map(c => c.length), JSON.stringify(after)).toEqual(before);
    expect(h.bad).toEqual([]);
  });
});
