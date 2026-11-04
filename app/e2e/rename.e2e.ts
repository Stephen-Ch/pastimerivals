// PLAN-2026-11-04-rename-polish-v3 (amendment A1: home buttons unchanged): The Duel in the first-visit hint, "One inning" before the first Pitch, the batter's name in the
// side line while his at-bat plays (short form, one line, never cut for a long last name), no page scroll.
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [390, 844], [568, 320]];
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);

for (const [w, h] of SIZES) {
  test(`rename polish at ${w}x${h}: The Duel named in the first-visit hint`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, {});
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await expect(page.locator('.hint')).toContainText('The Duel: pick any pitcher and batter from history.');
    expect(hn.bad).toEqual([]);
  });

  test(`rename polish at ${w}x${h}: one inning note, batter name while batting`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'viewports set per test');
    const hn = await serve(context, { storage: { pr_seen: '1' }, fixtures: { 'challenge-inning.json': 'challenge-inning-friend.json' } });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/c/${LL_CODE}`);
    await expect(page.locator('.result .note')).toContainText('One inning. Most runs wins. Tap Pitch to see each at-bat.');
    expect(await pageScroll(page), 'page scroll before').toBeLessThanOrEqual(1);
    const before = await page.locator('.side-line').textContent();
    await page.getByRole('button', { name: 'Pitch', exact: true }).click();
    await page.locator('pr-pitch-scene .stage').waitFor();
    const side = page.locator('.side-line');
    await expect(side).toHaveText(/^[A-Z][\w'.-]* (bats (left|right)|batting)\.$|^[A-Z][\w'.-]*, switch, bats (left|right)\.$/);
    // worst short form with a long last name: fits uncut on one line
    const cut = await side.evaluate(e => { const c = e.cloneNode() as HTMLElement; c.textContent = 'Yastrzemski, switch, bats right.'; e.after(c); const d = c.scrollWidth - c.clientWidth; c.remove(); return d; });
    expect(cut, 'long name not cut').toBeLessThanOrEqual(0);
    expect(await pageScroll(page), 'page scroll playing').toBeLessThanOrEqual(1);
    await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
    // held: back to the long form for the next hitter (same function as before the change)
    await expect(side).not.toHaveText(/ bats (left|right)\.$| batting\.$|, switch, /);
    expect(before === null || !/ batting\.$/.test(before)).toBe(true);
    expect(hn.bad).toEqual([]);
  });
}
