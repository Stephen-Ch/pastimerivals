import { Feedback, feedbackDue } from './feedback';
import { Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { api, PlayerHit, SeasonItem } from './api';
import { ArtManifest, eraOf, fielderArt, lookOf, preloadImages, SideArt, sideArt, WindupArt, windupArt } from './art';
import { sideLine } from './side-line';
import { callFor, countFor, hitsFrom, label, resolveDeco } from './logic';
import { baseLine, CAP_NOTE, halfChange, halfLabel, halves, inningResult, isClashNote, namesOf, ordinal, playFacts, rowsKey, sitOut, shortName } from './inning';
import { PitchScene, SceneCue } from './pitch-scene';
import { announcerOn } from './announcer-setting';
import { intro, IntroCtx, lineText, PbpLine, pitchLines, rawLead, recapLines, RecapAb, resultLine } from './pbp';
import { bedFor, reactionFor, voice, voiceFor } from './audio';
import { voiceOn } from './voice-setting';
import { VoiceButton } from './voice-button';
import { outAt } from './inning';
import { HowSim } from './how-sim';
import { pushEntry } from './nav';
import {
  CAtBat, capi, CEra, ChallengeError, CClash, CMine, CPlayer, CSlot, CView, GameMode, keyFor, links, saveKey, setWatched, takeKeyFromHash, toBody, watched,
} from './challenge-api';

type Step = 'loading' | 'home' | 'intro' | 'pick' | 'review' | 'shared' | 'waiting' | 'play' | 'final' | 'closed';
type Mode = 'create' | 'accept' | 'rematch' | 'cpu';

export const SLOT_NAMES = ['Your pitcher', 'Batter 1', 'Batter 2', 'Batter 3'];
/** Plan 38: inning team rows (pitcher, then the batting order). */
export const INNING_ROWS = ['Your pitcher', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `Batting ${ordinal(n)}`)];

/** Plan 24: challenge a friend. One screen at a time (plan 23); the page never scrolls. */
/** Plan 26 computer levels; index = level (1-4). */
const LEVEL_NAMES = ['', 'Random players', 'Good players', 'Hall of Famers', 'Legends'];
const LEVEL_KEY = 'pr_cpu_level';
function savedLevel(): number {
  try { const n = Number(localStorage.getItem(LEVEL_KEY)); return n >= 1 && n <= 4 ? Math.floor(n) : 1; } catch { return 1; }
}
function saveLevel(n: number) { try { localStorage.setItem(LEVEL_KEY, String(n)); } catch { /* fine */ } }

@Component({
  selector: 'pr-challenge',
  imports: [PitchScene, Feedback, HowSim, VoiceButton],
  templateUrl: './challenge.html',
  styleUrls: ['./app.css', './challenge.css'],
})
export class ChallengeFlow {
  /** Challenge code from the URL, or null to start a new challenge. */
  readonly code = input<string | null>(null);
  readonly manifest = input<ArtManifest | null>(null);
  /** Plan 27: /c/new?vs=cpu or ?vs=friend opens straight at the pitcher pick. */
  readonly startMode = input<'cpu' | 'friend' | null>(null);
  readonly exit = output<void>();

  protected readonly slotNames = SLOT_NAMES;
  protected readonly inningRows = INNING_ROWS;
  protected readonly ordinal = ordinal;
  protected readonly halfLabel = halfLabel;
  protected readonly isClashNote = isClashNote;
  protected readonly capNote = CAP_NOTE;
  protected readonly shortName = shortName;

  // ---- Plan 38: inning mode ----
  /** Mode of the team being picked (or the game on screen). New games are inning games. */
  protected readonly gameMode = signal<GameMode>('inning');
  protected readonly inning = computed(() => this.gameMode() === 'inning');
  /** The side picking is the home side (its picks set the rules): new games, computer games, rematches. */
  protected readonly isHome = computed(() => this.mode() !== 'accept');
  /** Era answer for the home side (from /era), or the friend's fixed era (from the game). */
  protected readonly era = signal<CEra | null>(null);
  private readonly eraKey = signal('');
  protected readonly eraLoading = signal(false);
  private eraToken = 0;
  protected readonly sittingOut = signal<CSlot | null>(null);
  protected readonly flipNote = signal<string | null>(null);
  protected readonly updateNeeded = signal(false);
  protected readonly showHow = signal(false);
  /** Batters this team needs: 3 classic; inning 9 with the DH, 8 when the pitcher bats (9 until the rules are known). */
  protected readonly batters = computed(() => !this.inning() ? 3 : (this.isHome() ? this.era()?.batters : this.view()?.era?.batters) ?? 9);
  protected readonly rulesLine = computed(() => {
    if (!this.inning()) return '';
    if (this.isHome() && !this.slots()[0]) return 'Pick a pitcher to see the rules.';
    if (this.eraLoading()) return 'Checking the rules...';
    const e = this.isHome() ? this.era() : this.view()?.era;
    if (!e) return 'Rules follow your newest player.';
    return `Rules: ${e.dh ? 'designated hitter on' : 'pitchers bat'}${e.runnerOnSecond ? ' · Extra innings start with a runner on second' : ''}`;
  });
  protected readonly label = label;
  protected readonly step = signal<Step>('loading');
  protected readonly mode = signal<Mode>('create');
  protected readonly current = signal<string | null>(null);
  protected readonly view = signal<CView | null>(null);
  /** Plan 32A: the version this game was made with; unknown (newer app made it) = newest known plus a refresh link. */
  protected readonly deco = computed(() => resolveDeco(this.view()?.deco ?? 1));
  protected readonly hitsFrom = hitsFrom;
  protected reload() { location.reload(); }
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly note = signal<string | null>(null);
  protected readonly closedText = signal('');
  protected readonly mine = signal<CMine[]>([]);
  private readonly title = viewChild<ElementRef<HTMLElement>>('stepTitle');

