/**
 * Plan 39: history depth. The matchup (home) entry is depth 0; every entry the app pushes is one deeper, so "‹ Home"
 * can step back to the matchup in one go however many screens were opened, after a reload or a browser Back.
 * A link opened cold has depth 0 and cold: true (there is no matchup entry behind it).
 */
export interface NavState { pr?: string; depth?: number; cold?: boolean; }

export function navDepth(): number {
  try { const d = (history.state as NavState | null)?.depth; return typeof d === 'number' && d > 0 ? d : 0; } catch { return 0; }
}

export function pushEntry(pr: string, url?: string): void {
  try { history.pushState({ pr, depth: navDepth() + 1 } satisfies NavState, '', url); } catch { /* no history: fine */ }
}

/** On load: the first entry of this visit is the base (cold when it is a game link). Keeps a depth already stored (reload). */
export function stampBase(cold: boolean): void {
  try {
    const s = (history.state as NavState | null) ?? {};
    if (typeof s.depth === 'number') return;
    history.replaceState({ ...s, depth: 0, ...(cold ? { cold: true } : {}) } satisfies NavState, '');
  } catch { /* fine */ }
}

export function isCold(): boolean {
  try { return !!(history.state as NavState | null)?.cold; } catch { return false; }
}
