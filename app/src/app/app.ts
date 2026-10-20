import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { api, MatchupView, PitchResult, PlayerHit, Report, SeasonItem, SimsResult } from './api';
import { ReportView } from './report';
import { ChallengeFlow } from './challenge';
import { Feedback, feedbackDue } from './feedback';
import { capi } from './challenge-api';
import { PitchScene } from './pitch-scene';
import { ArtManifest, Era, eraOf, figure, PairArt, pairArt, PlayerArt, preloadImages } from './art';
import { battingLine, callFor, countFor, Deco, DECORATION_VERSION, explain, hitsFrom, label, OUTCOMES, OutcomeKey, parseShare, percent, Pick, rate3, resolveDeco, shareUrl, timesLeague } from './logic';

type Role = 'bat' | 'pit';
interface Chosen { id: string; name: string; year: number; line: string; }

/** Plan 24: /c/new starts a challenge, /c/{code} opens one. */
export function challengeFromPath(path = typeof location !== 'undefined' ? location.pathname : '/'): string | null | undefined {
  const m = /^\/c\/([A-Za-z0-9_-]{1,40})\/?$/.exec(path);
  if (!m) return undefined;
  return m[1] === 'new' ? null : m[1];
}

/** Plan 27: ?vs=cpu or ?vs=friend on /c/new opens straight at the pitcher pick. */
export function vsFromSearch(search = typeof location !== 'undefined' ? location.search : ''): 'cpu' | 'friend' | null {
  const v = new URLSearchParams(search).get('vs');
  return v === 'cpu' || v === 'friend' ? v : null;
}

/** Plan 29: where a visit came from (utm_source, else ref): lowercase letters, digits and dashes, max 30; else null. */
export function sourceFromSearch(search = typeof location !== 'undefined' ? location.search : ''): string | null {
  const p = new URLSearchParams(search);
  const v = (p.get('utm_source') ?? p.get('ref') ?? '').trim().toLowerCase();
  return /^[a-z0-9-]{1,30}$/.test(v) ? v : null;
}

function sessionId(): string {
  try {
    let s = sessionStorage.getItem('pr-session');
    if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('pr-session', s); }
    return s;
  } catch { return 'no-storage'; }
}

