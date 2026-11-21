// Plan 75 (polish round 1): count wording, the held plate over the result, Watch again as a button.
// Fixtures pitch-*.json all use seed 424242; Duel batter Hank Aaron 1957 (RIGHTY), so no inside-the-park home runs.
import { expect, Page, test } from '@playwright/test';
import { RIGHTY, serve } from './harness';

const PLATED: [string, string, RegExp][] = [
  ['hr', 'pitch-hr.json', /^HOME\s*RUN!$/], ['double', 'pitch.json', /^DOUBLE!$/],
  ['triple', 'pitch-triple.json', /^TRIPLE!$/], ['k', 'pitch-k.json', /^(WHIFF!|STRIKE\s*THREE!)$/],
];
const SIZES = [[390, 844], [360, 640], [844, 390], [568, 320]] as const;

async function pitchToHeld(page: Page, skip: boolean) {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Pitch', exact: true }).click();
  if (skip) {
    await page.locator('pr-pitch-scene .stage[data-cue]').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Skip to result' }).click();
  }
  await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 25_000 });
  await page.waitForTimeout(500);   // the scrim and band fade in over 450 ms
}

/** The held plate's rect, its effective opacity (rect up to the stage), the band's top, and the word text. */
function measure(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('pr-pitch-scene .stage') as HTMLElement;
    const svg = stage.querySelector('svg.held-plate');
    const rect = svg?.querySelector('rect.plate') as SVGRectElement | null;
    let op = 1;
    for (let e: Element | null = rect; e && e !== stage.parentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const r = rect?.getBoundingClientRect(), s = stage.getBoundingClientRect(), band = stage.querySelector('.held-band')!.getBoundingClientRect();
    return {
      plate: r ? [r.left, r.top, r.right, r.bottom] : null, stage: [s.left, s.top, s.right, s.bottom], bandTop: band.top, op,
      hidden: svg?.getAttribute('aria-hidden') ?? null, text: svg?.querySelector('text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      oldWords: stage.querySelectorAll('.words g.word').length, tag: document.querySelector('.outcome-tag')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      scroll: document.scrollingElement!.scrollHeight > innerHeight + 1 || document.scrollingElement!.scrollWidth > innerWidth + 1,
    };
  });
}

/** Held Duel stage heights (px) measured on 4684c2c (before Plan 75) with this same test. The 55% gate is the at-bat stage's
 *  (big-moments.e2e.ts plan 73 C); the held stage was already smaller (48.7% at 360x640 on 4684c2c). */
const BASE_HELD: Record<string, number> = {
  '360x640': 311.6, '375x667': 396.2, '360x720': 347.6, '375x740': 444, '360x780': 451.6, '390x844': 506.4, '412x915': 549, '320x568': 239.6, '844x390': 220.8,
};

for (const skip of [true, false]) {
  test(`plan 75 F1/F2: plated words stay on the held result (${skip ? 'Skip' : 'natural end'}), at 4 sizes`, async ({ context, page }, info) => {
    test.skip(info.project.name !== 'phone', 'sizes set here');
    test.setTimeout(240_000);
    for (const [o, fx, word] of PLATED) {
      for (const [w, h] of skip ? SIZES : [SIZES[0], SIZES[3]]) {
        await context.clearCookies();
        await serve(context, { fixtures: { 'pitch.json': fx, ...RIGHTY } });
        await page.setViewportSize({ width: w, height: h });
        await pitchToHeld(page, skip);
        const m = await measure(page), at = `${o} ${w}x${h}`;
        console.log(`[plan 75] ${at} ${skip ? 'skip' : 'end'}: plate ${m.plate?.map(Math.round).join(',')} band top ${Math.round(m.bandTop)} op ${m.op} "${m.text}" | ${m.tag}`);
        expect(m.plate, `${at}: plate shows`).not.toBeNull();
        expect(m.text, at).toMatch(word);
        expect(m.op, `${at}: full opacity`).toBe(1);
        expect(m.hidden, at).toBe('true');
        expect(m.oldWords, `${at}: old word gone`).toBe(0);
        const [l, t, r, b] = m.plate!;
        expect(b, `${at}: plate bottom above the band`).toBeLessThanOrEqual(m.bandTop - 4);
        expect(l >= m.stage[0] - 0.5 && r <= m.stage[2] + 0.5 && t >= m.stage[1] - 0.5, `${at}: plate inside the stage`).toBe(true);
        if (w > h) expect(m.text.split(' ').length <= 2 && !/\n/.test(m.text), at).toBe(true);
        expect(m.tag, `${at}: count wording`).toMatch(/^Result: .+ · on (a \d-\d|the first) pitch$/);
        expect(m.scroll, `${at}: no page scroll`).toBe(false);
        await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.unrouteAll({ behavior: 'ignoreErrors' });
      }
    }
  });
}

