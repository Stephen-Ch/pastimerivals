// Plan 42: play-by-play announcer track. Pure functions, no Angular.
// Every line is a list of segments: a phrase key from the catalog, a player's name (only last, in intro lines), or a pause.
// Plan 43 voices it from recorded clips: one clip per phrase key and voice, one per name.
import { AtBatCount, Call, CountPitch, OutcomeKey, PlayFacts } from './logic';
import { Era } from './art';
import { PitchType, pitchRand, pitchTypeFor } from './pitch-scene';

export type Mood = 'calm' | 'rising' | 'excited';
export type Seg = { p: string } | { name: string; id: string } | { pause: number };
export interface PbpLine { segs: Seg[]; mood: Mood; }

// ---------------- Catalog ----------------
export interface Phrase { t: string; m: Mood; }
export const PHRASES: Record<string, Phrase> = {};
const def = (k: string, t: string, m: Mood = 'calm') => { PHRASES[k] = { t, m }; return k; };

const W = ['nothing', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const CW = ['oh', 'one', 'two', 'three'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export type Role = 'R' | 'L' | 'P';
const ROLE: Record<Role, string> = { R: 'the right-hander', L: 'the lefty', P: 'the pitcher' };
const ROLES: Role[] = ['R', 'L', 'P'];
export const roleOf = (throws: string | null | undefined): Role => (throws ?? '').toUpperCase() === 'L' ? 'L' : (throws ?? '').toUpperCase() === 'R' ? 'R' : 'P';

// Lead-ins (each followed by a pause, then the name, which ends the sentence).
const LEAD = {
  pitcherPractice: [def('lead.p.mound', 'On the mound...'), def('lead.p.hill', 'Taking the hill...')],
  pitcherHome: [def('lead.p.home', 'On the hill for the home team...'), def('lead.p.mound2', 'On the mound...')],
  pitcherVis: [def('lead.p.vis', 'Pitching for the visitors...'), def('lead.p.hill2', 'Taking the hill...')],
  leadoff: [def('lead.b.leadoff', 'Leading off...'), def('lead.b.leadoff2', 'To lead it off...')],
  plain: [def('lead.b.now', 'Now batting...'), def('lead.b.step', 'Stepping in...'), def('lead.b.next', 'Up next...'), def('lead.b.coming', 'Coming to the plate...')],
  loaded: [def('lead.b.loaded', "Bases loaded, here's...", 'rising')],
  winning: [def('lead.b.winning', 'Winning run at the plate...', 'rising')],
  tying: [def('lead.b.tying', 'Tying run at the plate...', 'rising')],
  ahead: [def('lead.b.ahead', 'Go-ahead run at the plate...', 'rising')],
  oneOn: [def('lead.b.aboard', 'With a man aboard, up comes...')],
  twoOn: [def('lead.b.twoaboard', "With two aboard, here's...")],
  oneOut: [def('lead.b.oneout', "With one out, here's...")],
  twoOut: [def('lead.b.twodown', "With two down, here's...")],
};

// Counts: "two and one." (after a comma) / "full count."
for (let b = 0; b <= 3; b++) for (let s = 0; s <= 2; s++) def(`count.${b}.${s}`, b === 3 && s === 2 ? 'full count.' : `${CW[b]} and ${CW[s]}.`);

// Lead-up pitch calls. Numbered forms when the count is not said; short forms (ending in a comma) before a count.
for (let n = 1; n <= 3; n++) {
  def(`ball.${n}`, `Ball ${W[n]}.`); def(`ball.out.${n}`, `Outside, ball ${W[n]}.`); def(`ball.low.${n}`, `Low, ball ${W[n]}.`); def(`ball.high.${n}`, `Misses high, ball ${W[n]}.`);
}
for (let n = 1; n <= 2; n++) {
  def(`called.${n}`, `Called strike ${W[n]}.`); def(`strike.${n}`, `Strike ${W[n]}.`); def(`corner.${n}`, `On the corner, strike ${W[n]}.`);
  def(`swing.${n}`, `Swing and a miss, strike ${W[n]}.`); def(`swungthrough.${n}`, `Swung through it, strike ${W[n]}.`);
  def(`foul.${n}`, `Fouled back, strike ${W[n]}.`); def(`foulst.${n}`, `Foul, strike ${W[n]}.`);
}
const SHORT = {
  ball: [def('s.ball', 'Ball,'), def('s.outside', 'Outside,'), def('s.low', 'Low,'), def('s.high', 'Misses high,')],
  called: [def('s.called', 'Called strike,'), def('s.corner', 'Strike on the corner,')],
  swinging: [def('s.swing', 'Swing and a miss,'), def('s.through', 'Swung through it,')],
  foul: [def('s.foul', 'Fouled back,'), def('s.fouloff', 'Fouled off,')],
};
const STILL_TWO = [def('foul.still', 'Fouled off, still two strikes.'), def('foul.stays', 'Fouled back, still two strikes.')];
const TYPE: Record<PitchType, string> = { fast: def('type.fast', 'Fastball,'), curve: def('type.curve', 'Curve,'), change: def('type.change', 'Change-up,'), slider: def('type.breaking', 'Breaking ball,') };

// Pitcher delivery lines (role words only; never "he").
const DELIV: Record<string, string[]> = {};
for (const r of ROLES) {
  const R = cap(ROLE[r]);
  DELIV[`windup.${r}`] = [def(`d.windup.${r}`, `${R} winds and delivers.`), def(`d.rocks.${r}`, `${R} rocks and fires.`), def('d.andpitch', 'And the pitch.')];
  DELIV[`stretch.${r}`] = [def(`d.set.${r}`, `${R} comes set.`), def('d.setpitch', 'Set... and the pitch.'), def('d.look', 'A look, here it comes.'), def('d.checks', 'Checks the runner.')];
}
const DELIV_TWO = [def('d.twostrikes', 'Two strikes, here it comes.')];
const DELIV_PAYOFF = [def('d.payoff', 'The payoff pitch.'), def('d.payoff2', 'Payoff pitch, on the way.')];
const DELIV_OHTWO = def('d.ohtwo', 'Oh-and-two pitch.');

// Results.
const FIELDW: Record<string, string> = { left: 'left', 'left-center': 'left-center', center: 'center', 'right-center': 'right-center', right: 'right' };
const SPOTS = Object.keys(FIELDW);
const POSW: Record<string, string> = { P: 'the pitcher', C: 'the catcher', '1B': 'first', '2B': 'second', SS: 'short', '3B': 'third', LF: 'left', CF: 'center', RF: 'right' };
const POSFULL: Record<string, string> = { P: 'pitcher', C: 'catcher', '1B': 'first baseman', '2B': 'second baseman', SS: 'shortstop', '3B': 'third baseman', LF: 'left fielder', CF: 'center fielder', RF: 'right fielder' };
const R_ = {
  kCalled: [def('k.called', "Strike three called! He's out looking.", 'excited'), def('k.caught', 'Caught looking!', 'excited'), def('k.rings', 'Rings him up.', 'rising')],
  kSwing: [def('k.swing', 'Swing and a miss, strike three!', 'excited'), def('k.gotswing', 'Got him swinging!', 'excited'), def('k.struck', 'Struck him out!', 'excited')],
  kTip: [def('k.tip', 'Foul tip, strike three!', 'excited')],
  bb: [def('bb.on', "Ball four, he's on."), def('bb.take', "Ball four, he'll take first."), def('bb.walk', "That's a walk.")],
  bb4: [def('bb.four', 'Four straight balls, and he walks.')],
  hbp: [def('hbp.base', 'Hit by the pitch, he takes his base.'), def('hbp.arm', "Got him on the arm, he's on."), def('hbp.plunk', 'Plunked him.')],
};
for (const s of SPOTS) {
  const f = FIELDW[s];
  def(`hr.long.${s}`, `Long drive to ${f}... that ball is gone!`, 'excited');
  def(`hr.way.${s}`, `Way back in ${f}... and out of here!`, 'excited');
  def(`hr.high.${s}`, `Hit high and deep to ${f}... home run!`, 'excited');
}
def('hr.itp', "Around third, he's coming home... safe! Inside the park!", 'excited');
for (const f of ['left', 'center', 'right']) {
  def(`1b.ground.${f}`, f === 'center' ? 'Ground ball, up the middle, base hit.' : `Ground ball, through the ${f} side, base hit.`);
  def(`1b.line.${f}`, `Line drive into ${f}, base hit.`);
  def(`1b.bloop.${f}`, `Blooper, drops in ${f}, base hit.`);
}
for (const s of SPOTS) {
  const f = FIELDW[s];
  if (s === 'left' || s === 'right') {
    def(`2b.line.${s}`, `Down the ${f}-field line, he'll go into second.`, 'rising');
    def(`2b.corner.${s}`, `Into the ${f}-field corner, he's in with a double.`, 'rising');
    def(`3b.corner.${s}`, `Into the ${f}-field corner... he's going for three... safe!`, 'excited');
  } else if (s === 'center') {
    def('2b.over.center', "Over the center fielder's head, a double.", 'rising');
    def('3b.over.center', "Over the center fielder's head... he's in with a triple!", 'excited');
  } else {
    def(`2b.gap.${s}`, `Lined into the ${f} gap... he's in with a double.`, 'rising');
    def(`3b.gap.${s}`, `Into the ${f} gap, rolls to the wall, a triple!`, 'excited');
  }
}
for (const p of Object.keys(POSW)) {
  def(`go.${p}`, p === 'P' ? 'Comebacker to the mound... over to first, he\'s out.' : p === 'C' ? 'Topped in front, the catcher throws him out.' : `Grounder to ${POSW[p]}... over to first, and he's out.`);
  def(`go2.${p}`, p === 'P' || p === 'C' ? `Tapped to ${POSW[p]}, an easy out.` : `Two-hopper to ${POSW[p]}, throw to first, out.`);
  def(`line.${p}`, `Lined right at the ${POSFULL[p]}.`);
  def(`line2.${p}`, `Line drive... snared by the ${POSFULL[p]}!`, 'rising');
  def(`pop.${p}`, p === 'C' ? 'Pop-up behind the plate... caught.' : `Popped up, the ${POSFULL[p]} has it.`);
  def(`foulout.${p}`, `Foul pop, the ${POSFULL[p]} makes the catch.`);
  def(`err.${p}`, `Grounder to ${POSW[p]}... booted! He's safe.`, 'rising');
  def(`err2.${p}`, `Throw is wild from ${POSW[p]}, he's safe at first.`, 'rising');
  def(`dp.${p}`, `Grounder to ${POSW[p]}... to second, to first... double play!`, 'excited');
  def(`force.${p}`, `Grounder to ${POSW[p]}, they get the force at second.`);
  def(`linedp.${p}`, `Lined to the ${POSFULL[p]}... the runner is doubled off!`, 'excited');
}
for (const f of ['LF', 'CF', 'RF']) {
  def(`fly.${f}`, `Fly ball to ${POSW[f]}... can of corn.`); def(`fly2.${f}`, `Lazy fly to ${POSW[f]}, caught.`);
  def(`flydeep.${f}`, `Deep to ${POSW[f]}... caught at the track.`, 'rising');
  def(`sac.${f}`, `Fly to ${POSW[f]}, deep enough... the runner tags... scores!`, 'rising');
  def(`sacline.${f}`, `Lined to ${POSW[f]}, the runner tags... and scores!`, 'rising');
}
const DP_SHORT = def('dp.643', 'Six-four-three, two down.', 'excited');

// Recaps (inning games).
const RUNS = [null, def('runs.1', 'A run scores.', 'rising'), def('runs.2', 'Two runs score.', 'rising'), def('runs.3', 'Three runs score.', 'excited'), def('runs.4', 'Four runs score.', 'excited')];
const TIES = def('rc.ties', 'That ties it!', 'excited');
const AHEAD = def('rc.ahead', 'That puts them ahead!', 'excited');
const RC_DP = def('rc.dp', 'A double play!', 'rising');
const BASES_OUTS: Record<string, string> = {};
const BASEW = ['first', 'second', 'third'];
for (let mask = 0; mask < 8; mask++) for (let o = 0; o <= 2; o++) {
  const on = [0, 1, 2].filter(i => mask & (1 << i)).map(i => BASEW[i]);
  const b = on.length === 0 ? 'Nobody on' : on.length === 3 ? 'Bases loaded' : on.length === 1 ? `Man at ${on[0]}` : `Runners at ${on[0]} and ${on[1]}`;
  const outs = o === 0 ? 'nobody out' : o === 1 ? 'one out' : 'two down';
  BASES_OUTS[`${mask}.${o}`] = def(`bo.${mask}.${o}`, `${b}, ${outs}.`);
}
const OUT_AT: Record<string, string> = {};
for (const from of [0, 1, 2]) for (const at of ['second', 'third', 'home']) OUT_AT[`${from}.${at}`] = def(`ra.${from}.${at}`, `The runner from ${BASEW[from]} is out at ${at}.`, 'rising');
const SIDE = [def('rc.retires', 'That retires the side.'), def('rc.inning', "And that's the inning.")];
const ONETWOTHREE = def('rc.123', 'Three up, three down.');
const TO_BOTTOM = def('hc.tobottom', 'Heading to the bottom half,');
const AFTER_N: string[] = [];
for (let i = 1; i <= 15; i++) AFTER_N[i] = def(`hc.after.${i}`, `After ${W[i] ?? i},`);
const LEAD_BY: Record<string, string> = {};
for (const side of ['visitors', 'home']) for (let m = 1; m <= 20; m++) LEAD_BY[`${side}.${m}`] = def(`sc.${side}.${m}`, `${side === 'home' ? 'the home team' : 'the visitors'} lead by ${W[m]}.`);
for (let t = 0; t <= 20; t++) def(`sc.tied.${t}`, t === 0 ? 'no score.' : `all tied at ${W[t]}.`);
const NO_BAT = def('end.nobat', "The home team won't need to bat.");
const WALKOFF = [def('end.walkoff', 'The winning run scores! Home team wins!', 'excited'), def('end.walkoff2', 'Here comes the winning run... safe! Home team wins!', 'excited')];
const WALKOFF_HR = def('end.walkoffhr', "He's home! The home team wins!", 'excited');
const GAME_OVER = [def('end.ballgame', "And that's the ball game."), def('end.thatll', "That'll do it.")];
const WIN_SIDE = { 1: def('end.vis', 'The visitors win.'), 0: def('end.home', 'The home team wins.') } as Record<number, string>;
// Pitcher recap lines.
const P_K: Record<Role, string[]> = { R: [], L: [], P: [] };
const P_DEAL: Record<Role, string> = { R: '', L: '', P: '' };
const P_JAM: Record<Role, string[]> = { R: [], L: [], P: [] };
for (const r of ROLES) {
  P_K[r] = [def(`pk.another.${r}`, `Another one for ${ROLE[r]}.`), def(`pk.sets.${r}`, `${cap(ROLE[r])} sets him down.`)];
  P_DEAL[r] = def(`pk.dealing.${r}`, `${cap(ROLE[r])} is dealing.`, 'rising');
  P_JAM[r] = [def(`pj.brewing.${r}`, `Trouble brewing for ${ROLE[r]}.`, 'rising'), def('pj.needs', 'The pitcher needs an out.', 'rising'), def(`pj.jam.${r}`, `${cap(ROLE[r])} is in a jam.`, 'rising')];
}

// ---------------- Rendering ----------------
export function lineText(l: PbpLine): string {
  let out = '';
  for (const s of l.segs) {
    if ('pause' in s) continue;
    let t = 'p' in s ? PHRASES[s.p]?.t ?? s.p : s.name;
    if (out && /,$/.test(out) && 'p' in s && !/^[A-Z][a-z]*-/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
    out += (out ? ' ' : '') + t;
  }
  const last = l.segs[l.segs.length - 1];
  return last && 'name' in last ? out + '.' : out;
}

// ---------------- Seeded choice: one stream per line ----------------
function rnd(key: string): () => number {
  let h = 2166136261;
  for (const ch of `pbp:${key}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const P = (k: string): Seg => ({ p: k });
const line = (segs: Seg[], mood?: Mood): PbpLine => ({ segs, mood: mood ?? (segs.map(s => ('p' in s ? PHRASES[s.p]?.m : undefined)).find(m => m && m !== 'calm') ?? 'calm') });
const PAUSE_NAME = 350;

// ---------------- Intro ----------------
export interface Person { id: string; name: string; }
export interface Situation { outs: number; bases: (string | null)[]; inning: number; battingSide: number; firstOfHalf: boolean; deficit: number; lastScheduledInning: number; }
export interface IntroCtx { key: string; index: number; batter: Person; pitcher: Person; showPitcher: boolean; pitchingSide: number | null; situation: Situation | null; }
export interface Intro { pitcher: PbpLine | null; batter: PbpLine; lead: string; }

function batterGroup(sit: Situation | null): string[] {
  if (!sit) return LEAD.plain;
  const on = sit.bases.filter(Boolean).length;
  const bottom = sit.battingSide === 0;
  if (on === 3) return LEAD.loaded;
  if (bottom && sit.inning >= sit.lastScheduledInning && sit.deficit >= 0 && sit.deficit === on && on > 0) return LEAD.winning;
  if (sit.deficit > 0 && sit.deficit === on + 1) return LEAD.tying;
  if (sit.deficit >= 0 && sit.deficit === on && on > 0 && !(bottom && sit.inning >= sit.lastScheduledInning)) return LEAD.ahead;
  if (on === 1) return LEAD.oneOn;
  if (on === 2) return LEAD.twoOn;
  if (sit.outs === 1) return LEAD.oneOut;
  if (sit.outs === 2) return LEAD.twoOut;
  if (sit.firstOfHalf) return LEAD.leadoff;
  return LEAD.plain;
}

/** The lead-in an intro would use, ignoring the no-repeat rule (used for "the previous at-bat's lead-in"). */
export function rawLead(ctx: IntroCtx): string {
  return pick(rnd(`${ctx.key}:intro:${ctx.index}`), batterGroup(ctx.situation));
}

/** Intro lines, shown before the Pitch tap. prevLead = rawLead of the previous at-bat (never repeated when there is a choice). */
export function intro(ctx: IntroCtx, prevLead: string | null): Intro {
  const group = batterGroup(ctx.situation);
  let lead = rawLead(ctx);
  if (lead === prevLead && group.length > 1) lead = group[(group.indexOf(lead) + 1) % group.length];
  let pitcher: PbpLine | null = null;
  if (ctx.showPitcher) {
    const pg = ctx.pitchingSide === null ? LEAD.pitcherPractice : ctx.pitchingSide === 0 ? LEAD.pitcherHome : LEAD.pitcherVis;
    pitcher = line([P(pick(rnd(`${ctx.key}:pintro:${ctx.index}`), pg)), { pause: PAUSE_NAME }, { name: ctx.pitcher.name, id: ctx.pitcher.id }]);
  }
  return { pitcher, batter: line([P(lead), { pause: PAUSE_NAME }, { name: ctx.batter.name, id: ctx.batter.id }]), lead };
}

// ---------------- Pitches ----------------
export interface PitchCtx { key: string; index: number; count: AtBatCount; runnersOn: boolean; throws: string | null | undefined; era: Era; seed: string; }
export interface PitchLines { delivery: PbpLine | null; call: PbpLine | null; typeWord: boolean; }

/** Lines for pitch i (0-based; i === leadUp.length is the final pitch, whose call is the result line). */
export function pitchLines(ctx: PitchCtx, i: number): PitchLines {
  const r = rnd(`${ctx.key}:pitch:${ctx.index}:${i}`);
  const lead = ctx.count.leadUp;
  const before = i === 0 ? { balls: 0, strikes: 0 } : lead[i - 1];
  const role = roleOf(ctx.throws);
  const eligible = i === 0 || before.strikes === 2 || before.balls === 3 || ctx.runnersOn;
  const wantDelivery = eligible && r() < 0.6;
  const wantType = !wantDelivery && r() < 1 / 3;
  let delivery: PbpLine | null = null;
  if (wantDelivery) {
    let opts: string[];
    if (before.balls === 3 && before.strikes === 2) opts = DELIV_PAYOFF;
    else if (before.strikes === 2) opts = before.balls === 0 ? [DELIV_OHTWO, ...DELIV_TWO] : DELIV_TWO;
    else opts = DELIV[`${ctx.runnersOn ? 'stretch' : 'windup'}.${role}`];
    delivery = line([P(pick(r, opts))]);
  }
  if (i >= lead.length) return { delivery, call: null, typeWord: wantType };
  const p = lead[i];
  const segs: Seg[] = [];
  const sayCount = p.strikes === 2 || p.balls === 3;
  const stillTwo = p.kind === 'foul' && before.strikes === 2;
  // The pitch type only leads a numbered call ("Curve, called strike one."), never a short call before the count.
  if (wantType && !sayCount && !stillTwo) segs.push(P(TYPE[pitchTypeFor(pitchRand(ctx.seed, i)[0], ctx.era)]));
  if (stillTwo) segs.push(P(pick(r, STILL_TWO)));
  else if (sayCount) segs.push(P(pick(r, SHORT[p.kind])), P(`count.${p.balls}.${p.strikes}`));
  else segs.push(P(numbered(r, p)));
  const typed = segs.length > 1 && 'p' in segs[0] && segs[0].p.startsWith('type.');
  let call = line(segs);
  if (typed && wordCount(call) > 7) call = line(segs.slice(1));   // keep pitch lines at 7 words or fewer
  return { delivery, call, typeWord: wantType };
}

function numbered(r: () => number, p: CountPitch): string {
  switch (p.kind) {
    case 'ball': return pick(r, [`ball.${p.balls}`, `ball.out.${p.balls}`, `ball.low.${p.balls}`, `ball.high.${p.balls}`]);
    case 'called': return pick(r, [`called.${p.strikes}`, `strike.${p.strikes}`, `corner.${p.strikes}`]);
    case 'swinging': return pick(r, [`swing.${p.strikes}`, `swungthrough.${p.strikes}`]);
    case 'foul': return pick(r, [`foul.${p.strikes}`, `foulst.${p.strikes}`]);
  }
}

// ---------------- Result ----------------
export interface ResultCtx { key: string; index: number; outcome: OutcomeKey; count: AtBatCount; call: Call; play: PlayFacts | null; era: Era; seed: string; typeWord: boolean; }

/** Details the written call carries only in its text (read back from our own generated wording; no new random draws). */
export function callDetail(c: Call): { deep: boolean; where: 'line' | 'corner' | 'gap' | 'over' | null } {
  const t = c.text;
  const where = /down the [a-z]+-field line/.test(t) ? 'line' : /corner/.test(t) ? 'corner' : /gap/.test(t) ? 'gap' : /center fielder's head/.test(t) ? 'over' : null;
  return { deep: / deep /.test(` ${t} `) && c.type === 'fly', where };
}

const field3 = (s: string | undefined) => s === 'left' || s === 'left-center' ? 'left' : s === 'center' ? 'center' : 'right';
const ofOf = (s: string | undefined) => s === 'left' || s === 'left-center' ? 'LF' : s === 'center' ? 'CF' : 'RF';

export function resultLine(ctx: ResultCtx): PbpLine {
  const r = rnd(`${ctx.key}:result:${ctx.index}`);
  const c = ctx.call, f = c.fielder ?? 'SS', spot = c.spot ?? 'center';
  const d = callDetail(c);
  const pre: Seg[] = ctx.typeWord && ctx.outcome === 'k' ? [P(TYPE[pitchTypeFor(pitchRand(ctx.seed, ctx.count.leadUp.length)[0], ctx.era)])] : [];
  switch (ctx.outcome) {
    case 'k': return line([...pre, P(pick(r, ctx.count.finalKind === 'called' ? R_.kCalled : ctx.count.finalKind === 'tip' ? R_.kTip : R_.kSwing))]);
    case 'bb': return line([P(pick(r, ctx.count.leadUp.length === 3 && ctx.count.strikes === 0 ? [...R_.bb4, ...R_.bb] : R_.bb))]);
    case 'hbp': return line([P(pick(r, R_.hbp))]);
    case 'hr': return line([P(c.insideTheParkHr ? 'hr.itp' : pick(r, [`hr.long.${spot}`, `hr.way.${spot}`, `hr.high.${spot}`]))]);
    case 'triple': return line([P(spot === 'center' ? '3b.over.center' : spot === 'left' || spot === 'right' ? `3b.corner.${spot}` : `3b.gap.${spot}`)]);
    case 'double':
      if (spot === 'left' || spot === 'right') return line([P(d.where === 'corner' ? `2b.corner.${spot}` : `2b.line.${spot}`)]);
      return line([P(spot === 'center' ? '2b.over.center' : `2b.gap.${spot}`)]);
    case 'single': {
      const t = c.trajectory === 'line' ? 'line' : c.trajectory === 'bloop' ? 'bloop' : 'ground';
      return line([P(`1b.${t}.${field3(spot)}`)]);
    }
    case 'oip': {
      const pl = ctx.play;
      switch (c.type) {
        case 'error': return line([P(pick(r, [`err.${f}`, `err2.${f}`]))]);
        case 'ground':
          if (pl?.doublePlay) return line([P(f === 'SS' && r() < 0.4 ? DP_SHORT : `dp.${f}`)]);
          if (pl?.forceRunner) return line([P(`force.${f}`)]);
          return line([P(pick(r, [`go.${f}`, `go2.${f}`]))]);
        case 'line':
          if (pl?.doublePlay) return line([P(`linedp.${f}`)]);
          if (pl?.sacFly) return line([P(`sacline.${ofOf(c.spot)}`)]);
          return line([P(pick(r, [`line.${f}`, `line2.${f}`]))]);
        case 'fly':
          if (pl?.sacFly) return line([P(`sac.${f}`)]);
          return line([P(d.deep ? `flydeep.${f}` : pick(r, [`fly.${f}`, `fly2.${f}`]))]);
        case 'pop': return line([P(`pop.${f}`)]);
        case 'foul': return line([P(`foulout.${f}`)]);
      }
      return line([P(pick(r, [`go.${f}`, `go2.${f}`]))]);
    }
  }
}

// ---------------- Recap (inning games) ----------------
export interface RecapAb {
  outcome: OutcomeKey; battingSide: number; inning: number; outsBefore: number; outsAfter: number;
  basesBefore: (string | null)[]; basesAfter: (string | null)[]; scored: string[]; runnersOut: string[]; doublePlay: boolean; batterId: string;
}
export interface RecapCtx {
  key: string; index: number; ab: RecapAb; outAt: (from: number) => string;
  scoreBefore: [number, number]; scoreAfter: [number, number];
  lastOfGame: boolean; halfEnds: boolean; capped: boolean; nextIsNewHalf: boolean;
  halfPlays: RecapAb[];               // plays of this half up to and including this one
  throws: string | null | undefined;  // the pitcher's throwing hand
  lastScheduledInning: number;
}

export function recapLines(ctx: RecapCtx): PbpLine[] {
  const r = rnd(`${ctx.key}:recap:${ctx.index}`);
  const ab = ctx.ab, out: PbpLine[] = [];
  const bat = ab.battingSide, other = 1 - bat;
  const runs = ab.scored.length;
  const role = roleOf(ctx.throws);
  // Game over first: walk-off or the home team not needing to bat.
  if (ctx.lastOfGame) {
    const homeWins = ctx.scoreAfter[0] > ctx.scoreAfter[1];
    if (bat === 0 && homeWins && runs > 0) {
      out.push(line([P(ab.outcome === 'hr' ? WALKOFF_HR : pick(r, WALKOFF))]));
      return out;
    }
    if (runs > 0) out.push(line([P(RUNS[Math.min(4, runs)]!)]));
    if (bat === 1 && homeWins) out.push(line([P(NO_BAT)]));
    out.push(line([P(pick(r, GAME_OVER)), P(WIN_SIDE[homeWins ? 0 : 1])]));
    return out;
  }
  if (runs > 0) {
    out.push(line([P(RUNS[Math.min(4, runs)]!)]));
    const was = ctx.scoreBefore[bat] - ctx.scoreBefore[other], now = ctx.scoreAfter[bat] - ctx.scoreAfter[other];
    if (was < 0 && now === 0) out.push(line([P(TIES)]));
    else if (was <= 0 && now > 0) out.push(line([P(AHEAD)]));
  }
  if (ab.doublePlay) out.push(line([P(RC_DP)]));
  else for (const id of ab.runnersOut) {
    const from = ab.basesBefore.indexOf(id);
    if (from < 0) continue;
    const at = ctx.outAt(from);
    if (OUT_AT[`${from}.${at}`]) out.push(line([P(OUT_AT[`${from}.${at}`])]));
  }
  // Pitcher recap.
  const kInHalf = ctx.halfPlays.filter(p => p.outcome === 'k').length;
  const oneTwoThree = ctx.halfEnds && ctx.halfPlays.length === 3 && ctx.halfPlays.every(p => p.outsAfter > p.outsBefore && p.scored.length === 0) && !ctx.capped;
  if (ab.outcome === 'k') out.push(line([P(kInHalf >= 2 || oneTwoThree ? P_DEAL[role] : pick(r, P_K[role]))]));
  else if ((['bb', 'hbp', 'single', 'double', 'triple'] as OutcomeKey[]).includes(ab.outcome) && (ab.basesAfter[1] || ab.basesAfter[2]) && ab.outsAfter < 3)
    out.push(line([P(pick(r, P_JAM[role]))]));
  if (ctx.halfEnds) {
    out.push(line([P(oneTwoThree ? ONETWOTHREE : pick(r, SIDE))]));
    const [h, v] = ctx.scoreAfter;
    const lead: Seg[] = ab.battingSide === 1 ? [P(TO_BOTTOM)] : [P(AFTER_N[Math.min(15, ab.inning)])];
    lead.push(P(h === v ? `sc.tied.${Math.min(20, h)}` : LEAD_BY[`${h > v ? 'home' : 'visitors'}.${Math.min(20, Math.abs(h - v))}`]));
    out.push(line(lead));
  } else {
    const mask = ab.basesAfter.reduce((m, b, i) => m | (b ? 1 << i : 0), 0);
    const changed = runs > 0 || ab.runnersOut.length > 0 || ab.outsAfter !== ab.outsBefore || ab.basesAfter.some((b, i) => !!b !== !!ab.basesBefore[i]);
    if (changed && mask > 0) out.push(line([P(BASES_OUTS[`${mask}.${Math.min(2, ab.outsAfter)}`])]));
  }
  return out;
}

// ---------------- Checks used by tests ----------------
export const ALL_KEYS = () => Object.keys(PHRASES);
export const wordCount = (l: PbpLine) => lineText(l).split(/\s+/).filter(Boolean).length;
