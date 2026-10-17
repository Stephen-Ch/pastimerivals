import { Component, computed, effect, ElementRef, signal, viewChild } from '@angular/core';
import { api, MatchupView, PitchResult, PlayerHit, Report, SeasonItem, SimsResult } from './api';
import { ReportView } from './report';
import { PitchScene } from './pitch-scene';
import { ArtManifest, Era, eraOf, PairArt, pairArt, PlayerArt, preloadImages } from './art';
import { callFor, countFor, explain, label, OUTCOMES, OutcomeKey, parseShare, percent, Pick, shareUrl, timesLeague } from './logic';

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
  imports: [ReportView, PitchScene],
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
  protected readonly seasonsLoading = signal(false);
  protected readonly seasonsError = signal(false);
  protected readonly defaultSeason = computed(() => this.seasons().find(s => s.isDefault) ?? null);
  private seasonsToken = 0;
  private readonly sheetTitle = viewChild<ElementRef<HTMLElement>>('sheetTitle');

  protected readonly matchup = signal<MatchupView | null>(null);
  protected readonly result = signal<PitchResult | null>(null);
  protected readonly sims = signal<SimsResult | null>(null);
  protected readonly showHow = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly shareNote = signal<string | null>(null);
  protected readonly batterReport = signal<Report | null>(null);
  protected readonly pitcherReport = signal<Report | null>(null);
  protected readonly popup = signal<Report | null>(null);
  protected readonly pending = signal<PitchResult | null>(null);  // result known, animation playing
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('reportDialog');
  private returnFocus: HTMLElement | null = null;

  private readonly session = sessionId();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly pick = computed<Pick | null>(() => {
    const b = this.batter(), p = this.pitcher();
    return b && p ? { b: b.id, by: b.year, p: p.id, py: p.year } : null;
  });

  /** Count shown with the result, e.g. "3-2". For show only (plan 11). */
  protected readonly countText = computed(() => {
    const r = this.result();
    if (!r) return '';
    const c = countFor(r.outcome, r.seed);
    return `${c.balls}-${c.strikes}`;
  });

  /** Plan 21: call for the pitch being animated, so the ball flight matches what the announcer will say. */
  protected readonly sceneCall = computed(() => {
    const r = this.pending(), m = this.matchup();
    if (!r || !m) return null;
    return callFor(r.outcome, r.seed, countFor(r.outcome, r.seed), m.batter.name,
      this.batterReport()?.bats ?? m.batter.hand, this.pitcherReport()?.throws ?? m.pitcher.hand);
  });

  /** Announcer line, e.g. "Babe Ruth grounded out to second." For show only (plan 12). */
  protected readonly callText = computed(() => {
    const r = this.result(), m = this.matchup();
    if (!r || !m) return '';
    return callFor(r.outcome, r.seed, countFor(r.outcome, r.seed), m.batter.name,
      this.batterReport()?.bats ?? m.batter.hand, this.pitcherReport()?.throws ?? m.pitcher.hand).text;
  });

  protected readonly resultText = computed(() => {
    const m = this.matchup(), r = this.result();
    if (!m || !r) return '';
    const step = m.steps.find(s => s.outcome.toLowerCase() === r.outcome);
    return step ? explain(r.outcome, step, m.batter.name, m.pitcher.name) : '';
  });

  // ---- Plan 18: comic art ----
  private readonly manifest = signal<ArtManifest | null>(null);
  /** Art for both players of the current matchup, or null (then both use drawn figures). */
  protected readonly pair = computed<PairArt | null>(() => {
    const p = this.pitcherReport(), b = this.batterReport();
    if (!p || !b) return null;
    return pairArt(this.manifest(), { id: p.id, era: eraOf(p.year), hand: p.throws }, { id: b.id, era: eraOf(b.year), hand: b.bats === 'L' ? 'L' : 'R' });
  });
  private readonly artOk = signal(false);
  private artReady: Promise<boolean> = Promise.resolve(false);
  protected readonly artWaiting = signal(false);
  protected readonly sceneArt = signal<PairArt | null>(null);

  protected cardFor(r: { id: string; role: string }): PlayerArt | null {
    const a = this.pair();
    if (!a) return null;
    if (r.role === 'pit' && r.id === this.pitcherReport()?.id) return a.pit;
    if (r.role === 'bat' && r.id === this.batterReport()?.id) return a.bat;
    return null;
  }

  protected wrongLook() { api.event('art_wrong_look', this.session); }

  constructor() {
    fetch('/art-manifest.json').then(r => (r.ok ? r.json() : null)).then(m => this.manifest.set(m && m.tones && m.sheets && m.cards ? (m as ArtManifest) : null)).catch(() => undefined);
    effect(() => {
      const a = this.pair();
      this.artOk.set(false);
      if (!a) { this.artReady = Promise.resolve(false); return; }
      this.artReady = preloadImages([a.pit.sheet, a.bat.sheet, a.pit.card, a.bat.card]).then(ok => {
        if (this.pair() === a) this.artOk.set(ok);
        return ok;
      });
    });
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
      const [br, pr] = await Promise.all([api.card(p.b, p.by, 'bat'), api.card(p.p, p.py, 'pit')]);
      this.batterReport.set(br); this.pitcherReport.set(pr);
      if (this.manifest() && !this.pair()) api.event('art_fallback', this.session);
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected openPicker(role: Role) {
    this.seasonsToken++;
    this.picking.set(role); this.query.set(''); this.hits.set([]); this.seasonsFor.set(null); this.seasons.set([]);
    this.seasonsLoading.set(false); this.seasonsError.set(false);
  }

  protected closePicker() { this.seasonsToken++; this.picking.set(null); }

  protected backToSearch() {
    this.seasonsToken++;
    this.seasonsFor.set(null); this.seasons.set([]); this.seasonsLoading.set(false); this.seasonsError.set(false);
    this.focusTitle();
  }

  private focusTitle() { setTimeout(() => this.sheetTitle()?.nativeElement.focus(), 0); }

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
    // A repeat tap on the same player while loading does nothing; a different player wins.
    if (this.seasonsLoading() && this.seasonsFor()?.id === h.id) return;
    const token = ++this.seasonsToken;
    this.seasonsFor.set(h); this.seasons.set([]); this.seasonsError.set(false); this.seasonsLoading.set(true);
    this.focusTitle();
    try {
      const list = (await api.seasons(h.id, role)).slice().reverse();
      if (token === this.seasonsToken) this.seasons.set(list);
    } catch {
      if (token === this.seasonsToken) this.seasonsError.set(true);
    } finally {
      if (token === this.seasonsToken) this.seasonsLoading.set(false);
    }
  }

  protected retrySeasons() {
    const h = this.seasonsFor();
    if (h) { this.seasonsLoading.set(false); this.choosePlayer(h); }
  }

  protected chooseSeason(s: SeasonItem) {
    const h = this.seasonsFor(), role = this.picking();
    if (!h || !role) return;
    const chosen: Chosen = { id: h.id, name: h.name, year: s.year, line: s.line };
    (role === 'pit' ? this.pitcher : this.batter).set(chosen);
    this.seasonsToken++;
    this.picking.set(null);
    this.load();
  }

  protected async throwPitch(seed?: string) {
    const p = this.pick();
    if (!p) return;
    try {
      this.busy.set(true); this.result.set(null); this.shareNote.set(null);
      const r = await api.pitch(p, seed);
      if (!seed) api.event('pitch', this.session);
      if (this.pair() && !this.artOk()) {
        // Wait up to 3 s for the art; otherwise this pitch uses the drawn figures (never swap mid-pitch).
        this.artWaiting.set(true);
        await Promise.race([this.artReady, new Promise(res => setTimeout(res, 3000))]);
        this.artWaiting.set(false);
      }
      this.sceneArt.set(this.artOk() ? this.pair() : null);
      this.pending.set(r);   // the scene plays, then sceneDone() reveals the result
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected sceneDone() {
    const r = this.pending();
    if (!r) return;
    this.pending.set(null);
    this.result.set(r);
  }

  protected pitcherEra(): Era { return eraOf(this.pitcher()?.year ?? 2000); }

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
    const text = `${this.callText()} (${m.batter.name} ${m.batter.year} vs ${m.pitcher.name} ${m.pitcher.year}) Can you beat it?`;
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

  protected openReport(r: Report | null, ev: Event) {
    if (!r) return;
    this.returnFocus = ev.currentTarget as HTMLElement;
    this.popup.set(r);
    queueMicrotask(() => this.dialog()?.nativeElement.showModal());
  }

  protected closeReport() {
    this.dialog()?.nativeElement.close();
  }

  protected onDialogClosed() {
    this.popup.set(null);
    this.returnFocus?.focus();
  }

  protected onDialogClick(ev: MouseEvent) {
    // A click on the backdrop (the dialog element itself, outside its content) closes it.
    if (ev.target === this.dialog()?.nativeElement) this.closeReport();
  }

  protected isHit(o: OutcomeKey) { return o === 'single' || o === 'double' || o === 'triple' || o === 'hr'; }
}
