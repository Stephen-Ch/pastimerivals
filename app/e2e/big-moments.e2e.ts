// Plan 73 Part A: big moments in the Duel (slow window, HOME RUN! on the era plate, Watch again).
// pitch-hr.json (seed 424242) is a non-ITP home run for every Duel batter here: inside-the-park home runs only happen
// before 1920 (logic.ts callA3 deadBall), and the fixtures' batters are Babe Ruth 1927 and Hank Aaron 1957.
import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RIGHTY, serve } from './harness';

/** Records performance.now() when the stage's data-cue turns to 'end', and the stage's data-end-wall at that moment. */
async function watchEnd(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __end?: { at: number; want: number } };
    new MutationObserver(ms => {
      for (const m of ms) {
        const el = m.target as HTMLElement;
        if (m.attributeName === 'data-cue' && el.dataset['cue'] === 'end' && !w.__end) w.__end = { at: performance.now(), want: Number(el.dataset['endWall']) };
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-cue'] });
  });
}

test('plan 73 A: HOME RUN! on the era plate after the park cue; the scene ends at data-end-wall', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size is enough for the timing check');
  await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  await watchEnd(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('pr-pitch-scene .stage')?.getAttribute('data-cue') === 'park', null, { polling: 'raf', timeout: 20_000 });
  await page.waitForFunction(() => /HOME\s*RUN!/.test(document.querySelector('pr-pitch-scene .park g.word text')?.textContent ?? ''), null, { polling: 'raf', timeout: 5_000 });
  await expect(page.locator('pr-pitch-scene .park g.word rect.plate')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('bm-hr-word.png') });
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 20_000 });
  const e = await page.evaluate(() => (window as unknown as { __end: { at: number; want: number } }).__end);
  console.log(`[plan 73 A] end at ${e.at.toFixed(0)} ms, data-end-wall ${e.want} ms (late by ${(e.at - e.want).toFixed(0)} ms)`);
  expect(e.want).toBeGreaterThan(0);
  expect(e.at).toBeGreaterThanOrEqual(e.want - 1);
  expect(e.at).toBeLessThanOrEqual(e.want + 300);
});

test('plan 73 A6: Watch again replays with no /api/pitch, no /api/events, feedback storage unchanged, board 0-0 at the start', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size is enough');
  const h = await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 20_000 });
  const fb = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('pr_fb')).sort().map(k => [k, localStorage.getItem(k)])));
  const fb0 = await fb();
  const n0 = h.requests.length;
  await page.getByRole('button', { name: 'Watch again' }).click();
  await expect(page.locator('pr-pitch-scene .stage[data-held]')).toHaveCount(0);
  await expect(page.locator('pr-scoreboard .cnt')).toHaveText(/0\s*-\s*0/);
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 20_000 });
  const after = h.requests.slice(n0).filter(r => /\/api\/(pitch|events)/.test(r));
  expect(after).toEqual([]);
  expect(await fb()).toBe(fb0);
  expect(h.bad).toEqual([]);
});

test('plan 73 A6: Watch again is ignored while Pitch again is in flight', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size is enough');
  await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 20_000 });
  let release: () => void = () => undefined;
  const gate = new Promise<void>(r => (release = r));
  await page.route('**/api/pitch', async route => { await gate; await route.fallback(); });
  await page.getByRole('button', { name: 'Pitch again' }).click();
  await expect(page.getByRole('button', { name: 'Watch again' })).toBeDisabled();
  await page.getByRole('button', { name: 'Watch again' }).dispatchEvent('click');
  await expect(page.locator('pr-pitch-scene .stage[data-held]')).toHaveCount(1);   // still the held result
  release();
  await expect(page.locator('pr-pitch-scene .stage[data-held]')).toHaveCount(0, { timeout: 10_000 });   // the new pitch plays
});

// ---- Plan 73 Part C: the clutch setup and its consequence ----
const SETUP = /bottom of the 9th, two outs, down a run, tying run on second/;
test('plan 73 C: setup line above the stage, consequence in the band; hidden (screen-reader only) on small and short screens; not shared', async ({ context, page }, info) => {
  await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  await page.addInitScript(() => { (navigator as unknown as { share: (d: unknown) => Promise<void> }).share = async d => { (window as unknown as { __shared: unknown }).__shared = d; }; });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  const line = page.locator('p.clutch-line');
  await expect(line).toHaveText(SETUP);
  const shown = info.project.name === 'phone';   // 390x844; phone-small 320x568 and landscape 568x320 hide it
  const lb = (await line.boundingBox())!, sb = (await page.locator('pr-pitch-scene .stage').boundingBox())!;
  if (shown) {
    expect(lb.height).toBeGreaterThan(10);
    expect(lb.y + lb.height).toBeLessThanOrEqual(sb.y + 0.5);   // above the stage
  } else expect(lb.height).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Skip to result' }).click();
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 15_000 });
  const next = page.locator('pr-pitch-scene .held-band p.clutch-next');
  await expect(next).toHaveText('...that\'s a walk-off.');
  const nb = (await next.boundingBox())!;
  if (shown) expect(nb.height).toBeGreaterThan(10); else expect(nb.height).toBeLessThanOrEqual(1);
  await page.waitForTimeout(550);
  if (shown) await page.screenshot({ path: info.outputPath('bm-clutch-held.png') });
  expect(await page.evaluate(() => { const se = document.scrollingElement!; return se.scrollHeight - se.clientHeight; })).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Share' }).click();
  const shared = await page.evaluate(() => JSON.stringify((window as unknown as { __shared: unknown }).__shared));
  expect(shared).toContain('pr.test');
  expect(shared).not.toMatch(/walk-off|bottom of the 9th/);
});

