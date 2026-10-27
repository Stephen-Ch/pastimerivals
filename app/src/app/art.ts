// Player art: comic matchup cards and sheets (plan 18), side-on batter (32B/C), windup (36), fielders (44).
// Plan 52: the old drawn stick figure is gone; players with no researched tone get blank-paper cards.

export type Era = '1901-1919' | '1920-1945' | '1946-1969' | '1970-1989' | '1990-2025';
export type Pose = 'bat' | 'pit';

export function eraOf(year: number): Era {
  if (year < 1920) return '1901-1919';
  if (year < 1946) return '1920-1945';
  if (year < 1970) return '1946-1969';
  if (year < 1990) return '1970-1989';
  return '1990-2025';
}

// ---- Plan 18: comic art (sprite sheets and matchup cards) ----

export type Tone = 'light' | 'olive' | 'mediumbrown' | 'darkbrown';
export type SheetTone = 'light' | 'darkbrown';

export interface ArtManifest {
  cell: [number, number];
  frames: number;
  sheets: Record<string, string>;   // 'pitcher/<era>/<tone>' -> url
  cards: Record<string, string>;    // 'pitcher/<era>/<tone|line>/<a|b>' -> url (plan 52: line = blank-paper card)
  tones: Record<string, Tone>;      // player id -> researched tone
  /** Plan 32B: side-on batter sheets. */
  side?: { cell: [number, number]; footY: number; sheets: Record<string, string>; frames: Record<string, SideFrame[]> };
  /** Plan 44: fielder sheets by the pitcher's era (hybrid look: uniform colors, pen-and-ink skin). */
  fielder?: { cell: [number, number]; footY: number; sheets: Record<string, string> };
}

/** line = the blank-paper card (plan 52): no researched tone, so no skin is shown. */
export interface PlayerArt { card: string; mirror: boolean; line: boolean; }
export interface PairArt { pit: PlayerArt; bat: PlayerArt; }

/** Decision D-B: animation sheets exist in two tones; olive and medium brown use the nearest one everywhere. */
export function sheetTone(t: Tone): SheetTone {
  return t === 'light' || t === 'olive' ? 'light' : 'darkbrown';
}

/** Stable a/b choice so a player always gets the same card. */
export function variantFor(id: string): 'a' | 'b' {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 2 ? 'b' : 'a';
}

/** The card for one player. No researched tone: the blank-paper "line" card. Null only if the card is missing. */
export function artFor(m: ArtManifest, id: string, role: Pose, era: Era, hand: string): PlayerArt | null {
  const tone = m.tones?.[id];
  const line = !tone;
  const r = role === 'pit' ? 'pitcher' : 'batter';
  const t = line ? 'line' : sheetTone(tone!);
  const card = m.cards?.[`${r}/${era}/${t}/${variantFor(id)}`] ?? m.cards?.[`${r}/${era}/${t}/a`];
  return card ? { card, mirror: hand === 'L', line } : null;
}

/** Plan 56 (replaces D2): each player gets his own card; only an untoned player is blank paper. A missing card gives null for both. */
export function pairArt(m: ArtManifest | null, pit: { id: string; era: Era; hand: string }, bat: { id: string; era: Era; hand: string }): PairArt | null {
  if (!m) return null;
  const p = artFor(m, pit.id, 'pit', pit.era, pit.hand);
  const b = artFor(m, bat.id, 'bat', bat.era, bat.hand);
  return p && b ? { pit: p, bat: b } : null;
}

/** Plan 32B/32C: side-on batter art. Look by the batter's year (helmet rules: NL 1956, AL 1958, all 1970, flap 1983). */
export type SideLook = '1901' | '1920' | '1956' | '1990';
export interface SideFrame { w: number; h: number; x: number; y: number; clipped: boolean; batTip?: [number, number]; contact?: [number, number]; }
export interface SideArt { sheet: string; frames: SideFrame[]; lineArt: boolean; }
export function lookOf(year: number): SideLook {
  return year < 1920 ? '1901' : year < 1956 ? '1920' : year < 1990 ? '1956' : '1990';
}
/** The batter's sheet. No researched tone: the pen-and-ink sheet (every fill white), so no skin tone is shown or guessed. */
export function sideArt(m: ArtManifest | null, id: string, year: number): SideArt | null {
  if (!m?.side) return null;
  const tone = m.tones?.[id];
  const t: SheetTone | 'line' = tone ? sheetTone(tone) : 'line';
  const key = `${lookOf(year)}/${t}`;
  const sheet = m.side.sheets[key], frames = m.side.frames[key];
  return sheet && frames ? { sheet, frames, lineArt: !tone } : null;
}

/** Plan 36: the pitcher's front-view windup sheet, only for a researched tone (no guessed tone). Mirrored for lefties. */
export interface WindupArt { sheet: string; mirror: boolean; }
export function windupArt(m: ArtManifest | null, id: string, era: Era, throws: string): WindupArt | null {
  const tone = m?.tones?.[id];
  if (!m || !tone) return null;
  const sheet = m.sheets[`pitcher/${era}/${sheetTone(tone)}`];
  return sheet ? { sheet, mirror: throws === 'L' } : null;
}

/** Plan 36: first visit = no seen flag and no share or challenge link. Storage that is missing or fails counts as seen. */
export const SEEN_KEY = 'pr_seen';
export function isFirstVisit(hasLink: boolean, storage: Pick<Storage, 'getItem'> | null): boolean {
  if (hasLink || !storage) return false;
  try { return storage.getItem(SEEN_KEY) === null; } catch { return false; }
}

/** Loads and decodes images before a pitch so frames never show blank. Resolves false on any failure. */
export function preloadImages(urls: string[]): Promise<boolean> {
  return Promise.all(urls.map(u => new Promise<boolean>(res => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().then(() => res(true), () => res(true)) : res(true));
    img.onerror = () => res(false);
    img.src = u;
  }))).then(r => r.every(Boolean));
}

/** Plan 44: the fielding team is the pitcher's team, so fielders wear the pitcher's era uniform. */
export interface FielderArt { sheet: string; cell: [number, number]; footY: number; era: Era; }
export function fielderArt(m: ArtManifest | null, era: Era): FielderArt | null {
  const f = m?.fielder, sheet = f?.sheets[era];
  return f && sheet ? { sheet, cell: f.cell, footY: f.footY, era } : null;
}
