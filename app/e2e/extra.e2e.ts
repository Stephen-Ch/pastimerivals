// Plan 71: the extra-inning runner on second is explained, with no page scroll. Fixture: a real 1-0 extra-inning game
// (challenge-inning-extra.json; at-bat 10 opens the top of the 2nd with Otis on second).
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [390, 844], [568, 320]];
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
const visibleText = (page: Page, re: RegExp) => page.evaluate(src => {
  const r = new RegExp(src);
  return Array.from(document.querySelectorAll('p')).filter(p => (p as HTMLElement).offsetParent !== null && r.test((p as HTMLElement).innerText)).length;
}, re.source);

for (const [w, h] of SIZES) {
  for (const pbp of ['off', 'on'] as const) {
    const want = pbp === 'off' ? /Extra innings: Otis starts on second\./ : /Extra innings, and a runner starts on second\./;
    test(`plan 71 extra runner, announcer ${pbp}, at ${w}x${h}: explained before and after the last out, no scroll`, async ({ context, page }, info) => {
      test.skip(info.project.name !== 'phone', 'viewports set per test');
      const hn = await serve(context, { storage: { pr_seen: '1', pr_pbp: pbp, [`pr-watched-${LL_CODE}`]: '9' }, fixtures: { 'challenge-inning.json': 'challenge-inning-extra.json' } });
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/c/${LL_CODE}`);
      await page.getByRole('button', { name: 'Pitch', exact: true }).click();
      await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
      expect(await visibleText(page, want), 'held: shown once').toBe(1);
      expect(await pageScroll(page), 'page scroll held').toBeLessThanOrEqual(1);
      if (pbp === 'on') expect(await visibleText(page, /Extra innings: /), 'no written note too').toBe(0);
      await page.reload();
      // watched is now 10: the panel before the first extra-inning pitch
      await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
      expect(await visibleText(page, want), 'panel: shown once').toBe(1);
      expect(await pageScroll(page), 'page scroll panel').toBeLessThanOrEqual(1);
      expect(hn.bad).toEqual([]);
    });
  }
}