  // Team being picked: 4 slots, each first choice plus up to 2 backups.
  protected readonly slots = signal<(CSlot | null)[]>([null, null, null, null]);
  protected readonly slotIndex = signal(0);
  protected readonly editRank = signal(0);
  protected readonly searching = signal(true);
  protected readonly query = signal('');
  protected readonly hits = signal<PlayerHit[]>([]);
  protected readonly seasonsFor = signal<PlayerHit | null>(null);
  protected readonly seasons = signal<SeasonItem[]>([]);
  protected readonly seasonsLoading = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchToken = 0;
  protected readonly teamDone = computed(() => {
    const n = this.batters(), rows = this.slots().slice(0, n + 1);
    if (!rows.every(s => !!s)) return false;
    if (this.inning() && this.isHome()) return !this.eraLoading() && this.eraKey() === rowsKey(this.slots(), n);
    return true;
  });
  /** D26: players the challenger already has (told once, at Lock team). They cannot be picked again. */
  protected readonly clash = signal<{ text: string[]; ids: Set<string>; slots: number[] } | null>(null);
  /** Only the clash messages for slots that still hold a taken player. */
  protected readonly clashText = computed(() => {
    const c = this.clash(), open = this.clashOpen();
    return c ? c.slots.map((sl, i) => (open.includes(sl) ? c.text[i] : null)).filter((t): t is string => !!t) : [];
  });
  protected readonly clashOpen = computed(() => {
    const c = this.clash();
    return c ? c.slots.filter(i => c.ids.has(this.slots()[i]?.choices[0]?.id ?? '')) : [];
  });

  protected readonly nickname = signal<string | null>(null);
  protected readonly nickChoices = signal<string[]>([]);
  protected readonly shareLink = signal('');
  protected readonly privateLink = signal<string | null>(null);

  // Playing out a resolved game, one tap per at-bat.
  protected readonly revealed = signal(0);
  protected readonly scene = signal<{ ab: CAtBat; art: SideArt | null; windup: WindupArt | null } | null>(null);
  protected readonly lastCall = signal<string | null>(null);

  protected readonly game = computed(() => this.view()?.game ?? null);
  protected readonly nextAtBat = computed(() => this.game()?.atBats[this.revealed()] ?? null);
  /** Plan 40 B: side of the plate for the batter now up (during the scene) or the next batter; none when the game is over. */
  protected readonly sideText = computed(() => {
    const ab = this.scene()?.ab ?? this.nextAtBat();
    return ab ? sideLine(ab.batter.bats, ab.pitcher.throws) : null;
  });
  protected readonly score = computed<[number, number]>(() => {
    const g = this.game(), n = this.revealed(), t: [number, number] = [0, 0];
    g?.atBats.slice(0, n).forEach(a => (t[a.battingSide] += a.points));
    return t;
  });
  protected readonly yourSide = computed(() => (this.view()?.you === 'creator' ? 0 : this.view()?.you === 'opponent' ? 1 : null));
  protected readonly sideName = (side: number) => {
    const v = this.view();
    const n = side === 0 ? v?.creatorName : v?.vsCpu ? 'The Computer' : v?.opponentName;
    return (n ?? 'Friend') + (this.yourSide() === side ? ' (you)' : '');
  };
  // ---- Plan 26: computer levels (a ladder: win to face tougher players) ----
  protected readonly levelNames = LEVEL_NAMES;
  /** The level of the game on screen (its stored level), not the device's saved level. */
  protected readonly gameLevel = computed(() => Math.min(4, Math.max(1, this.view()?.cpuLevel ?? 1)));
  protected readonly youWon = computed(() => { const g = this.game(); return !!g && g.winner !== -1 && g.winner === this.yourSide(); });
  protected readonly levelHint = computed(() => {
    const l = this.gameLevel(), name = LEVEL_NAMES[l];
    if (l === 4) return this.youWon() ? 'You beat the Legends, the top level.' : 'Level 4 of 4: Legends, the top level.';
    return `Level ${l} of 4: ${name}. ` + (this.youWon() ? 'Next level keeps your team.' : 'Win to face tougher players.');
  });

  /** Plan 30: asked once on entering the final screen of a player's own finished game (2nd game on), never re-evaluated by the template. */
  protected readonly askFeedback = signal(false);
  protected readonly fbResult = computed(() => { const g = this.game(); return !g ? null : g.winner === -1 ? 'draw' : this.youWon() ? 'win' : 'loss'; });
  private fbChecked: string | null = null;
  protected readonly finalText = computed(() => {
    const g = this.game(), you = this.yourSide();
    if (!g) return '';
    if (this.view()?.mode === 'inning') return inningResult(g, you, s => this.sideName(s).replace(' (you)', ''));
    if (g.winner === -1) return 'A draw after 5 extra rounds';
    if (you === null) return `${this.sideName(g.winner)} wins`;
    return g.winner === you ? 'You win!' : 'You lose';
  });

