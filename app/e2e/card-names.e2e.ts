// Landscape names fix (PLAN-2026-11-02-landscape-names-v2): the name under each matchup card shows in full,
// and neither the page nor the matchup area scrolls. Runs once (phone project) with its own viewports.
import { expect, test } from '@playwright/test';
import { serve } from './harness';

const SIZES: [number, number][] = [[740, 360], [667, 375], [844, 390], [568, 320], [320, 568], [390, 844]];
const VISITS: [string, Record<string, string | null>][] = [['first visit', {}], ['returning', { pr_seen: '1' }]];

for (const [w, h] of SIZES) {
  for (const [visit, storage] of VISITS) {
    test(`card names show in full at ${w}x${h}, ${visit}`, async ({ context, page }, info) => {
      test.skip(info.project.name !== 'phone', 'viewports set per test');
      const hn = await serve(context, { storage });
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      const names = page.locator('.pcard-wrap > .pname');
      await expect(names).toHaveCount(2);
      await expect(page.locator('.pcard-wrap .pimg').first()).toBeVisible();
      const m = await page.evaluate(() => {
        const flex = document.querySelector('main.flex, .flex') as HTMLElement;
        return {
          names: [...document.querySelectorAll('.pcard-wrap > .pname')].map(e => ({ ch: (e as HTMLElement).clientHeight, sh: e.scrollHeight })),
          page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          flex: flex ? flex.scrollHeight - flex.clientHeight : 0,
        };
      });
      for (const n of m.names) {
        expect(n.ch, 'name height').toBeGreaterThanOrEqual(16);
        expect(n.sh, 'name not clipped').toBeLessThanOrEqual(n.ch + 1);
      }
      expect(m.page, 'page scroll').toBeLessThanOrEqual(1);
      expect(m.flex, 'matchup area scroll').toBeLessThanOrEqual(1);
      expect(hn.bad).toEqual([]);
    });
  }
}
