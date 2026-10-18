import { Component, computed, effect, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { api, PlayerHit, SeasonItem } from './api';
import { ArtManifest, eraOf, PairArt, pairArt, preloadImages } from './art';
import { callFor, countFor, label } from './logic';
import { PitchScene } from './pitch-scene';
import {
  CAtBat, capi, ChallengeError, CClash, CMine, CPlayer, CSlot, CView, keyFor, links, saveKey, setWatched, takeKeyFromHash, toBody, watched,
} from './challenge-api';

type Step = 'loading' | 'home' | 'intro' | 'pick' | 'review' | 'shared' | 'waiting' | 'play' | 'final' | 'closed';
type Mode = 'create' | 'accept' | 'rematch' | 'cpu';

export const SLOT_NAMES = ['Your pitcher', 'Batter 1', 'Batter 2', 'Batter 3'];

/** Plan 24: challenge a friend. One screen at a time (plan 23); the page never scrolls. */
@Component({
  selector: 'pr-challenge',
  imports: [PitchScene],
  templateUrl: './challenge.html',
  styleUrls: ['./app.css', './challenge.css'],
})
export class ChallengeFlow {
  /** Challenge code from the URL, or null to start a new challenge. */
  readonly code = input<string | null>(null);
  readonly manifest = input<ArtManifest | null>(null);
  readonly exit = output<void>();

  protected readonly slotNames = SLOT_NAMES;
  protected readonly label = label;
  protected readonly step = signal<Step>('loading');
  protected readonly mode = signal<Mode>('create');
  protected readonly current = signal<string | null>(null);
  protected readonly view = signal<CView | null>(null);
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
  protected readonly teamDone = computed(() => this.slots().every(s => !!s));
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
  protected readonly scene = signal<{ ab: CAtBat; art: PairArt | null } | null>(null);
  protected readonly lastCall = signal<string | null>(null);

  protected readonly game = computed(() => this.view()?.game ?? null);
  protected readonly nextAtBat = computed(() => this.game()?.atBats[this.revealed()] ?? null);
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
  protected readonly finalText = computed(() => {
    const g = this.game(), you = this.yourSide();
    if (!g) return '';
    if (g.winner === -1) return 'A draw after 5 extra rounds';
    if (you === null) return `${this.sideName(g.winner)} wins`;
    return g.winner === you ? 'You win!' : 'You lose';
  });

  constructor() {
    effect(() => { this.step(); this.slotIndex(); this.editRank(); setTimeout(() => this.title()?.nativeElement.focus({ preventScroll: true }), 0); });
    queueMicrotask(() => this.start());
  }

  private async start() {
    capi.me().then(m => { this.nickname.set(m.nickname); this.nickChoices.set(m.choices); }).catch(() => undefined);
    const c = this.code();
    if (c) await this.open(c);
    else await this.home();
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
        this.lastCall.set(null);
        this.step.set(this.revealed() >= (v.game?.atBats.length ?? 0) ? 'final' : 'play');
      } else if (v.you === 'creator') {
        this.step.set(v.status === 'expired' ? 'closed' : 'waiting');
        if (v.status === 'expired') this.closedText.set('Nobody took this challenge in time.');
      } else if (v.canClaim) {
        this.mode.set('accept'); this.resetTeam(); this.step.set('intro');
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
    this.slots.set([null, null, null, null]); this.slotIndex.set(0); this.editRank.set(0); this.openSearch();
  }

  protected startPicking(mode: Mode) {
    if (mode !== 'accept') this.mode.set(mode);
    this.resetTeam(); this.step.set('pick');
  }

  protected async quickPick() {
    this.busy.set(true); this.error.set(null);
    try {
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
    const pick: CPlayer = { id: h.id, year: s.year, name: h.name, bats: h.bats, throws: h.throws };
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
  }

  protected nextSlot() {
    // After a clash, go straight to the next slot that still needs a new player, then back to review.
    const open = this.clashOpen();
    if (this.clash()) { if (open.length) this.goSlot(open[0]); else this.step.set('review'); return; }
    const i = this.slotIndex();
    if (i < 3) this.goSlot(i + 1);
    else this.step.set('review');
  }

  protected prevSlot() {
    const i = this.slotIndex();
    if (this.searching() && this.slots()[i]) { this.openSearch(false); return; }
    if (i > 0) this.goSlot(i - 1);
    else this.backFromPicking();
  }

  protected backFromPicking() {
    if (this.mode() === 'accept') this.step.set('intro');
    else if (this.mode() === 'rematch') this.step.set('final');
    else this.step.set('home');   // create and cpu both start from the games screen
  }

  protected chooseName(n: string) { this.nickname.set(n); }

  protected async lockTeam() {
    const slots = this.slots();
    if (!slots.every(Boolean)) return;
    const body = toBody(slots as CSlot[], this.nickname() ?? this.nickChoices()[0]);
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
        this.revealed.set(0); setWatched(code, 0); this.lastCall.set(null);
        this.step.set('play');
      } else {
        const r = this.mode() === 'rematch' ? await capi.rematch(this.current()!, body) : await capi.create(body);
        saveKey(r.code, r.key);
        const l = links(location.origin, r.code, r.key);
        this.shareLink.set(l.share); this.privateLink.set(l.private);
        this.current.set(r.code);
        try { history.pushState({ pr: 'challenge' }, '', `/c/${r.code}`); } catch { /* fine */ }
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
  private async playComputer(body: ReturnType<typeof toBody>) {
    const r = await capi.computer(body);
    saveKey(r.code, r.key);
    this.current.set(r.code);
    this.view.set(r.view);
    this.shareLink.set(links(location.origin, r.code, null).share);
    this.privateLink.set(null);
    this.revealed.set(0); setWatched(r.code, 0); this.lastCall.set(null);
    try { history.pushState({ pr: 'challenge' }, '', `/c/${r.code}`); } catch { /* fine */ }
    this.mode.set('cpu');
    this.step.set('play');
    let session = 'no-storage';
    try { session = sessionStorage.getItem('pr-session') ?? session; } catch { /* fine */ }
    api.event('cpu_game', session);
  }

  /** Same team against a new computer team. */
  protected async sameTeamAgain() {
    const picks = this.view()?.yourPicks;
    if (!picks) return;
    this.busy.set(true); this.error.set(null);
    try { await this.playComputer(toBody(picks, this.nickname() ?? undefined)); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  // ---- Sharing ----
  protected async shareChallenge() {
    const url = this.shareLink();
    const text = 'I picked my team on Pastime Rivals. Think you can beat it?';
    await this.shareOut(text, url);
  }

  protected async shareResult() {
    const g = this.game(), v = this.view();
    if (!g || !v) return;
    const score = `${v.creatorName} ${g.totals[0]}, ${v.opponentName ?? 'Friend'} ${g.totals[1]}`;
    const text = v.vsCpu ? 'Watch my game against the Computer on Pastime Rivals!'
      : v.you === 'opponent' ? `I played your Pastime Rivals challenge. Watch the game!` : `Watch our Pastime Rivals game!`;
    await this.shareOut(text, this.shareLink(), score);
  }

  private async shareOut(text: string, url: string, _score?: string) {
    this.note.set(null);
    try {
      if (navigator.share) { await navigator.share({ title: 'Pastime Rivals', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      this.note.set('Link copied.');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') this.note.set(url);
    }
  }

  protected async copy(text: string | null) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); this.note.set('Copied.'); } catch { this.note.set(text); }
  }

  // ---- Playing out the game ----
  private pitchToken = 0;
  protected readonly loadingArt = signal(false);

  protected async pitch() {
    const ab = this.nextAtBat();
    if (!ab || this.scene() || this.loadingArt()) return;
    const token = ++this.pitchToken;
    const m = this.manifest();
    const art = pairArt(m, { id: ab.pitcher.id, era: eraOf(ab.pitcher.year), hand: ab.pitcher.throws },
      { id: ab.batter.id, era: eraOf(ab.batter.year), hand: ab.batter.bats === 'L' ? 'L' : 'R' });
    let ok = false;
    if (art) {
      this.loadingArt.set(true);
      ok = await Promise.race([preloadImages([art.pit.sheet, art.bat.sheet]), new Promise<boolean>(res => setTimeout(() => res(false), 3000))]);
      this.loadingArt.set(false);
    }
    // Skip, Watch again or leaving during the wait cancels this pitch.
    if (token !== this.pitchToken || this.step() !== 'play' || this.nextAtBat() !== ab) return;
    this.scene.set({ ab, art: ok ? art : null });
  }

  protected callOf(ab: CAtBat) {
    return callFor(ab.outcome, ab.seed, countFor(ab.outcome, ab.seed), ab.batter.name, ab.batter.bats, ab.pitcher.throws);
  }

  protected sceneDone() {
    const s = this.scene();
    if (!s) return;
    this.scene.set(null);
    this.lastCall.set(`${this.callOf(s.ab).text}${s.ab.points ? ` +${s.ab.points}` : ''}`);
    this.advance(this.revealed() + 1);
  }

  private advance(n: number) {
    const total = this.game()?.atBats.length ?? 0;
    this.revealed.set(Math.min(n, total));
    if (this.current()) setWatched(this.current()!, this.revealed());
    if (this.revealed() >= total) this.step.set('final');
  }

  protected skipToFinal() { this.pitchToken++; this.scene.set(null); this.advance(this.game()?.atBats.length ?? 0); }

  protected watchAgain() { this.pitchToken++; this.scene.set(null); this.revealed.set(0); this.lastCall.set(null); if (this.current()) setWatched(this.current()!, 0); this.step.set('play'); }

  protected eraOf = eraOf;

  protected artFor(s: { ab: CAtBat; art: PairArt | null }) { return s.art; }

  /** "2 of 6" during the regular at-bats; "Extra round 1" after, so the counter never hints at a tie. */
  protected readonly progress = computed(() => {
    const n = this.nextAtBat();
    if (n && n.round > 0) return `Extra round ${n.round}`;
    return `${Math.min(this.revealed(), 6)} of 6`;
  });

  protected roundLabel(ab: CAtBat) { return ab.round > 0 ? `Extra round ${ab.round}` : `At-bat ${ab.index + 1}`; }

  protected newChallenge() {
    try { history.pushState({ pr: 'challenge' }, '', '/c/new'); } catch { /* fine */ }
    this.home();
  }

  protected openMine(code: string) {
    try { history.pushState({ pr: 'challenge' }, '', `/c/${code}`); } catch { /* fine */ }
    this.open(code);
  }

  protected leave() { this.exit.emit(); }

  protected hoursLeft(v: CView) {
    const h = Math.max(0, Math.round((new Date(v.expiresUtc).getTime() - Date.now()) / 3600000));
    return h <= 1 ? 'less than an hour' : `${h} hours`;
  }
}