@Component({
  selector: 'app-root',
  imports: [ReportView, PitchScene, ChallengeFlow, Feedback],
  styleUrls: ['./app.css', './sims.css'],
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
  protected readonly pending = signal<PitchResult | null>(null);
  protected readonly askFeedback = signal(false);
  /** Plan 32A: decoration version of the pitch on screen (a shared link keeps its own; new pitches use the newest). */
  protected readonly deco = signal<Deco>(DECORATION_VERSION);
  protected readonly staleApp = signal(false);
  protected readonly hitsFrom = hitsFrom;
  protected reload() { location.reload(); }  // result known, animation playing
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
    const c = countFor(r.outcome, r.seed, this.deco());
    return `${c.balls}-${c.strikes}`;
  });

  /** Plan 21: call for the pitch being animated, so the ball flight matches what the announcer will say. */
  protected readonly sceneCall = computed(() => {
    const r = this.pending(), m = this.matchup();
    if (!r || !m) return null;
    return callFor(r.outcome, r.seed, countFor(r.outcome, r.seed, this.deco()), m.batter.name,
      this.batterReport()?.bats ?? m.batter.hand, this.pitcherReport()?.throws ?? m.pitcher.hand, this.deco(), this.batter()?.year);
  });

  /** Announcer line, e.g. "Babe Ruth grounded out to second." For show only (plan 12). */
  protected readonly callText = computed(() => {
    const r = this.result(), m = this.matchup();
    if (!r || !m) return '';
    return callFor(r.outcome, r.seed, countFor(r.outcome, r.seed, this.deco()), m.batter.name,
      this.batterReport()?.bats ?? m.batter.hand, this.pitcherReport()?.throws ?? m.pitcher.hand, this.deco(), this.batter()?.year).text;
  });

  protected readonly resultText = computed(() => {
    const m = this.matchup(), r = this.result();
    if (!m || !r) return '';
    const step = m.steps.find(s => s.outcome.toLowerCase() === r.outcome);
    return step ? explain(r.outcome, step, m.batter.name, m.pitcher.name) : '';
  });

  // ---- Plan 24: challenges. undefined = solo play, null = start a new challenge, string = a challenge code ----
  protected readonly challenge = signal<string | null | undefined>(challengeFromPath());
  protected readonly challengeKey = signal(0);

  protected readonly challengeVs = signal<'cpu' | 'friend' | null>(vsFromSearch());

  /** Plan 27: from Home. vs null opens "Your games". */
  protected openChallenge(vs: 'cpu' | 'friend' | null = null) {
    if (this.canHistory()) history.pushState({ pr: 'challenge' }, '', vs ? `/c/new?vs=${vs}` : '/c/new');
    this.challengeVs.set(vs);
    this.challengeKey.update(k => k + 1);
    this.challenge.set(null);
  }

  /** Every "Home" link: switches in place (a share link opened cold has no Home behind it in history). */
  protected leaveChallenge() {
    if (this.canHistory()) history.pushState({}, '', '/');
    this.challenge.set(undefined);
    this.goHome();
  }

  // ---- Plan 27: Home ----
  protected readonly myGames = signal(0);
  private practicePushed = false;

  protected goHome() {
    this.overlay.set(null); this.pending.set(null);
    this.screen.set('home');
    capi.mine().then(m => this.myGames.set(m.length)).catch(() => undefined);
  }

  protected openPractice() {
    if (this.canHistory() && !this.practicePushed) { history.pushState({ pr: 'practice' }, ''); this.practicePushed = true; }
    this.screen.set('matchup');
  }

  // ---- Plan 23: one screen at a time ----
  protected readonly roles = ['pit', 'bat'] as const;
  protected readonly screen = signal<'home' | 'matchup' | 'atbat' | 'result'>('home');
  protected readonly overlay = signal<'details' | 'why' | 'sims' | null>(null);
  protected readonly rate3 = rate3;
  protected readonly simLine = computed(() => { const s = this.sims(); return s ? battingLine(s.counts, s.n) : null; });
  private readonly screenTitle = viewChild<ElementRef<HTMLElement>>('screenTitle');
  private readonly sanitizer = inject(DomSanitizer);
  private playPushed = false;     // history entry for the at-bat/result screens
  private overlayPushed = false;  // history entry for an open pop-up (details, why, picker)

  /** Three likeliest outcomes, e.g. "Out in play 36% · Strikeout 30% · Walk 12%". */
  protected readonly topText = computed(() => {
    const m = this.matchup();
    if (!m) return '';
    return [...OUTCOMES].sort((a, b) => m.probabilities[b] - m.probabilities[a]).slice(0, 3)
      .map(o => `${label(o)} ${(m.probabilities[o] * 100).toFixed(0)}%`).join(' · ');
  });

  protected readonly simSummary = computed(() => {
    const l = this.simLine();
    return l ? `${rate3(l.avg)} average, ${l.hr} HR, ${l.k} K in 1,000 tries` : '';
  });

  // Our own generated SVG from fixed parameters only, so it is safe to trust.
  protected figureFor(r: Report) {
    return this.sanitizer.bypassSecurityTrustHtml(figure(eraOf(r.year), r.role, r.role === 'pit' ? r.throws : (r.bats === 'L' ? 'L' : 'R')));
  }

  protected retry() { this.load(); }

  private canHistory() { return typeof history !== 'undefined' && typeof history.pushState === 'function'; }

  private enterPlay() {
    if (this.screen() === 'matchup' && !this.playPushed && this.canHistory()) { history.pushState({ pr: 'play' }, ''); this.playPushed = true; }
    this.screen.set('atbat');
  }

  private toMatchup() { this.pending.set(null); this.screen.set('matchup'); }

  /** On-screen back (standalone PWAs have no browser Back). */
  protected goBack() {
    if (this.playPushed && this.canHistory()) history.back();
    else this.toMatchup();
  }

  private pushOverlay() {
    if (!this.overlayPushed && this.canHistory()) { history.pushState({ pr: 'overlay' }, ''); this.overlayPushed = true; }
  }

  protected openOverlay(o: 'details' | 'why' | 'sims') { this.overlay.set(o); this.pushOverlay(); }

  private closeOverlays() { this.overlay.set(null); this.seasonsToken++; this.picking.set(null); }

  protected closeOverlay() {
    if (this.overlayPushed && this.canHistory()) history.back();
    else this.closeOverlays();
  }

  private onPopState() {
    const c = challengeFromPath();
    if (c !== undefined || this.challenge() !== undefined) {
      this.challengeKey.update(k => k + 1);
      this.challengeVs.set(vsFromSearch());
      this.challenge.set(c);
      if (c !== undefined) return;
      this.goHome(); return;
    }
    if (this.overlayPushed) { this.overlayPushed = false; this.closeOverlays(); return; }
    if (this.playPushed) { this.playPushed = false; this.toMatchup(); return; }
    if (this.practicePushed) { this.practicePushed = false; this.goHome(); }
  }

  // ---- Plan 18: comic art ----
  protected readonly manifest = signal<ArtManifest | null>(null);
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
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => this.onPopState());
      // Plan 23: pop-ups size to the visible viewport so the phone keyboard never covers the search box.
      const vv = window.visualViewport;
      const setVh = () => document.documentElement.style.setProperty('--vvh', `${vv ? vv.height : window.innerHeight}px`);
      setVh();
      vv?.addEventListener('resize', setVh);
    }
    effect(() => { this.screen(); setTimeout(() => this.screenTitle()?.nativeElement.focus({ preventScroll: true }), 0); });
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
    api.event('open', this.session, sourceFromSearch());
    const shared = typeof location !== 'undefined' ? parseShare(location.search) : null;
    if (shared) {
      const rd = resolveDeco(shared.deco);
      this.deco.set(rd.deco); this.staleApp.set(rd.unknown);
      this.screen.set('matchup');   // plan 27: share links skip Home
      this.batter.set({ id: shared.pick.b, name: shared.pick.b, year: shared.pick.by, line: '' });
      this.pitcher.set({ id: shared.pick.p, name: shared.pick.p, year: shared.pick.py, line: '' });
      api.event('share_open', this.session);
      this.load().then(() => this.throwPitch(shared.seed));
    } else {
      this.load();
      if (this.challenge() === undefined) capi.mine().then(m => this.myGames.set(m.length)).catch(() => undefined);
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
    this.pushOverlay();
    this.seasonsToken++;
    this.picking.set(role); this.query.set(''); this.hits.set([]); this.seasonsFor.set(null); this.seasons.set([]);
    this.seasonsLoading.set(false); this.seasonsError.set(false);
  }

  protected closePicker() { this.closeOverlay(); }

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
    this.closeOverlay();
    this.load();
  }

  protected async throwPitch(seed?: string) {
    const p = this.pick();
    if (!p) return;
    try {
      this.busy.set(true); this.result.set(null); this.shareNote.set(null);
      if (!seed) this.deco.set(DECORATION_VERSION);
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
      this.enterPlay();
    } catch (e) { this.error.set((e as Error).message); this.toMatchup(); }
    finally { this.busy.set(false); }
  }

  protected sceneDone() {
    const r = this.pending();
    if (!r) return;
    this.pending.set(null);
    this.result.set(r);
    this.askFeedback.set(feedbackDue('p' + Date.now(), 3));   // plan 30: from the 3rd practice pitch
    this.screen.set('result');
  }

  protected pitcherEra(): Era { return eraOf(this.pitcher()?.year ?? 2000); }

  protected async runSims() {
    const p = this.pick();
    if (!p) return;
    try {
      this.busy.set(true); this.sims.set(await api.sims(p)); api.event('sim1000', this.session);
      // Plan 25: results open in their own sheet so they are seen.
      if (this.overlay() !== 'sims') this.openOverlay('sims');
    }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected async share() {
    const p = this.pick(), r = this.result(), m = this.matchup();
    if (!p || !r || !m) return;
    const url = shareUrl(location.origin, p, r.seed, r.engineVersion, this.deco());
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

  protected simWidth(o: OutcomeKey): string {
    const s = this.sims();
    if (!s) return '0';
    const max = Math.max(...OUTCOMES.map(x => s.counts[x]));
    return `${max ? (s.counts[o] / max) * 100 : 0}%`;
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