test('plan 75 F2: a walk has no held plate; the Why sheet says "On a 3-x pitch"', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'one size');
  await serve(context, { fixtures: { 'pitch.json': 'pitch-bb.json', ...RIGHTY } });
  await pitchToHeld(page, true);
  await expect(page.locator('svg.held-plate')).toHaveCount(0);
  await expect(page.locator('.outcome-tag')).toHaveText(/· on a 3-\d pitch$/);
  await page.getByRole('button', { name: 'Why this result' }).click();
  await expect(page.locator('.sheet .note')).toHaveText(/^On a 3-\d pitch\. Pitch count is for fun/);
});

test('plan 75 F3: Watch again is an outline button, first in one row, nothing clipped (stale app too)', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone-small', '320 px is the tight case');
  for (const stale of [false, true]) {
    await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
    if (stale) {
      // a shared link from a newer app (unknown decoration version) marks the app stale
      // (it opens straight on the shared result)
      await page.goto('/?b=aaroh101&by=1957&p=martp001&py=1999&s=424242&v=x&d=99'); await page.waitForLoadState('networkidle');
      await page.locator('pr-pitch-scene .stage[data-held]').waitFor({ timeout: 25_000 });
      await page.waitForTimeout(500);
    } else await pitchToHeld(page, true);
    const row = await page.evaluate(() => {
      const p = document.querySelector('.result-links')!, pr = p.getBoundingClientRect();
      const bs = [...p.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent!.trim(), l: r.left, r: r.right, top: r.top, h: r.height, cls: b.className }; });
      const wa = p.querySelector('button.watch-again')!, cs = getComputedStyle(wa);
      return { pr: [pr.left, pr.right], bs, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, bg: cs.backgroundColor,
        scroll: document.scrollingElement!.scrollHeight > innerHeight + 1 };
    });
    console.log(`[plan 75 F3] stale=${stale}: ${row.bs.map(b => `${b.t} ${Math.round(b.l)}-${Math.round(b.r)} h${Math.round(b.h)}`).join(' | ')} row ${row.pr.map(Math.round)}`);
    expect(row.bs[0].t).toBe('Watch again');
    expect(row.bs[0].h).toBeGreaterThanOrEqual(44);
    expect(row.border).toBe('2px solid');
    if (stale) expect(row.bs.some(b => b.t === 'Refresh app')).toBe(true);
    const tops = new Set(row.bs.map(b => Math.round(b.top + b.h / 2)));
    expect(tops.size, 'one line').toBe(1);
    for (const b of row.bs) expect(b.r, `${b.t} not clipped`).toBeLessThanOrEqual(row.pr[1] + 0.5);
    expect(row.scroll).toBe(false);
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('plan 75: the held Duel stage height is unchanged from 4684c2c at 7 portrait sizes (+2); no scroll at 320x568, 390x844, 844x390', async ({ context, page }, info) => {
  test.skip(info.project.name !== 'phone', 'sizes set here');
  test.setTimeout(180_000);
  await serve(context, { fixtures: { 'pitch.json': 'pitch-hr.json', ...RIGHTY } });
  for (const [w, h] of [[360, 640], [375, 667], [360, 720], [375, 740], [360, 780], [390, 844], [412, 915], [320, 568], [844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await pitchToHeld(page, true);
    const r = await page.evaluate(() => { const s = document.querySelector('pr-pitch-scene .stage')!.getBoundingClientRect(), se = document.scrollingElement!;
      return { pct: s.height / innerHeight, hgt: s.height, scroll: se.scrollHeight - se.clientHeight }; });
    console.log(`[plan 75 room] ${w}x${h}: held stage ${r.hgt.toFixed(1)} px (${(100 * r.pct).toFixed(1)}%), scroll ${r.scroll}`);
    if (BASE_HELD[`${w}x${h}`] !== undefined) expect(r.hgt, `${w}x${h}: held stage height as on 4684c2c`).toBeCloseTo(BASE_HELD[`${w}x${h}`], 0);
    expect(r.scroll, `${w}x${h}`).toBeLessThanOrEqual(1);
  }
});