  constructor() {
    effect(() => {
      const code = this.current();
      if (this.step() !== 'final') { if (this.askFeedback()) this.askFeedback.set(false); return; }   // shown once only
      if (!code || this.yourSide() === null) return;
      if (this.fbChecked === code) return;
      this.fbChecked = code;
      this.askFeedback.set(feedbackDue(code, 2));
    });
    effect(() => { this.step(); this.slotIndex(); this.editRank(); setTimeout(() => this.title()?.nativeElement.focus({ preventScroll: true }), 0); });
    // Plan 50: the voice. Leaving the game screens stops everything; each game loads all its intros; the next-batter panel
    // speaks its intro once (after a tap this visit) and starts loading that at-bat's clips.
    voice.stopAll();
    inject(DestroyRef).onDestroy(() => voice.stopAll());
    effect(() => { const st = this.step(); if (st !== 'play' && st !== 'final') untracked(() => voice.stopAll()); });
    effect(() => {
      const g = this.game(), on = voiceOn();
      if (!g || !on) return;
      untracked(() => { void voice.enable().then(() => voice.prefetch(g.atBats.flatMap((_, i) => this.introLinesFor(i)), this.gameVoice())); });
    });
    effect(() => {
      const n = this.nextAtBat(), st = this.step(), sc = this.scene(), on = voiceOn();
      if (!on || st !== 'play' || sc || !n) return;
      untracked(() => {
        const v = this.gameVoice();
        voice.prefetch(this.atBatLines(n), v, true);
        if (this.spokenIntro === n.index || !voice.running()) return;
        this.spokenIntro = n.index;
        for (const l of this.introLinesFor(n.index)) void voice.say(l, 'intro', v);
      });
    });
    effect(() => {
      const f = this.pbpFinalLines(), on = voiceOn(), g = this.game();
      if (!on || !f.length || !g) return;
      untracked(() => {
        const last = g.atBats.length - 1;
        if (this.spokenRecap === last) return;
        this.spokenRecap = last;
        for (const l of f) void voice.say(l, 'recap', this.gameVoice());
      });
    });
    queueMicrotask(() => this.start());
  }

  private async start() {
    capi.me().then(m => { this.nickname.set(m.nickname); this.nickChoices.set(m.choices); }).catch(() => undefined);
    const c = this.code(), vs = this.startMode();
    if (c) await this.open(c);
    else if (vs) this.startFresh(vs, false);
    else await this.home();
  }

  /** Plan 27: a new game straight at the pitcher pick (from Home, "Start your own", or "Play the computer while you wait"). */
  protected startFresh(vs: 'cpu' | 'friend', push = true) {
    if (push) { pushEntry('challenge', `/c/new?vs=${vs}`); }
    this.current.set(null); this.view.set(null); this.error.set(null); this.note.set(null);
    this.mode.set(vs === 'cpu' ? 'cpu' : 'create');
    this.gameMode.set('inning');
    this.resetTeam(); this.step.set('review');
  }

  private async home() {
    this.current.set(null); this.view.set(null); this.mode.set('create');
    this.step.set('home');
    try { this.mine.set(await capi.mine()); } catch { this.mine.set([]); }
  }

  protected async open(code: string) {
    takeKeyFromHash(code);
    this.current.set(code); this.error.set(null); this.step.set('loading');
    try {
      const v = await capi.view(code);
      this.view.set(v);
      const l = links(location.origin, code, keyFor(code));
      this.shareLink.set(l.share);
      this.privateLink.set(v.you === 'visitor' ? null : l.private);
      if (v.status === 'resolved') {
        this.revealed.set(Math.min(watched(code), v.game?.atBats.length ?? 0));
        this.lastCall.set(null); this.lastPlay.set(null);
        this.step.set(this.revealed() >= (v.game?.atBats.length ?? 0) ? 'final' : 'play');
      } else if (v.you === 'creator') {
        this.step.set(v.status === 'expired' ? 'closed' : 'waiting');
        if (v.status === 'expired') this.closedText.set('Nobody took this challenge in time.');
      } else if (v.canClaim) {
        this.mode.set('accept'); this.gameMode.set(v.mode ?? 'classic'); this.resetTeam(); this.step.set('intro');
      } else {
        this.closedText.set(v.status === 'expired' ? 'This challenge expired.'
          : v.rematchOf && !v.opponentName ? 'This rematch is for someone else.' : 'Someone already took this challenge.');
        this.step.set('closed');
      }
    } catch (e) {
      this.closedText.set(e instanceof ChallengeError && e.status === 404 ? 'This challenge link does not work.' : (e as Error).message);
      this.step.set('closed');
    }
  }

  // ---- Picking ----
  private resetTeam() {
    this.clash.set(null);
    this.slots.set(Array(this.inning() ? 10 : 4).fill(null)); this.slotIndex.set(0); this.editRank.set(0); this.openSearch();
    this.era.set(null); this.eraKey.set(''); this.eraLoading.set(false); this.eraToken++; this.sittingOut.set(null); this.flipNote.set(null);
  }

  protected startPicking(mode: Mode) {
    if (mode !== 'accept') this.mode.set(mode);
    // Plan 38: new games are innings; a rematch keeps its game's mode; the friend plays the game's mode.
    this.gameMode.set(mode === 'rematch' || mode === 'accept' ? (this.view()?.mode ?? 'classic') : 'inning');
    this.resetTeam(); this.step.set(this.inning() ? 'review' : 'pick');
  }

