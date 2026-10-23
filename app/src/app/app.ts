import { HowSim, InfoKind } from './how-sim';
import { isCold, navDepth, pushEntry, stampBase } from './nav';
import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { api, MatchupView, PitchResult, PlayerHit, Report, SeasonItem, SimsResult } from './api';
import { ReportView } from './report';
import { ChallengeFlow } from './challenge';
import { Feedback, feedbackDue } from './feedback';
import { capi } from './challenge-api';
import { PitchScene } from './pitch-scene';
import { sideLine } from './side-line';
import { ArtManifest, Era, eraOf, figure, isFirstVisit, PairArt, pairArt, PlayerArt, preloadImages, SEEN_KEY, SideArt, sideArt, WindupArt, windupArt } from './art';
import { battingLine, callFor, countFor, Deco, DECORATION_VERSION, explain, hitsFrom, label, OUTCOMES, OutcomeKey, parseShare, percent, Pick, rate3, resolveDeco, shareUrl, timesLeague } from './logic';

type Role = 'bat' | 'pit';
interface Chosen { id: string; name: string; year: number; line: string; }
/** Plan 36/39: the first-visit matchup (and the fallback when a random one cannot be had). */
const DEFAULT_PITCHER: Chosen = { id: 'martp001', name: 'Pedro Martinez', year: 1999, line: '313 K, 37 BB in 835 batters faced' };
const DEFAULT_BATTER: Chosen = { id: 'ruthb101', name: 'Babe Ruth', year: 1927, line: '192 H, 60 HR, 137 BB in 691 PA' };

/** Plan 39: one random opening pair from the server. */
export interface RandomPair { pitcher: Chosen; batter: Chosen; }
/** Plan 39: the first pair where both players have drawn art; else the first pair; null when there is none. */
export function choosePair(pairs: RandomPair[] | null, manifest: ArtManifest | null): RandomPair | null {
  if (!pairs?.length) return null;
  const art = manifest?.tones;
  return (art && pairs.find(p => !!art[p.pitcher.id] && !!art[p.batter.id])) || pairs[0];
}

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
  imports: [ReportView, PitchScene, ChallengeFlow, Feedback, HowSim],
  styleUrls: ['./app.css', './sims.css', './home.css'],
  templateUrl: './app.html',
})
export class App {
  protected readonly outcomes = OUTCOMES;
  protected readonly label = label;
  protected readonly percent = percent;
  protected readonly timesLeague = timesLeague;

  protected readonly pitcher = signal<Chosen | null>(DEFAULT_PITCHER);
  protected readonly batter = signal<Chosen | null>(DEFAULT_BATTER);

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
  /** Plan 40 B: which side of the plate the batter stands on. */
  protected readonly sideText = computed(() => sideLine(this.batterReport()?.bats ?? this.matchup()?.batter.hand, this.pitcherReport()?.throws ?? this.matchup()?.pitcher.hand));
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

  /** Plan 27/39: from the matchup (home). vs null opens "Your games". */
  protected openChallenge(vs: 'cpu' | 'friend' | null = null) {
    if (this.firstView()) { try { this.storage()?.setItem(SEEN_KEY, '1'); } catch { /* fine */ } }   // plan 39 R8
    if (this.canHistory()) pushEntry('challenge', vs ? `/c/new?vs=${vs}` : '/c/new');
    this.challengeVs.set(vs);
    this.challengeKey.update(k => k + 1);
    this.challenge.set(null);
  }

  /**
   * Every "‹ Home" link (plan 39): steps back to the matchup's own history entry, however many screens were opened since;
   * a game link opened cold has no matchup behind it, so its entry becomes "/" in place.
   */
  private leaving = false;
  protected leaveChallenge() {
    const d = this.canHistory() ? navDepth() : 0;
    if (d > 0) { this.leaving = true; history.go(-d); return; }   // onPopState finishes the switch
    if (this.canHistory()) { try { history.replaceState({ depth: 0 }, '', '/'); } catch { /* fine */ } }
    this.challenge.set(undefined);
    this.goHome();
  }

  // ---- Plan 39: the matchup is home ----
  protected readonly myGames = signal(0);
  /** Plan 38/39: info sheets (How the sim works, Simulate, About the art). */
  protected readonly info = signal<InfoKind | null>(null);

  protected goHome() {
    this.overlay.set(null); this.pending.set(null); this.info.set(null);
    this.playPushed = false; this.overlayPushed = false;   // plan 39 X1: the next Pitch pushes its own entry
    this.screen.set('matchup');
    if (!this.matchup() && !this.busy() && this.pick()) this.load();
    capi.mine().then(m => this.myGames.set(m.length)).catch(() => undefined);
  }

