using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

/// <summary>One player-season. Slot 0 is the pitcher, slots 1 to 3 are batters.</summary>
public sealed record PickRef(string Id, int Year);

/// <summary>A slot with its first choice and up to 2 ranked backups (D19).</summary>
public sealed record SlotPick(int Slot, IReadOnlyList<PickRef> Choices);

/// <summary>Plan 38: the inning-game state around one plate appearance. Bases hold player ids (index 0 = first).</summary>
public sealed record InningAtBat(int Inning, int Spot, int OutsBefore, int OutsAfter, string?[] BasesBefore, string?[] BasesAfter, OutType OutType, IReadOnlyList<string> Scored,
    IReadOnlyList<string>? RunnersOut = null, bool DoublePlay = false, bool SacFly = false);

public sealed record AtBatResult(int Index, int Round, int BattingSide, PickRef Pitcher, PickRef Batter, ulong Seed, Outcome Outcome, int Points, InningAtBat? Inn = null);

/// <summary>Plan 38: one lineup place and where the player came from: "pick", "backup", "swap" (seeded top-50) or "pitcher" (bats 9th, no DH).</summary>
public sealed record LineupEntry(string Id, int Year, string From);

/// <summary>Plan 38: what an inning game adds. Lineups per side: [0] the pitcher, [1..9] the batting order.</summary>
public sealed record InningData(int RulesVersion, EraRules Era, IReadOnlyList<IReadOnlyList<LineupEntry>> Lineups, int[][] LineScore, int Innings);

public sealed record GameResult(ulong Seed, PickRef[][] Lineups, IReadOnlyList<AtBatResult> AtBats, int[] Totals, int Winner, IReadOnlyList<string> Notes, InningData? Inning = null);

/// <summary>What the rules need from the stats: outcome odds for a pairing and the top-50 pools.</summary>
public interface IMatchupOracle
{
    Rates? Odds(PickRef batter, PickRef pitcher);
    IReadOnlyList<PickRef> Top50(bool pitchers);
    /// <summary>Plan 26: real-workload seasons for a computer level (1 Random, 2 Good, 3 Hall of Famers, 4 Legends), one list per era.</summary>
    IReadOnlyList<PickRef>[] RandomPool(bool pitchers, int level);
    /// <summary>Plan 38: "AL", "NL" or another league code for that season (AL if he played any of it in the AL).</summary>
    string LeagueOf(PickRef player, bool pitcher) => "NL";
    /// <summary>Plan 38: a pitcher batting (no DH) against the other side's pitcher.</summary>
    Rates? PitcherAtBat(PickRef pitcherBatting, PickRef pitcher) => Odds(pitcherBatting, pitcher);
    /// <summary>Plan 38: loads anything slow before a claim transaction starts.</summary>
    void Warm() { }
}

/// <summary>Pure challenge rules (D17 to D21). Same picks and seed always give the same game.</summary>
public static class Rules
{
    public const int Slots = 4;
    public const int MaxExtraRounds = 5;
    public const int MinLevel = 1, MaxLevel = 4;

    /// <summary>Plan 26: a random era (each era equally likely), then a random season in it; never a taken player.
    /// After 50 misses, any free season from the pool. Null when the pool has no free season.</summary>
    public static PickRef? DrawRandom(IReadOnlyList<PickRef>[] eras, ISet<string> taken, Func<int, int> next)
    {
        var live = Enumerable.Range(0, eras.Length).Where(e => eras[e].Count > 0).ToList();
        if (live.Count == 0) return null;
        for (var i = 0; i < 50; i++)
        {
            var era = eras[live[next(live.Count)]];
            var p = era[next(era.Count)];
            if (!taken.Contains(p.Id)) return p;
        }
        var rest = eras.SelectMany(x => x).Where(p => !taken.Contains(p.Id)).ToList();
        return rest.Count == 0 ? null : rest[next(rest.Count)];
    }

    /// <summary>Draws at the level, stepping down a level when that pool has no free season.</summary>
    public static PickRef? DrawAtLevel(IMatchupOracle oracle, bool pitchers, int level, ISet<string> taken, Func<int, int> next)
    {
        for (var l = Math.Clamp(level, MinLevel, MaxLevel); l >= MinLevel; l--)
            if (DrawRandom(oracle.RandomPool(pitchers, l), taken, next) is { } p) return p;
        return null;
    }

