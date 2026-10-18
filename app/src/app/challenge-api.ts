import { OutcomeKey } from './logic';

/** Plan 24: challenge API client. Writes carry the anti-forgery header; private links carry X-Side-Key. */

export interface CPlayer { id: string; year: number; name: string; bats: string; throws: string; }
export interface CSlot { slot: number; choices: CPlayer[]; }
export interface CAtBat { index: number; round: number; battingSide: number; pitcher: CPlayer; batter: CPlayer; seed: string; outcome: OutcomeKey; points: number; }
export interface CGame { lineups: CPlayer[][]; atBats: CAtBat[]; totals: [number, number]; winner: number; notes: string[]; }
export interface CView {
  code: string; status: 'open' | 'resolved' | 'expired'; you: 'creator' | 'opponent' | 'visitor';
  creatorName: string; opponentName: string | null; expiresUtc: string; canClaim: boolean; rematchOf: string | null;
  yourPicks: CSlot[] | null; game: CGame | null; vsCpu: boolean;
}
export interface CMine { code: string; you: 'creator' | 'opponent'; creatorName: string; opponentName: string | null; createdUtc: string; status: string; vsCpu: boolean; }
export interface CClash { creatorName: string; clashes: { slot: number; id: string; name: string }[]; }
export interface CMe { nickname: string | null; choices: string[]; }

export class ChallengeError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly data?: unknown) { super(message); }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const hit = document.cookie.split('; ').find(c => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

export function keyFor(code: string): string | null {
  try { return localStorage.getItem(`pr-key-${code}`); } catch { return null; }
}

export function saveKey(code: string, key: string) {
  try { localStorage.setItem(`pr-key-${code}`, key); } catch { /* private mode: the link in the URL still works */ }
}

async function fail(r: Response): Promise<never> {
  let code: string | undefined, msg = `Request failed (${r.status})`, data: unknown;
  try { data = await r.json(); code = (data as { error?: string })?.error; if (typeof code === 'string' && code.includes(' ')) msg = code; } catch { /* not JSON */ }
  if (r.status === 429) msg = 'Too many tries. Wait a little and try again.';
  throw new ChallengeError(msg, r.status, code, data);
}

async function get<T>(url: string, code?: string): Promise<T> {
  const headers: Record<string, string> = {};
  const k = code ? keyFor(code) : null;
  if (k) headers['X-Side-Key'] = k;
  const r = await fetch(url, { headers, credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok) return fail(r);
  return r.json() as Promise<T>;
}

let xsrfReady: Promise<unknown> | null = null;

async function send<T>(method: string, url: string, body: unknown, retried = false): Promise<T> {
  if (!readCookie('XSRF-TOKEN')) { xsrfReady ??= get<CMe>('/api/me'); await xsrfReady; }
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': readCookie('XSRF-TOKEN') ?? '' },
    body: JSON.stringify(body),
  });
  // The token can go stale (new server keys, cleared cookies): fetch a fresh one and try once more.
  if (r.status === 403 && !retried) { xsrfReady = get<CMe>('/api/me'); await xsrfReady; return send<T>(method, url, body, true); }
  if (!r.ok) return fail(r);
  return r.json() as Promise<T>;
}

export interface PickBody { picks: { slot: number; choices: { id: string; year: number }[] }[]; nickname?: string; turnstile?: string; }

export function toBody(slots: CSlot[], nickname?: string): PickBody {
  return { picks: slots.map(s => ({ slot: s.slot, choices: s.choices.map(c => ({ id: c.id, year: c.year })) })), nickname };
}

export const capi = {
  me: () => get<CMe>('/api/me'),
  setName: (nickname: string) => send<{ nickname: string }>('PUT', '/api/me', { nickname }),
  view: (code: string) => get<CView>(`/api/challenges/${encodeURIComponent(code)}`, code),
  mine: () => get<CMine[]>('/api/challenges/mine'),
  similar: (id: string, year: number, role: 'bat' | 'pit') => get<CPlayer[]>(`/api/challenges/similar?id=${encodeURIComponent(id)}&year=${year}&role=${role}`),
  quickpick: () => get<CSlot[]>('/api/challenges/quickpick'),
  create: (b: PickBody) => send<{ code: string; key: string }>('POST', '/api/challenges', b),
  lock: (code: string, b: PickBody) => send<{ key: string; view: CView }>('POST', `/api/challenges/${encodeURIComponent(code)}/lock`, b),
  computer: (b: PickBody) => send<{ code: string; key: string; view: CView }>('POST', '/api/challenges/computer', b),
  rematch: (code: string, b: PickBody) => send<{ code: string; key: string }>('POST', `/api/challenges/${encodeURIComponent(code)}/rematch`, b),
};

/** Public link (send to the friend) and private link (secret after #, never reaches the server or logs). */
export function links(origin: string, code: string, key: string | null) {
  return { share: `${origin}/c/${code}`, private: key ? `${origin}/c/${code}#k=${key}` : null };
}

/** Reads a private key from the URL fragment, saves it, and removes it from the address bar. */
export function takeKeyFromHash(code: string) {
  if (typeof location === 'undefined') return;
  if (!/k=/.test(location.hash)) return;
  const m = /k=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(location.hash);
  if (m) saveKey(code, m[1]);
  // Always clear the fragment, valid or not, so a key never lingers in the address bar.
  try { history.replaceState(history.state, '', location.pathname); } catch { /* fine */ }
}

/** How many at-bats this viewer has already watched, so reopening continues instead of spoiling. */
export function watched(code: string): number {
  try { return Number(localStorage.getItem(`pr-watched-${code}`) ?? '0') || 0; } catch { return 0; }
}
export function setWatched(code: string, n: number) {
  try { localStorage.setItem(`pr-watched-${code}`, String(n)); } catch { /* fine */ }
}
