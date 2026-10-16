import { Component, computed, signal } from '@angular/core';
import { api, MatchupView, PitchResult, PlayerHit, SeasonItem, SimsResult } from './api';
import { explain, label, OUTCOMES, OutcomeKey, parseShare, percent, Pick, shareUrl, timesLeague } from './logic';

type Role = 'bat' | 'pit';
interface Chosen { id: string; name: string; year: number; line: string; }

function sessionId(): string {
  try {
    let s = sessionStorage.getItem('pr-session');
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('pr-session', s); }
    return s;
  } catch { return 'no-storage'; }
}

@Component({
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly outcomes = OUTCOMES;
  protected readonly label = label;
  protected readonly percent = percent;
  protected readonly timesLeague = timesLeague;

  protected readonly pitcher = signal<Chosen | null>({ id: 'martp001', name: 'Pedro Martinez', year: 1999, line: '313 K, 37 BB in 835 batters faced' });
  protected readonly batter = signal<Chosen | null>({ id: 'ruthb101', name: 'Babe Ruth', year: 1927, line: '192 H, 60 HR, 137 BB in 691 PA' });

  protected readonly picking = signal<Role | null>(null);
  protected readonly query = signal('');
  protected readonly hits = signal<PlayerHit[]>([]);
  protected readonly seasonsFor = signal<PlayerHit | null>(null);
  protected readonly seasons = signal<SeasonItem[]>([]);

  protected readonly matchup = signal<MatchupView | null>(null);
  protected readonly result = signal<PitchResult | null>(null);
  protected readonly sims = signal<SimsResult | null>(null);
  protected readonly showHow = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shareNote = signal<string | null>(null);

  private readonly session = sessionId();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pick = computed<Pick | null>(() => {
    const b = this.batter(), p = this.pitcher();
    return b && p ? { b: b.id, by: b.year, p: p.id, py: p.year } : null;
  });

  protected readonly resultText = computed(() => {
    const m = this.matchup(), r = this.result();
    if (!m || !r) return '';
    const step = m.steps.find(s => s.outcome.toLowerCase() === r.outcome);
    return step ? explain(r.outcome, step, m.batter.name, m.pitcher.name) : '';
  });

  constructor() {
    api.event('open', this.session);
    const shared = typeof location !== 'undefined' ? parseShare(location.search) : null;
    if (shared) {
      this.batter.set({ id: shared.pick.b, name: shared.pick.b, year: shared.pick.by, line: '' });
      this.pitcher.set({ id: shared.pick.p, name: shared.pick.p, year: shared.pick.py, line: '' });
      api.event('share_open', this.session);
      this.load().then(() => this.throwPitch(shared.seed));
    } else {
      this.load();
    }
  }

  protected async load() {
    const p = this.pick();
    this.result.set(null); this.sims.set(null); this.error.set(null);
    if (!p) { this.matchup.set(null); return; }
    try {
      this.busy.set(true);
      const m = await api.matchup(p);
      this.matchup.set(m);
      // Shared links arrive with ids only; fill names from the matchup.
      this.batter.update(b => b && { ...b, name: m.batter.name });
      this.pitcher.update(x => x && { ...x, name: m.pitcher.name });
      api.event('matchup_view', this.session);
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected openPicker(role: Role) {
    this.picking.set(role); this.query.set(''); this.hits.set([]); this.seasonsFor.set(null); this.seasons.set([]);
  }

  protected closePicker() { this.picking.set(null); }

  protected onQuery(value: string) {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    const role = this.picking();
    if (!role || value.trim().length < 1) { this.hits.set([]); return; }
    this.searchTimer = setTimeout(async () => {
      try { this.hits.set(await api.search(value, role)); } catch (e) { this.error.set((e as Error).message); }
    }, 150);
  }

  protected async choosePlayer(h: PlayerHit) {
    const role = this.picking();
    if (!role) return;
    this.seasonsFor.set(h);
    try { this.seasons.set((await api.seasons(h.id, role)).slice().reverse()); } catch (e) { this.error.set((e as Error).message); }
  }

  protected chooseSeason(s: SeasonItem) {
    const h = this.seasonsFor(), role = this.picking();
    if (!h || !role) return;
    const chosen: Chosen = { id: h.id, name: h.name, year: s.year, line: s.line };
    (role === 'pit' ? this.pitcher : this.batter).set(chosen);
    this.picking.set(null);
    this.load();
  }

  protected async throwPitch(seed?: string) {
    const p = this.pick();
    if (!p) return;
    try {
      this.busy.set(true); this.result.set(null); this.shareNote.set(null);
      await new Promise(r => setTimeout(r, 450)); // short wind-up so the result lands as a moment
      this.result.set(await api.pitch(p, seed));
      if (!seed) api.event('pitch', this.session);
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected async runSims() {
    const p = this.pick();
    if (!p) return;
    try { this.busy.set(true); this.sims.set(await api.sims(p)); api.event('sim1000', this.session); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected async share() {
    const p = this.pick(), r = this.result(), m = this.matchup();
    if (!p || !r || !m) return;
    const url = shareUrl(location.origin, p, r.seed, r.engineVersion);
    const text = `${m.batter.name} (${m.batter.year}) vs ${m.pitcher.name} (${m.pitcher.year}): ${label(r.outcome)}! Can you beat it?`;
    api.event('share', this.session);
    try {
      if (navigator.share) { await navigator.share({ title: 'Pastime Rivals', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.shareNote.set('Link copied.');
    } catch { this.shareNote.set(url); }
  }

  protected barWidth(o: OutcomeKey): string {
    const m = this.matchup();
    return m ? `${(m.probabilities[o] * 100).toFixed(2)}%` : '0';
  }

  protected simShare(o: OutcomeKey): string {
    const s = this.sims();
    return s ? `${(s.counts[o] / s.n * 100).toFixed(1)}%` : '';
  }

  protected stepFor(o: OutcomeKey) {
    return this.matchup()?.steps.find(s => s.outcome.toLowerCase() === o);
  }

  protected isHit(o: OutcomeKey) { return o === 'single' || o === 'double' || o === 'triple' || o === 'hr'; }
}