    public static int Points(Outcome o) => o switch
    {
        Outcome.Bb or Outcome.Hbp or Outcome.Single => 1,
        Outcome.Double => 2,
        Outcome.Triple => 3,
        Outcome.Hr => 4,
        _ => 0,
    };

    /// <summary>Checks one side's picks: 4 slots, 1 to 3 choices each, no player twice among first choices.</summary>
    public static string? Validate(IReadOnlyList<SlotPick>? picks)
    {
        if (picks is null || picks.Count != Slots || picks.Any(p => p is null)) return "Pick 1 pitcher and 3 batters.";
        if (picks.Select(p => p.Slot).OrderBy(s => s).SequenceEqual(Enumerable.Range(0, Slots)) == false) return "Each slot once.";
        foreach (var p in picks)
        {
            if (p.Choices is null || p.Choices.Count is < 1 or > 3 || p.Choices.Any(c => c is null)) return "Each slot needs 1 to 3 choices.";
            if (p.Choices.Any(c => string.IsNullOrWhiteSpace(c.Id) || c.Id.Length > 12 || c.Year is < 1871 or > 2100)) return "Bad player.";
            if (p.Choices.Select(c => c.Id).Distinct().Count() != p.Choices.Count) return "Backups must be different players.";
        }
        var firsts = picks.Select(p => p.Choices[0].Id).ToList();
        if (firsts.Distinct().Count() != firsts.Count) return "No player twice on one side.";
        return null;
    }

    /// <summary>Per at-bat seed from the master seed (SplitMix64 step), stored with each at-bat.</summary>
    public static ulong SeedFor(ulong master, int index)
    {
        var z = master + 0x9E3779B97F4A7C15UL * (ulong)(index + 1);
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }

    /// <summary>
    /// Duplicate resolution (D19): a player on both sides (any season or role) is a duplicate. The creator submitted
    /// first, so the creator keeps him and the friend (side 1) moves to the next backup (Stephen, 2026-10-18).
    /// When a slot runs out, a seeded pick from the top 50 at that position. Works for any number of slots (plan 38).
    /// </summary>
    public static (PickRef[][] Lineups, List<string> Notes) ResolveDuplicates(IReadOnlyList<SlotPick>[] sides, ulong seed, IMatchupOracle oracle)
    {
        var (lineups, notes, _) = ResolveWithSources(sides, seed, oracle);
        return (lineups, notes);
    }

    public static (PickRef[][] Lineups, List<string> Notes, string[][] Sources) ResolveWithSources(IReadOnlyList<SlotPick>[] sides, ulong seed, IMatchupOracle oracle)
    {
        var rng = new SeededRandom(seed ^ 0xD19D19D19D19UL);
        var lists = sides.Select(s => s.OrderBy(p => p.Slot).Select(p => p.Choices.ToList()).ToArray()).ToArray();
        var pos = new int[2][] { new int[lists[0].Length], new int[lists[1].Length] };
        var chosen = new PickRef[2][] { new PickRef[lists[0].Length], new PickRef[lists[1].Length] };
        var sources = new string[2][] { new string[lists[0].Length], new string[lists[1].Length] };
        var notes = new List<string>();
        for (var s = 0; s < 2; s++)
            for (var k = 0; k < lists[s].Length; k++) { chosen[s][k] = lists[s][k][0]; sources[s][k] = "pick"; }

        for (var guard = 0; guard < 64; guard++)
        {
            var clash = FindClash(chosen);
            if (clash is null) break;
            var (ka, kb) = clash.Value;
            const int side = 1;
            var slot = kb;
            var before = chosen[side][slot];
            chosen[side][slot] = Next(side, slot);
            notes.Add($"{before.Id} was picked by both sides; the friend used {chosen[side][slot].Id} instead.");
        }
        return (chosen, notes, sources);

        PickRef Next(int side, int slot)
        {
            var other = chosen[1 - side];
            var own = chosen[side];
            bool Free(PickRef c) => other.All(o => o.Id != c.Id) && own.Where((_, i) => i != slot).All(o => o.Id != c.Id);
            while (++pos[side][slot] < lists[side][slot].Count)
                if (Free(lists[side][slot][pos[side][slot]])) { sources[side][slot] = "backup"; return lists[side][slot][pos[side][slot]]; }
            var pool = oracle.Top50(slot == 0).Where(Free).ToList();
            if (pool.Count == 0) throw new InvalidOperationException("Top-50 pool exhausted.");
            sources[side][slot] = "swap";
            return pool[(int)(rng.NextDouble() * pool.Count)];
        }
    }

