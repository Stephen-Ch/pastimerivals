// Plan 79 C (planning/79-FRICTION-PLAN.md v3): the team in progress survives a reload. Kept in sessionStorage per flow;
// restored picks are re-checked before use (the challenger-clash check stays on the server at Lock). Cleared on Lock.
import type { CPlayer, CSlot, GameMode } from './challenge-api';

export type PickMode = 'create' | 'accept' | 'rematch' | 'cpu';
export interface KeptTeam { slots: (CSlot | null)[]; sittingOut: CSlot | null; hand: boolean; }

/** Game mode + ("new" for a new friend challenge, "cpu" for a computer game, the game code when accepting, "rematch:" + old code). */
export function teamKey(mode: PickMode, gameMode: GameMode, code: string | null): string | null {
  const id = mode === 'create' ? 'new' : mode === 'cpu' ? 'cpu' : !code ? null : mode === 'rematch' ? `rematch:${code}` : code;
  return id ? `pr_team:${gameMode}:${id}` : null;
}

const goodPlayer = (p: unknown): p is CPlayer => !!p && typeof (p as CPlayer).id === 'string' && /^[a-z0-9]{1,12}$/i.test((p as CPlayer).id)
  && Number.isInteger((p as CPlayer).year) && typeof (p as CPlayer).name === 'string';
const goodSlot = (s: unknown, slot: number): s is CSlot => !!s && (s as CSlot).slot === slot && Array.isArray((s as CSlot).choices)
  && (s as CSlot).choices.length >= 1 && (s as CSlot).choices.length <= 3 && (s as CSlot).choices.every(goodPlayer);

/** Re-checks a kept team: size must match the game mode's rows, bad slots are dropped, and for the friend (batters fixed by the game)
 *  rows past the game's batters are dropped. The home side's era is asked again after restoring (refreshEra). Null = nothing usable. */
export function checkKept(t: KeptTeam | null | undefined, size: number, fixedBatters: number | null): KeptTeam | null {
  if (!t || !Array.isArray(t.slots) || t.slots.length !== size) return null;
  const slots = t.slots.map((s, i) => (goodSlot(s, i) && (fixedBatters === null || i <= fixedBatters) ? s : null));
  const sittingOut = fixedBatters === null && t.sittingOut && goodSlot(t.sittingOut, t.sittingOut.slot) ? t.sittingOut : null;
  if (!slots.some(Boolean) && !sittingOut) return null;
  return { slots, sittingOut, hand: !!t.hand };
}

export function loadTeam(key: string): KeptTeam | null {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) as KeptTeam : null; } catch { return null; }
}
export function keepTeam(key: string, t: KeptTeam) {
  try { sessionStorage.setItem(key, JSON.stringify(t)); } catch { /* private mode: the team just isn't kept */ }
}
export function dropTeam(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* fine */ }
}
