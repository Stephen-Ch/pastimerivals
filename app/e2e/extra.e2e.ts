// Plan 71: the extra-inning runner on second is explained, with no page scroll. Fixture: a real 1-0 extra-inning game
// (challenge-inning-extra.json; at-bat 10 opens the top of the 2nd with Otis on second).
import { expect, Page, test } from '@playwright/test';
import { LL_CODE, serve } from './harness';

const SIZES: [number, number][] = [[320, 568], [390, 844], [568, 320]];
// any two visible text lines overlapping (the right column in short landscape is tight)
const overlaps = (page: Page, only = '') => page.evaluate(only => {
  const els = Array.from(document.querySelectorAll('main p, p.side-line, p.pbp-row')).filter(el => {
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return b.width > 1 && b.height > 1 && cs.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null && !el.closest('.held-band');
  });
  const out: string[] = [];
  els.forEach((x, i) => els.slice(i + 1).forEach(y => {
    if (x.contains(y) || y.contains(x)) return;
    if (only && !(x.textContent ?? '').includes(only) && !(y.textContent ?? '').includes(only)) return;
    const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
    if (b.left < a.right - 1 && a.left < b.right - 1 && b.top < a.bottom - 1 && a.top < b.bottom - 1) out.push(`${x.className}/${y.className}`);
  }));
  return out.join(',');
}, only);
const pageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
// seen = a real box (not the 1x1 screen-reader copy), inside the viewport, no hidden ancestor, and not cut off (clamp or ellipsis)
const visibleText = (page: Page, re: RegExp) => page.evaluate(src => {
  const r = new RegExp(src);
  return Array.from(document.querySelectorAll('p')).filter(el => {
    const p = el as HTMLElement, b = p.getBoundingClientRect();
    if (!r.test(p.textContent ?? '') || b.width <= 1 || b.height <= 1 || b.bottom > innerHeight || b.right > innerWidth || b.top < 0) return false;
    for (let e: HTMLElement | null = p; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; }
    return p.scrollHeight <= p.clientHeight + 1 && p.scrollWidth <= p.clientWidth + 1;
  }).length;
}, re.source);

for (const [w, h] of SIZES) {
  for (const pbp of ['off', 'on'] as const) {
    const want = /Extra innings: Otis starts on second\./;
    test(`plan 71 extra runner, announcer ${pbp}, at ${w}x${h}: explained before and after the last out, no scroll`, async ({ context, page }, info) => {
      test.skip(info.project.name !== 'phone', 'viewports set per test');
      const hn = await serve(context, { storage: { pr_seen: '1', pr_pbp: pbp, [`pr-watched-${LL_CODE}`]: '9' }, fixtures: { 'challenge-inning.json': 'challenge-inning-extra.json' } });
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/c/${LL_CODE}`);
      await page.getByRole('button', { name: 'Pitch', exact: true }).click();
      await page.locator('pr-pitch-scene .stage[data-held="1"]').waitFor({ timeout: 20_000 });
      expect(await visibleText(page, want), 'held: shown once').toBe(1);
      expect(await pageScroll(page), 'page scroll held').toBeLessThanOrEqual(1);
      expect(await overlaps(page), 'nothing overlaps the note (held)').toBe('');
      expect(await visibleText(page, /Extra innings, and/), 'the spoken line is not shown as text too').toBe(0);
      await page.reload();
      // watched is now 10: the panel before the first extra-inning pitch
      await expect(page.getByRole('button', { name: 'Pitch', exact: true })).toBeEnabled();
      expect(await visibleText(page, want), 'panel: shown once').toBe(1);
      expect(await pageScroll(page), 'page scroll panel').toBeLessThanOrEqual(1);
      // the panel's intro line already overlaps the side line in short landscape on main (logged separately): only the note is checked here
      expect(await overlaps(page, 'Extra innings:'), 'nothing overlaps the note (panel)').toBe('');
      expect(hn.bad).toEqual([]);
    });
  }
}