// ---- Plan 73 Part D: the card turns over when a picked season changes the picture ----
/** Records every flip class seen on a card picture, and the picture's layout size each time. */
async function watchFlips(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __flips: string[]; __sizes: string[]; __mid: string[] };
    w.__flips = []; w.__sizes = []; w.__mid = [];
    new MutationObserver(ms => {
      for (const m of ms) {
        const el = m.target as HTMLElement;
        if (!el.classList?.contains('pimg')) continue;
        for (const c of ['flip-out', 'flip-hold', 'flip-in']) if (el.classList.contains(c) && w.__flips[w.__flips.length - 1] !== c) {
          w.__flips.push(c);
          if (c === 'flip-in') setTimeout(() => w.__mid.push(getComputedStyle(el).transform), 110);   // half way through the opening
        }
        w.__sizes.push(`${el.offsetWidth}x${el.offsetHeight}`);
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['class', 'src'] });
  });
}

async function pickBatterSeason(page: Page, year: number) {
  await page.getByRole('button', { name: /Change batter/ }).click();
  await page.getByPlaceholder('Type a first or last name').fill('Ruth');
  await page.locator('.picker button.row-btn', { hasText: 'Babe Ruth' }).first().click();
  await page.locator('.picker .list button', { hasText: String(year) }).first().click();
}

for (const [label, year, flips] of [['different era (1915)', 1915, true], ['same era (1925)', 1925, false]] as const) {
  test(`plan 73 D: card flip on a ${label}`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'one size is enough');
    await serve(context, { storage: { pr_seen: null } });   // first visit: Babe Ruth 1927 (a lefty: mirrored card)
    await page.route('**/api/card?*', async route => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('role') !== 'bat') return route.fallback();
      const body = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'card-bat.json'), 'utf8'));
      body.year = Number(u.searchParams.get('year'));
      await route.fulfill({ status: 200, json: body });
    });
    await watchFlips(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const img = page.locator('.pcard img.pimg').nth(1);
    await expect(img).toHaveClass(/mirror/);
    const size0 = await img.evaluate(el => `${(el as HTMLElement).offsetWidth}x${(el as HTMLElement).offsetHeight}`);
    expect(await page.evaluate(() => (window as unknown as { __flips: string[] }).__flips), 'no flip on page load').toEqual([]);
    const src0 = await img.getAttribute('src');
    await pickBatterSeason(page, year);
    await page.waitForTimeout(900);
    const flipsSeen = await page.evaluate(() => (window as unknown as { __flips: string[] }).__flips);
    const sizes = await page.evaluate(() => (window as unknown as { __sizes: string[] }).__sizes);
    const src1 = await img.getAttribute('src');
    if (flips) {
      expect(src1).not.toBe(src0);
      expect(flipsSeen[0]).toBe('flip-out');
      expect(flipsSeen).toContain('flip-in');
      const mid = await page.evaluate(() => (window as unknown as { __mid: string[] }).__mid);
      const sx = Math.abs(Number(/^matrix\(([-\d.e]+)/.exec(mid[0] ?? '')?.[1] ?? 'NaN'));
      expect(sx, `card part-open half way through flip-in (${mid[0]})`).toBeGreaterThan(0.1);
      expect(sx).toBeLessThan(0.95);
    } else {
      expect(src1).toBe(src0);
      expect(flipsSeen).toEqual([]);
    }
    for (const s of sizes) expect(s, 'the card box never changes size').toBe(size0);
    await expect(img).toHaveClass(/mirror/);
    await expect(img).not.toHaveClass(/flip-/);
    expect(await img.evaluate(el => getComputedStyle(el).transform)).toMatch(/^matrix\(-1, 0, 0, 1/);
  });
}

test('plan 73 C: the stage stays at least 55% of the screen with the setup line, at more phone sizes', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'sizes set here');
  await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  for (const [w, h] of [[360, 640], [375, 667], [360, 720], [375, 740], [360, 780], [390, 844], [412, 915]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/'); await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await page.locator('pr-pitch-scene .stage[data-cue="enter"]').waitFor({ timeout: 15_000 });
    const r = await page.evaluate(() => { const s = document.querySelector('pr-pitch-scene .stage')!.getBoundingClientRect(), se = document.scrollingElement!;
      return { pct: s.height / innerHeight, scroll: se.scrollHeight - se.clientHeight, line: document.querySelector('.clutch-line')!.getBoundingClientRect().height }; });
    console.log(`[plan 73 C room] ${w}x${h}: stage ${(100 * r.pct).toFixed(1)}%, line ${r.line.toFixed(0)} px, scroll ${r.scroll}`);
    expect(r.pct, `${w}x${h}`).toBeGreaterThanOrEqual(0.55);
    expect(r.scroll, `${w}x${h}`).toBeLessThanOrEqual(1);
  }
});
