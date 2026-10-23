import { OutcomeKey, Pick } from './logic';

export interface PlayerHit { id: string; name: string; years: string; bats: string; throws: string; hof: boolean; bio?: string; }
export interface SeasonItem { year: number; teams: string; pa: number; line: string; grade: string; isDefault: boolean; }
export interface Step {
  outcome: string; batterObserved: number | null; batterShrunk: number; batterLeague: number; batterRatio: number;
  pitcherObserved: number | null; pitcherShrunk: number; pitcherLeague: number; pitcherRatio: number;
  neutral: number; platoonFactor: number; final: number;
}
export interface Side { id: string; name: string; year: number; hand: string; }
export interface MatchupView {
  batter: Side; pitcher: Side; sameHand: boolean | null;
  probabilities: Record<OutcomeKey, number>; steps: Step[]; neutral: string; engineVersion: string;
}
export interface PitchResult { outcome: OutcomeKey; seed: string; engineVersion: string; }
export interface Ratio { label: string; timesLeague: number; }
export interface Report {
  id: string; name: string; role: 'bat' | 'pit'; year: number; age: number | null; height: string | null; weight: string | null;
  bats: string; throws: string; position: string; places: string[]; line: string; grade: string; era: string; hof: boolean; ratios: Ratio[];
  /** Plan 26: one-line career bio. */
  bio?: string;
}
export interface SimsResult { n: number; counts: Record<OutcomeKey, number>; seed: string; }

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 429 ? 'Too many requests. Wait a minute and try again.' : `Request failed (${r.status})`);
  return r.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(r.status === 429 ? 'Too many requests. Wait a minute and try again.' : `Request failed (${r.status})`);
  return r.status === 204 ? (undefined as T) : (r.json() as Promise<T>);
}

export const api = {
  search: (q: string, role: 'bat' | 'pit') => get<PlayerHit[]>(`/api/players/search?q=${encodeURIComponent(q)}&role=${role}`),
  seasons: (id: string, role: 'bat' | 'pit') => get<SeasonItem[]>(`/api/players/${encodeURIComponent(id)}/seasons?role=${role}`),
  matchup: (m: Pick) => get<MatchupView>(`/api/matchup?b=${m.b}&by=${m.by}&p=${m.p}&py=${m.py}`),
  /** Plan 39: random opening matchups (pitcher and batter with name, year and card line). */
  randomPairs: (n: number) => get<{ pitcher: { id: string; name: string; year: number; line: string }; batter: { id: string; name: string; year: number; line: string } }[]>(`/api/matchup/random?n=${n}`),
  card: (id: string, year: number, role: 'bat' | 'pit') => get<Report>(`/api/card?id=${encodeURIComponent(id)}&year=${year}&role=${role}`),
  pitch: (m: Pick, seed?: string) => post<PitchResult>('/api/pitch', { ...m, seed }),
  sims: (m: Pick) => post<SimsResult>('/api/sims', { ...m, n: 1000 }),
  event: (name: string, session: string, source?: string | null) => post<void>('/api/events', source ? { name, session, source } : { name, session }).catch(() => undefined),
};
