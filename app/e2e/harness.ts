// Plan 59 Round 1a: serve the built app from dist on a fake origin and answer every /api call locally.
// Any request that is not to pr.test, or any /api path without a stub, is recorded and fails the test.
import { BrowserContext, Route } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export const ORIGIN = 'http://pr.test';
const DIST = join(__dirname, '..', 'dist', 'app', 'browser');
const FIX = join(__dirname, 'fixtures');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.xml': 'application/xml', '.map': 'application/json',
};
/** Fixture file by name; serve(..., { fixtures }) can swap one for another (righty batter, plan 59 Round 1b). */
type Fx = (name: string) => string;
const reader = (swap: Record<string, string>): Fx => name => readFileSync(join(FIX, swap[name] ?? name), 'utf8');
/** Plan 59 Round 1b: a resolved Last Licks game (inning mode) at /c/<LL_CODE>. */
export const LL_CODE = 'E2eLastLicksGame000001';
/** Plan 59 Round 1b: swaps that make the Duel batter a righty (Hank Aaron 1957). */
export const RIGHTY: Record<string, string> = { 'card-bat.json': 'card-bat-righty.json', 'matchup.json': 'matchup-righty.json', 'matchup-random.json': 'matchup-random-righty.json' };
const json = (route: Route, body: string, status = 200) => route.fulfill({ status, contentType: 'application/json', body });

/** One stub per API path (regex on the path). Order matters: first match wins. */
const STUBS: [RegExp, (route: Route, url: URL, fixture: Fx) => Promise<void>][] = [
  [/^\/api\/events$/, r => r.fulfill({ status: 204 })],
  [/^\/api\/pitch$/, (r, _u, fixture) => json(r, fixture('pitch.json'))],
  [/^\/api\/sims$/, (r, _u, fixture) => json(r, fixture('sims.json'))],
  [/^\/api\/matchup\/random$/, (r, _u, fixture) => json(r, fixture('matchup-random.json'))],
  [/^\/api\/matchup$/, (r, _u, fixture) => json(r, fixture('matchup.json'))],
  [/^\/api\/players\/search$/, (r, _u, fixture) => json(r, fixture('players-search.json'))],
  [/^\/api\/players\/[^/]+\/seasons$/, (r, _u, fixture) => json(r, fixture('seasons.json'))],
  [/^\/api\/card$/, (r, u, fixture) => json(r, fixture(u.searchParams.get('role') === 'pit' ? 'card-pit.json' : 'card-bat.json'))],
  [/^\/api\/me$/, r => json(r, '{"nickname":null}')],
  [/^\/api\/challenges\/mine$/, r => json(r, '[]')],
  [new RegExp(`^/api/challenges/${LL_CODE}$`), (r, _u, fixture) => json(r, fixture('challenge-inning.json'))],
  [new RegExp(`^/api/challenges/${LL_CODE}/`), r => r.fulfill({ status: 204 })],
  [/^\/api\/challenges(\/.*)?$/, r => json(r, '{}', 404)],
  [/^\/api\/feedback(\/.*)?$/, r => r.fulfill({ status: 204 })],
];

export interface Harness { bad: string[]; requests: string[]; }

export async function serve(context: BrowserContext, opts: { storage?: Record<string, string | null>; fixtures?: Record<string, string> } = {}): Promise<Harness> {
  const h: Harness = { bad: [], requests: [] };
  const fixture = reader(opts.fixtures ?? {});
  const storage: Record<string, string | null> = { pr_voice: 'off', pr_art_note: '1', ...(opts.storage ?? {}) };
  await context.addInitScript(s => { if (!sessionStorage.getItem('pr-e2e-init')) { sessionStorage.setItem('pr-e2e-init', '1'); for (const [k, v] of Object.entries(s)) if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v as string); } }, storage);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    h.requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.origin !== ORIGIN) { h.bad.push(`outside: ${url.href}`); return route.abort(); }
    if (url.pathname.startsWith('/api/')) {
      const stub = STUBS.find(([re]) => re.test(url.pathname));
      if (!stub) { h.bad.push(`unstubbed: ${route.request().method()} ${url.pathname}`); return route.abort(); }
      return stub[1](route, url, fixture);
    }
    if (url.pathname.startsWith('/audio/')) return route.fulfill({ status: 404 });
    const file = normalize(join(DIST, decodeURIComponent(url.pathname)));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
      return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    }
    if (extname(url.pathname)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(DIST, 'index.html')) });   // app routes
  });
  return h;
}