    private static (int, int)? FindClash(PickRef[][] c)
    {
        for (var a = 0; a < c[0].Length; a++)
            for (var b = 0; b < c[1].Length; b++)
                if (c[0][a].Id == c[1][b].Id) return (a, b);
        return null;
    }

    /// <summary>
    /// Plays the game (D17 c). Side 1 (the friend) bats first against side 0's pitcher, then side 0 bats.
    /// Tie: each side's first batter faces the other pitcher again, up to 5 rounds, then a draw (Winner -1).
    /// </summary>
    public static GameResult Play(IReadOnlyList<SlotPick>[] sides, ulong seed, IMatchupOracle oracle)
    {
        var (lineups, notes) = ResolveDuplicates(sides, seed, oracle);
        var atBats = new List<AtBatResult>();
        var totals = new int[2];
        void Face(int round, int battingSide, int batterSlot)
        {
            var pitcher = lineups[1 - battingSide][0];
            var batter = lineups[battingSide][batterSlot];
            var odds = oracle.Odds(batter, pitcher) ?? throw new InvalidOperationException($"No odds for {batter.Id} vs {pitcher.Id}.");
            var idx = atBats.Count;
            var s = SeedFor(seed, idx);
            var o = Simulator.Draw(odds, new SeededRandom(s));
            var pts = Points(o);
            totals[battingSide] += pts;
            atBats.Add(new AtBatResult(idx, round, battingSide, pitcher, batter, s, o, pts));
        }
        foreach (var side in new[] { 1, 0 })
            for (var k = 1; k < Slots; k++) Face(0, side, k);
        for (var r = 1; r <= MaxExtraRounds && totals[0] == totals[1]; r++)
        {
            Face(r, 1, 1);
            Face(r, 0, 1);
        }
        var winner = totals[0] == totals[1] ? -1 : totals[0] > totals[1] ? 0 : 1;
        return new GameResult(seed, lineups, atBats, totals, winner, notes);
    }

    // ---- Plan 38: inning mode ----
    public const string Classic = "classic", Inning = "inning";
    public const int InningRulesVersion = 1;
    /// <summary>A half inning stops after this many plate appearances so a game always fits its stored at-bat index (0-255).</summary>
    public const int MaxPaPerHalf = 30;
    public const int InningDeco = 3;

    /// <summary>Era rules from the home side's first choices (slot 0 the pitcher, the rest batters).</summary>
    public static EraRules EraFrom(IReadOnlyList<SlotPick> home, IMatchupOracle oracle) =>
        EraRules.From(home.Select(p => (p.Choices[0].Year, oracle.LeagueOf(p.Choices[0], pitcher: p.Slot == 0))));

    /// <summary>Inning picks: slot 0 the pitcher, slots 1..batters the batting order; 1 to 3 choices each; no player twice among first choices.</summary>
    public static string? ValidateInning(IReadOnlyList<SlotPick>? picks, int batters)
    {
        var need = $"Pick 1 pitcher and {batters} batters.";
        if (picks is null || picks.Count != batters + 1 || picks.Any(p => p is null)) return need;
        if (!picks.Select(p => p.Slot).OrderBy(s => s).SequenceEqual(Enumerable.Range(0, batters + 1))) return need;
        foreach (var p in picks)
        {
            if (p.Choices is null || p.Choices.Count is < 1 or > 3 || p.Choices.Any(c => c is null)) return "Each slot needs 1 to 3 choices.";
            if (p.Choices.Any(c => string.IsNullOrWhiteSpace(c.Id) || c.Id.Length > 12 || c.Year is < 1871 or > 2100)) return "Bad player.";
            if (p.Choices.Select(c => c.Id).Distinct().Count() != p.Choices.Count) return "Backups must be different players.";
        }
        var firsts = picks.Select(p => p.Choices[0].Id).ToList();
        if (firsts.Distinct().Count() != firsts.Count) return "No player twice on one side.";
        return null;
    }