  // ---- Plan 23: one screen at a time ----
  protected readonly roles = ['pit', 'bat'] as const;
  protected readonly screen = signal<'matchup' | 'atbat' | 'result'>('matchup');
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
    if (this.screen() === 'matchup' && !this.playPushed && this.canHistory()) { pushEntry('play'); this.playPushed = true; }
    this.screen.set('atbat');
  }

  private toMatchup() { this.pending.set(null); this.screen.set('matchup'); }

  /** On-screen back (standalone PWAs have no browser Back). */
  protected goBack() {
    if (this.playPushed && this.canHistory()) history.back();
    else this.toMatchup();
  }

  private pushOverlay() {
    if (!this.overlayPushed && this.canHistory()) { pushEntry('overlay'); this.overlayPushed = true; }
  }

  protected openOverlay(o: 'details' | 'why' | 'sims') { this.overlay.set(o); this.pushOverlay(); }

  private closeOverlays() { this.overlay.set(null); this.seasonsToken++; this.picking.set(null); }

  protected closeOverlay() {
    if (this.overlayPushed && this.canHistory()) history.back();
    else this.closeOverlays();
  }

  private onPopState() {
    if (this.leaving) {
      // Plan 39: "‹ Home" stepped back to the base entry; a cold game link there becomes the matchup in place.
      this.leaving = false;
      if (isCold()) { try { history.replaceState({ depth: 0 }, '', '/'); } catch { /* fine */ } }
      this.challenge.set(undefined);
      this.goHome(); return;
    }
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
  protected readonly sceneArt = signal<SideArt | null>(null);
  /** Plan 36/40: pitcher windup before every pitch (both or neither with the batter's side art). */
  protected readonly sceneWindup = signal<WindupArt | null>(null);
  protected readonly windup = computed<WindupArt | null>(() => {
    const p = this.pitcherReport();
    return p ? windupArt(this.manifest(), p.id, eraOf(p.year), p.throws) : null;
  });
  private readonly windupOk = signal(false);
  private windupReady: Promise<boolean> = Promise.resolve(false);
  /** Plan 36/39: first visit (hint line, art note, first_view event); the first result offers an inning. */
  protected readonly firstView = signal(false);
  protected readonly firstResult = signal(false);
  private storage(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }
  /** Plan 32C: the batter's side-on sheet for the scene (only this one image is needed to animate). */
  protected readonly side = computed<SideArt | null>(() => {
    const b = this.batterReport();
    return b ? sideArt(this.manifest(), b.id, b.year) : null;
  });
  private readonly sideOk = signal(false);
  private sideReady: Promise<boolean> = Promise.resolve(false);

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
    const manifestLoad: Promise<ArtManifest | null> = (typeof fetch === 'function' ? fetch('/art-manifest.json') : Promise.reject())
      .then(r => (r.ok ? r.json() : null)).then(m => (m && m.tones && m.sheets && m.cards ? (m as ArtManifest) : null)).catch(() => null);
    manifestLoad.then(m => this.manifest.set(m));
    effect(() => {
      const a = this.pair();
      this.artOk.set(false);
      if (!a) { this.artReady = Promise.resolve(false); return; }
      this.artReady = preloadImages([a.pit.card, a.bat.card]).then(ok => {
        if (this.pair() === a) this.artOk.set(ok);
        return ok;
      });
    });
    effect(() => {
      const s = this.side();
      this.sideOk.set(false);
      if (!s) { this.sideReady = Promise.resolve(false); return; }
      this.sideReady = preloadImages([s.sheet]).then(ok => { if (this.side() === s) this.sideOk.set(ok); return ok; });
    });
    effect(() => {
      const w = this.windup();
      this.windupOk.set(false);
      if (!w) { this.windupReady = Promise.resolve(false); return; }
      this.windupReady = preloadImages([w.sheet]).then(ok => { if (this.windup() === w) this.windupOk.set(ok); return ok; });
    });
    api.event('open', this.session, sourceFromSearch());
    if (this.canHistory()) stampBase(this.challenge() !== undefined);   // plan 39: history depth
    const shared = typeof location !== 'undefined' ? parseShare(location.search) : null;
    if (shared) {
      const rd = resolveDeco(shared.deco);
      this.deco.set(rd.deco); this.staleApp.set(rd.unknown);
      this.screen.set('matchup');
      this.batter.set({ id: shared.pick.b, name: shared.pick.b, year: shared.pick.by, line: '' });
      this.pitcher.set({ id: shared.pick.p, name: shared.pick.p, year: shared.pick.py, line: '' });
      api.event('share_open', this.session);
      this.load().then(() => this.throwPitch(shared.seed));
    } else {
      const first = isFirstVisit(false, this.storage());
      if (first) this.load();
      else void this.randomOpener(manifestLoad);   // plan 39 E: returning visitors get a random matchup
      capi.mine().then(m => this.myGames.set(m.length)).catch(() => undefined);
      if (this.challenge() === undefined && first) {
        this.firstView.set(true);
        api.event('first_view', this.session);
      }
    }
  }

  /**
   * Plan 39 E: a random opening matchup. Starts with no players (so Pedro vs Ruth never flashes), waits for the pairs and
   * the art list (art list up to 2 s), takes the first pair with art for both, else the first pair, else Pedro vs Ruth.
   */
  private async randomOpener(manifestLoad: Promise<ArtManifest | null>) {
    this.pitcher.set(null); this.batter.set(null);
    let pairs: RandomPair[] | null = null;
    try { pairs = await api.randomPairs(12); } catch { pairs = null; }
    const m = pairs?.length ? await Promise.race([manifestLoad, new Promise<null>(res => setTimeout(() => res(null), 2000))]) : null;
    if (this.pitcher() || this.batter()) return;   // the player already chose someone
    const pick = choosePair(pairs, m);
    this.pitcher.set(pick?.pitcher ?? DEFAULT_PITCHER);
    this.batter.set(pick?.batter ?? DEFAULT_BATTER);
    await this.load();
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
      if (this.side() && !this.sideOk()) {
        // Wait up to 3 s for the batter's sheet; otherwise this pitch shows text only (never swap mid-pitch).
        this.artWaiting.set(true);
        await Promise.race([Promise.all([this.sideReady, this.windupReady]), new Promise(res => setTimeout(res, 3000))]);
        this.artWaiting.set(false);
      }
      this.sceneArt.set(this.sideOk() ? this.side() : null);
      this.sceneWindup.set(this.sideOk() && this.windupOk() ? this.windup() : null);   // both or neither
      if (!seed && this.firstView()) {
        try { this.storage()?.setItem(SEEN_KEY, '1'); } catch { /* private mode: fine */ }
        this.firstView.set(false); this.firstResult.set(true);
      } else this.firstResult.set(false);
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
