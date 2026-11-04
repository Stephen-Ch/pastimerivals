// PLAN-2026-11-04-team-identity-v3 Part A: away left / home right with team pills, "you / they" words, no page scroll,
// and the held "Next" line on one line. A friend game seen by the away player (fixture challenge-inning-friend.json).
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [390, 844], [568, 320]];
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);

for (const [w, h] of SIZES) {
  test(`team identity at ${w}x${h}: board, header, Next line, final`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'challenge-inning.json': 'challenge-inning-friend.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/c/${LL_CODE}`);
    const board = page.locator('pr-scoreboard').first();
    await expect(board.locator('.pill')).toHaveCount(2);
    // you are the friend = away = left, blue; the challenger is home, right, orange
    const fills = await board.locator('.pill').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor));
    expect(fills).toEqual(['rgb(31, 95, 191)', 'rgb(245, 161, 66)']);
    await expect(page.locator('.vs-line')).toContainText('You bat');
    expect(await pageScroll(page), 'page scroll before').toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
    const next = page.locator('.ll-next');
    await expect(next).toHaveCount(1);
    {
      // visible text only: under 360 px the tag is hidden on purpose (the stripe stays)
      const seen = await next.evaluate(e => (e as HTMLElement).innerText);
      if (w >= 360) expect(seen).toContain('(yours)'); else expect(seen).not.toContain('(yours)');
      const lines = await next.evaluate(e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
      expect(lines, 'Next line stays on one line').toBe(1);
      expect(await next.evaluate(e => getComputedStyle(e).borderLeftColor)).toBe('rgb(31, 95, 191)');
    }
    await expect(page.locator('.result-word .team-chip')).toHaveText('YOU');
    // every board pill has the ring in the board's text color
    const rings = await board.locator('.pill').evaluateAll(els => els.map(e => getComputedStyle(e).boxShadow));
    for (const r of rings) expect(r).toMatch(/1\.5px/);
    // the batting team (you, left) is full strength, the other name dimmed
    const ops = await board.locator('.side .nm').evaluateAll(els => els.map(e => getComputedStyle(e).opacity));
    expect(ops).toEqual(['1', '0.7']);
    expect(await pageScroll(page), 'page scroll held').toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Skip to final' }).click();
    await expect(page.locator('.linescore .tname').first()).toContainText('AWAY · You');
    await expect(page.locator('.linescore .tname').nth(1)).toContainText('HOME · Bleacher 5012');
    await expect(page.locator('.half-head').first()).toContainText('Top 1 · You');
    // final board: away (you) left, home right, no dimming
    await expect(page.locator('pr-scoreboard .pill')).toHaveCount(2);
    expect(await page.locator('pr-scoreboard .side .nm').evaluateAll(els => els.map(e => getComputedStyle(e).opacity))).toEqual(['1', '1']);
    await expect(page.locator('pr-scoreboard .side').first()).toContainText('You');
    expect(hn.bad).toEqual([]);
  });
}