    /// <summary>
    /// Plan 38: plays an inning game. Side 1 (visitors) bats first. Duplicates as classic, over every slot. Without the DH
    /// the side's pitcher bats 9th. Each plate appearance n uses SeedFor(seed, n); errors follow the fielding pitcher's season.
    /// </summary>
    public static GameResult PlayInning(IReadOnlyList<SlotPick>[] sides, ulong seed, IMatchupOracle oracle, EraRules era)
    {
        var (chosen, notes, sources) = ResolveWithSources(sides, seed, oracle);
        var order = new PickRef[2][];
        var from = new string[2][];
        for (var s = 0; s < 2; s++)
        {
            if (chosen[s].Length != era.PickedBatters + 1) throw new InvalidOperationException("Lineup size does not match the era rules.");
            order[s] = chosen[s].Skip(1).Concat(era.DesignatedHitter ? Array.Empty<PickRef>() : new[] { chosen[s][0] }).ToArray();
            from[s] = sources[s].Skip(1).Concat(era.DesignatedHitter ? Array.Empty<string>() : new[] { "pitcher" }).ToArray();
        }
        var cache = new Dictionary<(int, int), Rates>();
        Rates RatesFor(int side, int spot)
        {
            if (cache.TryGetValue((side, spot), out var r)) return r;
            var batter = order[side][spot];
            var pitcher = chosen[1 - side][0];
            var pitcherBats = !era.DesignatedHitter && spot == InningGame.LineupLength - 1;
            r = (pitcherBats ? oracle.PitcherAtBat(batter, pitcher) : oracle.Odds(batter, pitcher))
                ?? throw new InvalidOperationException($"No odds for {batter.Id} vs {pitcher.Id}.");
            return cache[(side, spot)] = r;
        }
        var g = InningGame.Play(RatesFor, (side, spot) => order[side][spot].Id, era, n => SeedFor(seed, n),
            side => BaseRunning.ReachOnErrorShare(chosen[1 - side][0].Year), MaxPaPerHalf);

        var atBats = g.Plays.Select(p => new AtBatResult(p.Index, p.Inning - 1, p.BattingSide, chosen[1 - p.BattingSide][0], order[p.BattingSide][p.Spot], p.Seed,
            p.Play.Outcome, p.Runs, new InningAtBat(p.Inning, p.Spot, p.Play.OutsBefore, p.Play.OutsAfter, p.Play.BasesBefore, p.Play.BasesAfter, p.Play.OutType, p.Play.Scored,
            p.Play.RunnersOut, p.Play.DoublePlay, p.Play.SacFly))).ToList();
        foreach (var half in atBats.GroupBy(a => (a.Inn!.Inning, a.BattingSide)))
        {
            var last = half.Last().Inn!;
            var walkOff = half.Key.BattingSide == 0 && half.Key.Inning == g.Innings && g.Winner == 0;
            var note = $"A half inning was stopped after {MaxPaPerHalf} batters.";
            if (last.OutsAfter < 3 && !walkOff && !notes.Contains(note)) notes.Add(note);
        }
        var lineups = Enumerable.Range(0, 2).Select(s => (IReadOnlyList<LineupEntry>)new[] { new LineupEntry(chosen[s][0].Id, chosen[s][0].Year, sources[s][0]) }
            .Concat(order[s].Select((p, i) => new LineupEntry(p.Id, p.Year, from[s][i]))).ToList()).ToList();
        var flat = Enumerable.Range(0, 2).Select(s => new[] { chosen[s][0] }.Concat(order[s]).ToArray()).ToArray();
        return new GameResult(seed, flat, atBats, g.Totals, g.Winner, notes, new InningData(InningRulesVersion, era, lineups, g.LineScore, g.Innings));
    }
}