  protected async quickPick() {
    this.busy.set(true); this.error.set(null);
    try {
      if (this.inning()) {
        const fixed = this.isHome() ? undefined : this.view()?.era?.batters;
        const q = await capi.quickpickInning(fixed);
        const rows: (CSlot | null)[] = Array(10).fill(null);
        q.slots.forEach(t => { if (t.slot >= 0 && t.slot < 10) rows[t.slot] = t; });
        this.clash.set(null); this.sittingOut.set(null); this.flipNote.set(null);
        this.slots.set(rows);
        if (this.isHome() && q.era) { this.eraToken++; this.era.set(q.era); this.eraKey.set(rowsKey(rows, q.era.batters)); this.eraLoading.set(false); }
        this.step.set('review');
        return;
      }
      const team = await capi.quickpick();
      this.slots.set([0, 1, 2, 3].map(i => team.find(t => t.slot === i) ?? null));
      this.step.set('review');
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  protected goSlot(i: number) { this.slotIndex.set(i); this.editRank.set(0); this.openSearch(!this.slots()[i]); this.step.set('pick'); }

  protected openSearch(on = true) {
    this.searchToken++;
    this.searching.set(on); this.query.set(''); this.hits.set([]); this.seasonsFor.set(null); this.seasons.set([]); this.seasonsLoading.set(false);
  }

  protected editBackup(rank: number) { this.editRank.set(rank); this.openSearch(true); }

  protected onQuery(value: string) {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    if (value.trim().length < 1) { this.hits.set([]); return; }
    const role = this.slotIndex() === 0 ? 'pit' : 'bat';
    this.searchTimer = setTimeout(async () => {
      try { this.hits.set(await api.search(value, role)); } catch (e) { this.error.set((e as Error).message); }
    }, 150);
  }

  protected async choosePlayer(h: PlayerHit) {
    const token = ++this.searchToken;
    this.seasonsFor.set(h); this.seasons.set([]); this.seasonsLoading.set(true);
    try {
      const list = (await api.seasons(h.id, this.slotIndex() === 0 ? 'pit' : 'bat')).slice().reverse();
      if (token === this.searchToken) this.seasons.set(list);
    } catch (e) { if (token === this.searchToken) this.error.set((e as Error).message); }
    finally { if (token === this.searchToken) this.seasonsLoading.set(false); }
  }

  /** Ids already on this team, other than the slot and rank being edited. */
  private usedIds(slot: number, rank: number): Set<string> {
    const ids = new Set<string>();
    this.slots().forEach((s, i) => s?.choices.forEach((c, r) => { if (!(i === slot && r === rank) && (r === 0 || i === slot)) ids.add(c.id); }));
    return ids;
  }

  protected async chooseSeason(s: SeasonItem) {
    const h = this.seasonsFor();
    if (!h) return;
    const slot = this.slotIndex(), rank = this.editRank(), token = ++this.searchToken;
    if (this.usedIds(slot, rank).has(h.id)) { this.error.set(`${h.name} is already on your team.`); return; }
    if (this.clash()?.ids.has(h.id)) { this.error.set(`Sorry, ${h.name} is playing for ${this.view()?.creatorName ?? 'your friend'}. Choose another.`); return; }
    this.error.set(null);
    const pick: CPlayer = { id: h.id, year: s.year, name: h.name, bats: h.bats, throws: h.throws, bio: h.bio ?? '' };
    const prev = this.slots()[slot];
    let choices: CPlayer[];
    if (rank === 0) {
      choices = [pick];
      this.busy.set(true);
      try {
        const used = this.usedIds(slot, 0); used.add(pick.id);
        const sim = (await capi.similar(pick.id, pick.year, slot === 0 ? 'pit' : 'bat')).filter(c => !used.has(c.id));
        choices.push(...sim.slice(0, 2));
      } catch { /* backups are optional */ }
      finally { this.busy.set(false); }
      // The player moved on while backups loaded (Back, Change, another slot): drop this result.
      if (token !== this.searchToken || this.step() !== 'pick' || this.slotIndex() !== slot) return;
    } else {
      choices = [...(prev?.choices ?? [])];
      choices[rank] = pick;
    }
    this.slots.update(list => list.map((x, i) => (i === slot ? { slot, choices } : x)));
    this.openSearch(false);
    this.editRank.set(0);
    if (rank === 0) void this.refreshEra();
  }

  /**
   * Plan 38: asks the server for the home team's rules after a first choice changes, and keeps the lineup in step:
   * no DH with 9 batters filled = the oldest-season batter sits out (rows below move up); DH back on = he returns 9th.
   * Lock waits until the latest answer is for exactly the rows that will be sent.
   */
  protected async refreshEra(): Promise<void> {
    if (!this.inning() || !this.isHome()) return;
    const token = ++this.eraToken;
    let rows = this.slots();
    if (!rows[0]) { this.era.set(null); this.eraKey.set(''); this.eraLoading.set(false); return; }
    this.eraLoading.set(true);
    try {
      const ask = (r: (CSlot | null)[]) => capi.era(r[0]!.choices[0], r.slice(1).filter((x): x is CSlot => !!x).map(x => x.choices[0]));
      let e = await ask(rows);
      if (token !== this.eraToken) return;
      if (!e.dh) {
        // Pitchers bat: at most 8 batters. Close a gap left by an empty row, then sit the oldest out if all 9 are filled.
        const filled = rows.slice(1).filter((x): x is CSlot => !!x);
        if (filled.length >= 9) {
          const r = sitOut(rows);
          rows = r.rows;
          if (r.out) {
            this.sittingOut.set(r.out);
            this.flipNote.set(`Pitchers bat in your newest player's era, so ${r.out.choices[0].name} sits out (the order below him moved up).`);
          }
        } else if (rows[9] && filled.length < 9) {
          const gap = rows.findIndex((x, i) => i > 0 && i < 9 && !x);
          if (gap > 0) rows = rows.map((x, i) => (i === gap ? { ...rows[9]!, slot: gap } : i === 9 ? null : x));
        }
        this.slots.set(rows);
        e = await ask(rows);
        if (token !== this.eraToken) return;
      } else if (this.sittingOut() && !rows[9]) {
        const back = this.sittingOut()!;
        rows = rows.map((x, i) => (i === 9 ? { ...back, slot: 9 } : x));
        this.sittingOut.set(null); this.flipNote.set(null);
        this.slots.set(rows);
        e = await ask(rows);
        if (token !== this.eraToken) return;
      }
      this.era.set(e);
      this.eraKey.set(rowsKey(rows, e.batters));
    } catch (err) {
      if (token === this.eraToken) this.error.set((err as Error).message);
    } finally {
      if (token === this.eraToken) this.eraLoading.set(false);
    }
  }

  protected nextSlot() {
    // After a clash, go straight to the next slot that still needs a new player, then back to review.
    const open = this.clashOpen();
    if (this.clash()) { if (open.length) this.goSlot(open[0]); else this.step.set('review'); return; }
    if (this.inning()) {
      // Plan 38: the next empty row, else back to the team list.
      const n = this.batters(), rows = this.slots();
      const next = rows.findIndex((x, k) => k <= n && !x);
      if (next >= 0) this.goSlot(next); else this.step.set('review');
      return;
    }
    const i = this.slotIndex();
    if (i < 3) this.goSlot(i + 1);
    else this.step.set('review');
  }

  protected prevSlot() {
    const i = this.slotIndex();
    if (this.searching() && this.slots()[i]) { this.openSearch(false); return; }
    if (this.inning()) { this.step.set('review'); return; }
    if (i > 0) this.goSlot(i - 1);
    else this.backFromPicking();
  }

  protected backFromPicking() {
    if (this.mode() === 'accept') this.step.set('intro');
    else if (this.mode() === 'rematch') this.step.set('final');
    else this.leave();   // plan 27: create and cpu go back to Home
  }

  protected chooseName(n: string) { this.nickname.set(n); }

  protected async lockTeam() {
    const slots = this.slots().slice(0, this.batters() + 1);
    if (!slots.every(Boolean) || !this.teamDone()) return;
    const body = toBody(slots as CSlot[], this.nickname() ?? this.nickChoices()[0], this.gameMode());
    this.busy.set(true); this.error.set(null);
    try {
      if (this.mode() === 'cpu') {
        await this.playComputer(body);
      } else if (this.mode() === 'accept') {
        const code = this.current()!;
        const r = await capi.lock(code, body);
        saveKey(code, r.key);
        this.privateLink.set(links(location.origin, code, r.key).private);
        this.view.set(r.view);
        this.revealed.set(0); setWatched(code, 0); this.lastCall.set(null); this.lastPlay.set(null);
        this.step.set('play');
      } else {
        const r = this.mode() === 'rematch' ? await capi.rematch(this.current()!, body) : await capi.create(body);
        saveKey(r.code, r.key);
        const l = links(location.origin, r.code, r.key);
        this.shareLink.set(l.share); this.privateLink.set(l.private);
        this.current.set(r.code);
        pushEntry('challenge', `/c/${r.code}`);
        this.step.set('shared');
      }
      if (body.nickname) this.nickname.set(body.nickname);
    } catch (e) {
      if (e instanceof ChallengeError && e.status === 409 && e.code === 'clash') {
        const c = e.data as CClash;
        this.clash.set({
          text: c.clashes.map(x => `Sorry, ${x.name} is playing for ${c.creatorName}. Choose another.`),
          ids: new Set(c.clashes.map(x => x.id)), slots: c.clashes.map(x => x.slot),
        });
        this.goSlot(c.clashes[0].slot);
        this.openSearch(true);
      } else if (e instanceof ChallengeError && e.status === 409 && e.code === 'update') {
        // Plan 38: this game was made by a newer app.
        this.updateNeeded.set(true);
        this.closedText.set('This game needs the latest version.');
        this.step.set('closed');
      } else if (e instanceof ChallengeError && e.status === 400 && typeof (e.data as { batters?: number })?.batters === 'number') {
        // Plan 38: the lineup size no longer matches the rules: home asks again; the friend reloads the game (its rules are fixed).
        this.error.set((e.data as { error?: string })?.error ?? e.message);
        if (this.isHome()) void this.refreshEra();
        else { try { this.view.set(await capi.view(this.current()!)); } catch { /* the message is enough */ } }
      } else if (e instanceof ChallengeError && e.status === 409) {
        this.closedText.set(({
          expired: 'This challenge expired.', already: 'You already started a rematch of this game.',
          not_for_you: 'This rematch is for someone else.', own: 'This is your own challenge. Send the link to a friend.',
        } as Record<string, string>)[e.code ?? ''] ?? 'Someone already took this challenge.');
        this.step.set('closed');
      } else this.error.set((e as Error).message);
    } finally { this.busy.set(false); }
  }

  /** Plan 25: the server picks the computer's team and plays the game at once; then the same tap-per-at-bat screens. */
  private async playComputer(body: ReturnType<typeof toBody>, level = savedLevel()) {
    const r = await capi.computer({ ...body, level });
    saveKey(r.code, r.key);
    this.current.set(r.code);
    this.view.set(r.view);
    this.shareLink.set(links(location.origin, r.code, null).share);
    this.privateLink.set(null);
    this.revealed.set(0); setWatched(r.code, 0); this.lastCall.set(null); this.lastPlay.set(null);
    pushEntry('challenge', `/c/${r.code}`);
    this.mode.set('cpu');
    this.step.set('play');
    let session = 'no-storage';
    try { session = sessionStorage.getItem('pr-session') ?? session; } catch { /* fine */ }
    api.event('cpu_game', session);
  }

  /** Same team against a new computer team at a level (default: this game's level). Next and easier also save the new level. */
  protected async sameTeamAgain(level = this.gameLevel()) {
    const picks = this.view()?.yourPicks;
    if (!picks) return;
    level = Math.min(4, Math.max(1, level));
    if (level !== this.gameLevel()) saveLevel(level);
    this.busy.set(true); this.error.set(null);
    // Plan 38: the stored picks replay in their own game's mode (an old classic game stays classic).
    try { await this.playComputer(toBody(picks, this.nickname() ?? undefined, this.view()?.mode ?? 'classic'), level); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  /** New team at this game's level. */
  protected newTeamSameLevel() { saveLevel(this.gameLevel()); this.startPicking('cpu'); }

  // ---- Sharing ----
  protected async shareChallenge() {
    const url = this.shareLink();
    const text = 'I picked my team on Pastime Rivals. Think you can beat it?';
    if (await this.shareOut(text, url)) this.countSent();
  }

  /** "Copy link" on the shared and waiting screens. */
  protected async copyChallengeLink() {
    if (await this.copy(this.shareLink())) this.countSent();
  }

  private countSent() { const c = this.current(); if (c) void capi.funnel(c, 'sent'); }

  protected async shareResult() {
    const g = this.game(), v = this.view();
    if (!g || !v) return;
    const score = `${v.creatorName} ${g.totals[0]}, ${v.opponentName ?? 'Friend'} ${g.totals[1]}${v.mode === 'inning' ? ' (runs)' : ''}`;
    const text = v.vsCpu ? 'Watch my game against the Computer on Pastime Rivals!'
      : v.you === 'opponent' ? `I played your Pastime Rivals challenge. Watch the game!` : `Watch our Pastime Rivals game!`;
    await this.shareOut(text, this.shareLink(), score);
  }

  /** True when the link was shared or copied. */
  private async shareOut(text: string, url: string, _score?: string): Promise<boolean> {
    this.note.set(null);
    try {
      if (navigator.share) { await navigator.share({ title: 'Pastime Rivals', text, url }); return true; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.note.set('Link copied.');
      return true;
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') this.note.set(url);
      return false;
    }
  }

  protected async copy(text: string | null): Promise<boolean> {
    if (!text) return false;
    try { await navigator.clipboard.writeText(text); this.note.set('Copied.'); return true; } catch { this.note.set(text); return false; }
  }

  /** Plan 29: the friend started picking (intro screen). */
  protected acceptPick(quick: boolean) {
    const c = this.current();
    if (c) void capi.funnel(c, 'picking');
    if (quick) void this.quickPick(); else this.startPicking('accept');
  }

  // ---- Playing out the game ----
  private pitchToken = 0;
  protected readonly loadingArt = signal(false);

  protected async pitch() {
    const ab = this.nextAtBat();
    if (!ab || this.scene() || this.loadingArt()) return;
    if (voiceOn()) { voice.ensure(); voice.stop(); voice.bedStart(bedFor(this.newestYear())); this.windupSeen = new Set(); }   // plan 50: before any await
    this.pbpLine.set('');
    this.lastPlay.set(null);
    const token = ++this.pitchToken;
    const m = this.manifest();
    const art = sideArt(m, ab.batter.id, ab.batter.year);
    // Plan 40 A: the pitcher's windup before every pitch, loaded on its own so a failed pitcher sheet never drops the batter art.
    const wind = art ? windupArt(m, ab.pitcher.id, eraOf(ab.pitcher.year), ab.pitcher.throws) : null;
    let ok = false, windOk = false;
    if (art) {
      this.loadingArt.set(true);
      const limit = new Promise<void>(res => setTimeout(res, 3000));
      const a = preloadImages([art.sheet]).then(r => { ok = r; });
      const w = wind ? preloadImages([wind.sheet]).then(r => { windOk = r; }) : Promise.resolve();
      await Promise.race([Promise.all([a, w]), limit]);
      this.loadingArt.set(false);
    }
    // Skip, Watch again or leaving during the wait cancels this pitch.
    if (token !== this.pitchToken || this.step() !== 'play' || this.nextAtBat() !== ab) return;
    this.pbpLine.set(''); this.pbpResultShown = false; this.pbpTypeWord = false;
    this.scene.set({ ab, art: ok ? art : null, windup: ok && windOk ? wind : null });
  }

  protected callOf(ab: CAtBat) {
    const d = this.deco().deco;
    return callFor(ab.outcome, ab.seed, countFor(ab.outcome, ab.seed, d), ab.batter.name, ab.batter.bats, ab.pitcher.throws, d, ab.batter.year,
      d === '3' ? playFacts(ab, this.names()) : null);
  }

  // ---- Plan 42: play-by-play (inning and friend games) ----
  protected readonly announcer = announcerOn;
  protected readonly pbpLine = signal('');
  private pbpResultShown = false;
  private pbpTypeWord = false;

  private introCtxFor(i: number): IntroCtx | null {
    const g = this.game(), ab = g?.atBats[i];
    if (!g || !ab) return null;
    const prev = i > 0 ? g.atBats[i - 1] : null;
    const inn = this.isInningGame();
    const firstOfHalf = !prev || prev.inning !== ab.inning || prev.battingSide !== ab.battingSide;
    const before: [number, number] = [0, 0];
    g.atBats.slice(0, i).forEach(a => (before[a.battingSide] += a.points));
    return {
      key: ab.seed, index: i, batter: { id: ab.batter.id, name: ab.batter.name }, pitcher: { id: ab.pitcher.id, name: ab.pitcher.name },
      showPitcher: !prev || prev.pitcher.id !== ab.pitcher.id || (inn && firstOfHalf), pitchingSide: 1 - ab.battingSide,
      situation: inn ? { outs: ab.outsBefore ?? 0, bases: ab.basesBefore ?? [null, null, null], inning: ab.inning ?? 1, battingSide: ab.battingSide,
        firstOfHalf, deficit: before[1 - ab.battingSide] - before[ab.battingSide], lastScheduledInning: 1 } : null,
    };
  }

  /** Plan 50: intro lines of at-bat i (pitcher line when shown, batter line). */
  private introLinesFor(i: number): PbpLine[] {
    const ctx = this.introCtxFor(i);
    if (!ctx) return [];
    const prevCtx = i > 0 ? this.introCtxFor(i - 1) : null;
    const x = intro(ctx, prevCtx ? rawLead(prevCtx) : null);
    return [x.pitcher, x.batter].filter((l): l is PbpLine => !!l);
  }
  /** Intro lines for the next at-bat, shown in the next-batter panel before the Pitch tap. */
  protected readonly pbpIntro = computed(() => {
    const n = this.nextAtBat();
    if (!this.announcer() || !n) return [] as string[];
    return this.introLinesFor(n.index).map(lineText);
  });

  private pbpCtxFor(ab: CAtBat) {
    return { key: ab.seed, index: ab.index, count: countFor(ab.outcome, ab.seed, this.deco().deco), runnersOn: (ab.basesBefore ?? []).some(Boolean),
      throws: ab.pitcher.throws, era: eraOf(ab.pitcher.year), seed: ab.seed };
  }

  private pbpResultLineFor(ab: CAtBat, typeWord = this.pbpTypeWord): PbpLine {
    const ctx = this.pbpCtxFor(ab);
    const d = this.deco().deco;
    return resultLine({ key: ab.seed, index: ab.index, outcome: ab.outcome, count: ctx.count, call: this.callOf(ab),
      play: d === '3' ? playFacts(ab, this.names()) : null, era: ctx.era, seed: ab.seed, typeWord });
  }
  private pbpResultFor(ab: CAtBat): string { return lineText(this.pbpResultLineFor(ab)); }

  protected onCue(c: SceneCue) {
    const s = this.scene();
    if (!s || !this.announcer()) return;
    const ctx = this.pbpCtxFor(s.ab);
    const lines = pitchLines(ctx, c.index);
    if (c.final) this.pbpTypeWord = lines.typeWord;
    this.voiceCue(c, lines, s.ab);
    if (c.moment === 'windup') { if (lines.delivery) this.pbpLine.set(lineText(lines.delivery)); return; }
    if (c.moment === 'plate' && !c.final && lines.call) { this.pbpLine.set(lineText(lines.call)); return; }
    if ((c.moment === 'plate' && c.final) || ((c.moment === 'skipped' || c.moment === 'end') && !this.pbpResultShown)) {
      this.pbpResultShown = true;
      this.pbpLine.set(this.pbpResultFor(s.ab));
      if (voiceOn()) { if (c.moment === 'skipped') voice.stop(); void voice.say(this.pbpResultLineFor(s.ab), 'result', this.gameVoice()); }
    }
  }

  // ---- Plan 50: announcer voice (games) ----
  private windupSeen = new Set<number>();
  private spokenIntro = -1;
  private spokenRecap = -1;
  /** Newest season among both lineups picks the voice and the crowd, fixed for the game. */
  private readonly newestYear = computed(() => Math.max(1901, ...(this.game()?.atBats ?? []).flatMap(a => [a.batter.year, a.pitcher.year])));
  private gameVoice() { return voiceFor(this.newestYear()); }
  /** Every clip an at-bat may speak (calls with aliases, final delivery, result, recap). */
  private atBatLines(ab: CAtBat): (PbpLine | null)[] {
    try {
      const ctx = this.pbpCtxFor(ab), v = this.gameVoice(), n = ctx.count.leadUp.length;
      const out: (PbpLine | null)[] = [this.pbpResultLineFor(ab, pitchLines(ctx, n).typeWord), ...this.recapLinesFor(ab)];
      for (let i = 0; i <= n; i++) {
        const pl = pitchLines(ctx, i);
        const k = pl.audio ? voice.callKey(pl.audio, v) : null;
        if (k) out.push({ segs: [{ p: k }], mood: 'calm' });
      }
      return out;
    } catch { return []; }
  }
  private walkOff(ab: CAtBat) {
    const g = this.game();
    if (!g || !this.isInningGame() || ab.index !== g.atBats.length - 1 || ab.battingSide !== 0) return false;
    const t = [0, 0]; g.atBats.forEach(a => (t[a.battingSide] += a.points));
    return ab.points > 0 && t[0] > t[1];
  }
  private voiceCue(c: SceneCue, lines: ReturnType<typeof pitchLines>, ab: CAtBat) {
    if (!voiceOn()) return;
    const v = this.gameVoice();
    if (c.moment === 'windup') { this.windupSeen.add(c.index); return; }   // plan 50B: final delivery is text only
    if (c.moment === 'plate' && !c.final) { if (this.windupSeen.has(c.index)) void voice.sayCall(lines.audio, v); return; }
    if (c.moment === 'plate' && c.final) voice.react(reactionFor(ab.outcome, { error: ab.outType === 'error', walkOff: this.walkOff(ab) }), ab.seed, 0.3);
  }

  private recapAb(a: CAtBat): RecapAb {
    return { outcome: a.outcome, battingSide: a.battingSide, inning: a.inning ?? 1, outsBefore: a.outsBefore ?? 0, outsAfter: a.outsAfter ?? 0,
      basesBefore: a.basesBefore ?? [null, null, null], basesAfter: a.basesAfter ?? [null, null, null], scored: a.scored ?? [], runnersOut: a.runnersOut ?? [],
      doublePlay: !!a.doublePlay, batterId: a.batter.id };
  }

  /** After-play recap for the play just shown (inning games); replaces the written base line while the announcer is on. */
  protected recapFor(lp: CAtBat | null): string[] { return this.recapLinesFor(lp).map(lineText); }
  private recapLinesFor(lp: CAtBat | null): PbpLine[] {
    const g = this.game();
    if (!this.announcer() || !lp || !g || !this.isInningGame()) return [];
    const after: [number, number] = [0, 0];
    g.atBats.slice(0, lp.index + 1).forEach(a => (after[a.battingSide] += a.points));
    const before: [number, number] = [...after] as [number, number];
    before[lp.battingSide] -= lp.points;
    const next = g.atBats[lp.index + 1] ?? null;
    const halfPlays = g.atBats.filter(a => a.inning === lp.inning && a.battingSide === lp.battingSide && a.index <= lp.index).map(a => this.recapAb(a));
    return recapLines({
      key: lp.seed, index: lp.index, ab: this.recapAb(lp), outAt: from => outAt(lp, from), scoreBefore: before, scoreAfter: after,
      lastOfGame: !next, halfEnds: !next || next.inning !== lp.inning || next.battingSide !== lp.battingSide,
      capped: (g.notes ?? []).includes(CAP_NOTE), nextIsNewHalf: !!next && (next.inning !== lp.inning || next.battingSide !== lp.battingSide),
      halfPlays, throws: lp.pitcher.throws, lastScheduledInning: 1,
    });
  }
  protected readonly pbpRecap = computed(() => this.recapFor(this.lastPlay()));
  /** The last play's recap on the final screen (walk-off, "And that's the ball game."). */
  private readonly pbpFinalLines = computed(() => {
    const g = this.game();
    return g && this.step() === 'final' && this.revealed() >= g.atBats.length ? this.recapLinesFor(g.atBats[g.atBats.length - 1] ?? null) : [];
  });
  protected readonly pbpFinal = computed(() => this.pbpFinalLines().map(lineText));

  protected sceneDone() {
    const s = this.scene();
    if (!s) return;
    if (this.announcer() && !this.pbpResultShown) { this.pbpResultShown = true; this.pbpLine.set(this.pbpResultFor(s.ab)); }
    this.scene.set(null);
    const inn = this.view()?.mode === 'inning';
    this.lastCall.set(`${this.callOf(s.ab).text}${!inn && s.ab.points ? ` +${s.ab.points}` : ''}`);
    if (inn) this.lastPlay.set(s.ab);
    if (voiceOn() && inn) { this.spokenRecap = s.ab.index; for (const l of this.recapLinesFor(s.ab)) void voice.say(l, 'recap', this.gameVoice()); }
    this.advance(this.revealed() + 1);
  }

  // ---- Plan 38: inning play screen ----
  protected readonly names = computed(() => namesOf(this.game()));
  /** The play just shown (its after-state is on screen until the next Pitch). */
  protected readonly lastPlay = signal<CAtBat | null>(null);
  protected readonly isInningGame = computed(() => this.view()?.mode === 'inning');
  /** Bases and outs on screen: after the last play, else before the next one. */
  protected readonly diamond = computed(() => {
    const lp = this.lastPlay(), n = this.nextAtBat();
    if (lp) return { bases: (lp.outsAfter ?? 0) >= 3 ? [null, null, null] : lp.basesAfter ?? [null, null, null], outs: lp.outsAfter ?? 0 };
    if (n) return { bases: n.basesBefore ?? [null, null, null], outs: n.outsBefore ?? 0 };
    return { bases: [null, null, null], outs: 0 };
  });
  protected readonly baseText = computed(() => {
    const lp = this.lastPlay(), g = this.game();
    return lp && g ? baseLine(lp, this.names(), lp.index === g.atBats.length - 1) : null;
  });
  protected readonly halfCard = computed(() => {
    const lp = this.lastPlay(), g = this.game();
    if (!lp || !g) return null;
    const capped = (g.notes ?? []).includes(CAP_NOTE);
    return halfChange(lp, this.nextAtBat(), this.score(), s => this.sideName(s).replace(' (you)', ''), capped);
  });
  /** "Top 1 · Batter 4": the half of the next plate appearance (or the last one shown) and its number in that half. */
  protected readonly inningProgress = computed(() => {
    const g = this.game(), a = this.nextAtBat() ?? this.lastPlay();
    if (!g || !a) return '';
    const n = g.atBats.filter(x => x.inning === a.inning && x.battingSide === a.battingSide && x.index <= a.index).length;
    return `${halfLabel(a.inning ?? 1, a.battingSide)} · Batter ${n}`;
  });
  protected readonly halvesList = computed(() => { const g = this.game(); return g ? halves(g) : []; });
  protected readonly lineInnings = computed(() => {
    const g = this.game();
    return Array.from({ length: Math.max(g?.lineScore?.[0]?.length ?? 0, g?.lineScore?.[1]?.length ?? 0) }, (_, i) => i + 1);
  });
  protected shortLabel(a: CAtBat) {
    if (a.outType === 'error') return 'Reached on error';
    if (a.doublePlay) return 'Double play';
    if (playFacts(a, this.names()).sacFly) return 'Sacrifice fly';
    return label(a.outcome);
  }

  private advance(n: number) {
    const total = this.game()?.atBats.length ?? 0;
    this.revealed.set(Math.min(n, total));
    if (this.current()) setWatched(this.current()!, this.revealed());
    if (this.revealed() >= total) this.step.set('final');
  }

  protected skipToFinal() { voice.stop(); this.pitchToken++; this.scene.set(null); this.pbpLine.set(''); this.lastPlay.set(null); this.advance(this.game()?.atBats.length ?? 0); }

  protected watchAgain() { voice.stop(); this.spokenIntro = -1; this.spokenRecap = -1; this.pitchToken++; this.scene.set(null); this.pbpLine.set(''); this.revealed.set(0); this.lastCall.set(null); this.lastPlay.set(null); if (this.current()) setWatched(this.current()!, 0); this.step.set('play'); }

  protected eraOf = eraOf;

  protected artFor(s: { ab: CAtBat; art: SideArt | null }) { return s.art; }
  /** Plan 44: fielders wear the pitcher's era uniform; the park follows the batter's look. */
  protected fieldersFor(ab: CAtBat) { return fielderArt(this.manifest(), eraOf(ab.pitcher.year)); }
  protected readonly lookOf = lookOf;
  protected playOf(ab: CAtBat) { return this.deco().deco === '3' ? playFacts(ab, this.names()) : null; }

  /** "2 of 6" during the regular at-bats; "Extra round 1" after, so the counter never hints at a tie. */
  protected readonly progress = computed(() => {
    const n = this.nextAtBat();
    if (n && n.round > 0) return `Extra round ${n.round}`;
    return `${Math.min(this.revealed(), 6)} of 6`;
  });

  protected roundLabel(ab: CAtBat) { return ab.round > 0 ? `Extra round ${ab.round}` : `At-bat ${ab.index + 1}`; }

  protected newChallenge() { this.startFresh('friend'); }

  protected openMine(code: string) {
    pushEntry('challenge', `/c/${code}`);
    this.open(code);
  }

  protected leave() { this.exit.emit(); }

  protected hoursLeft(v: CView) {
    const h = Math.max(0, Math.round((new Date(v.expiresUtc).getTime() - Date.now()) / 3600000));
    return h <= 1 ? 'less than an hour' : `${h} hours`;
  }
}
