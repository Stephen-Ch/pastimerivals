using PastimeRivals.Api.Challenges;
using PastimeRivals.Engine;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 38 stage B: inning rules on the server (lineups, era, pitcher batting, duplicates, the half-inning cap).</summary>
public class InningRulesTests
{
    /// <summary>Like FixedOracle, but ids starting "al" are AL seasons, "k" ids strike out, and pitchers bat as strikeouts.</summary>
    private sealed class Oracle : IMatchupOracle
    {
        public readonly FixedOracle Inner = new();
        public int PitcherAtBats;
        public Rates? Odds(PickRef b, PickRef p) => b.Id.EndsWith('k') ? Only(Outcome.K) : b.Id.EndsWith('o') ? Only(Outcome.Oip) : Only(Outcome.Single);
        public IReadOnlyList<PickRef> Top50(bool pitchers) => Inner.Top50(pitchers);
        public IReadOnlyList<PickRef>[] RandomPool(bool pitchers, int level) => Inner.RandomPool(pitchers, level);
        public string LeagueOf(PickRef p, bool pitcher) => p.Id.StartsWith("al") ? "AL" : "NL";
        public Rates? PitcherAtBat(PickRef b, PickRef p) { PitcherAtBats++; return Only(Outcome.K); }
        private static Rates Only(Outcome o) { var v = new double[Rates.Count]; v[(int)o] = 1; return Rates.Normalize(v); }
    }

    private static List<SlotPick> Team(string prefix, int year, int batters, string suffix = "o", params (int Slot, string Id)[] backups) =>
        Enumerable.Range(0, batters + 1).Select(k =>
        {
            var c = new List<PickRef> { new(k == 0 ? $"{prefix}p" : $"{prefix}{k}{suffix}", year) };
            c.AddRange(backups.Where(b => b.Slot == k).Select(b => new PickRef(b.Id, year)));
            return new SlotPick(k, c);
        }).ToList();

    [Fact]
    public void Inning_picks_need_the_pitcher_plus_8_or_9_batters()
    {
        Assert.Null(Rules.ValidateInning(Team("a", 2000, 9), 9));
        Assert.Null(Rules.ValidateInning(Team("a", 1960, 8), 8));
        Assert.NotNull(Rules.ValidateInning(Team("a", 2000, 8), 9));
        Assert.NotNull(Rules.ValidateInning(Team("a", 2000, 3), 9));
        Assert.NotNull(Rules.ValidateInning(Team("a", 2000, 9), 8));
        var twice = Team("a", 2000, 9); twice[5] = new SlotPick(5, new[] { twice[4].Choices[0] });
        Assert.Equal("No player twice on one side.", Rules.ValidateInning(twice, 9));
    }

    [Fact]
    public void Era_comes_from_the_home_first_choices_with_the_pitcher_counted_by_his_pitching_league()
    {
        var o = new Oracle();
        Assert.True(Rules.EraFrom(Team("al", 1980, 9), o).DesignatedHitter);
        Assert.False(Rules.EraFrom(Team("nl", 1980, 8), o).DesignatedHitter);
        // Newest season is a 2021 NL batter: no DH, but the extra-inning runner applies.
        var mixed = Team("al", 1960, 8); mixed[3] = new SlotPick(3, new[] { new PickRef("nlx", 2021) });
        var era = Rules.EraFrom(mixed, o);
        Assert.False(era.DesignatedHitter);
        Assert.True(era.RunnerOnSecondInExtras);
        Assert.Equal(2021, era.Season);
    }

    [Fact]
    public void Without_the_DH_the_pitcher_bats_ninth_and_uses_the_pitcher_line()
    {
        var o = new Oracle();
        var era = EraRules.From(new[] { (1965, "NL") });
        var g = Rules.PlayInning(new[] { Team("h", 1965, 8), Team("v", 1965, 8) }, 99, o, era);
        Assert.Equal(10, g.Inning!.Lineups[0].Count);
        Assert.Equal("hp", g.Inning.Lineups[0][9].Id);
        Assert.Equal("pitcher", g.Inning.Lineups[0][9].From);
        Assert.Equal("vp", g.Lineups[1][9].Id);
        // All outs: 1-2-3 innings, so the 9th spot comes up in the 3rd inning (spots 6, 7, 8).
        Assert.Contains(g.AtBats, a => a.Batter.Id == "vp" && a.Inn!.Spot == 8);
        Assert.True(o.PitcherAtBats > 0);
        Assert.All(g.AtBats.Where(a => a.Batter.Id is "vp" or "hp"), a => Assert.Equal(Outcome.K, a.Outcome));
    }

    [Fact]
    public void Same_seed_same_game_and_each_at_bat_keeps_its_seed()
    {
        var o = new Oracle();
        var era = EraRules.From(new[] { (2000, "AL") });
        var a = Rules.PlayInning(new[] { Team("h", 2000, 9, "s"), Team("v", 2000, 9, "o") }, 7, o, era);
        var b = Rules.PlayInning(new[] { Team("h", 2000, 9, "s"), Team("v", 2000, 9, "o") }, 7, o, era);
        Assert.Equal(a.AtBats.Select(x => (x.Outcome, x.Inn!.OutType, x.Points)), b.AtBats.Select(x => (x.Outcome, x.Inn!.OutType, x.Points)));
        Assert.All(a.AtBats, x => Assert.Equal(Rules.SeedFor(7, x.Index), x.Seed));
        Assert.Equal(a.Totals.Sum(), a.AtBats.Sum(x => x.Points));
        Assert.Equal(a.Totals[0], a.Inning!.LineScore[0].Sum());
    }

    [Fact]
    public void A_duplicate_anywhere_in_ten_slots_moves_the_friend_to_a_backup_then_a_top_50_swap()
    {
        var o = new Oracle();
        var era = EraRules.From(new[] { (2000, "AL") });
        var home = Team("h", 2000, 9);
        var visit = Team("v", 2000, 9, "o", (7, "h3o"), (7, "zz7o"));
        visit[7] = new SlotPick(7, new[] { new PickRef("h7o", 2000), new PickRef("h3o", 2000), new PickRef("zz7o", 2000) });
        visit[9] = new SlotPick(9, new[] { new PickRef("h9o", 2000) });
        var g = Rules.PlayInning(new[] { home, visit }, 5, o, era);
        Assert.Equal("zz7o", g.Inning!.Lineups[1][7].Id);
        Assert.Equal("backup", g.Inning.Lineups[1][7].From);
        Assert.Equal("swap", g.Inning.Lineups[1][9].From);
        Assert.StartsWith("tb", g.Inning.Lineups[1][9].Id);
        Assert.All(g.Inning.Lineups[0], e => Assert.Equal("pick", e.From));
    }

    [Fact]
    public void A_half_that_never_ends_stops_at_30_batters_with_a_note_and_the_game_fits_storage()
    {
        var o = new Oracle();
        var era = EraRules.From(new[] { (2000, "AL") });
        var g = Rules.PlayInning(new[] { Team("h", 2000, 9, "s"), Team("v", 2000, 9, "s") }, 3, o, era);
        Assert.True(g.AtBats.Count <= 255);
        Assert.Contains(g.Notes, n => n.Contains("stopped after 30"));
        var top = g.AtBats.Where(a => a.Inn!.Inning == 1 && a.BattingSide == 1).ToList();
        Assert.Equal(30, top.Count);
        Assert.True(top[^1].Inn!.OutsAfter < 3);
    }

    [Fact]
    public void A_lineup_that_does_not_match_the_era_is_refused()
    {
        var o = new Oracle();
        Assert.Throws<InvalidOperationException>(() => Rules.PlayInning(new[] { Team("h", 2000, 9), Team("v", 2000, 8) }, 1, o, EraRules.From(new[] { (2000, "AL") })));
    }

    [Fact]
    public void Quick_pick_drops_the_oldest_batter_never_the_one_who_set_the_rules()
    {
        var o = new Oracle();
        SlotOut S(int slot, string id, int year) => new(slot, new[] { new PlayerOut(id, year, id) });
        // A 2021 NL batter in spot 9 sets "no DH, runner on"; 2020-and-later AL players are older here only by one year.
        var nine = new List<SlotOut> { S(0, "nlp", 2019) };
        for (var k = 1; k <= 8; k++) nine.Add(S(k, $"al{k}", k == 4 ? 1950 : 2020));
        nine.Add(S(9, "nl9", 2021));
        var eight = ChallengeEndpoints.EightFromNine(nine, o)!;
        Assert.Equal(9, eight.Count);
        Assert.DoesNotContain(eight, x => x.Choices[0].Id == "al4");
        Assert.Equal(Enumerable.Range(0, 9), eight.Select(x => x.Slot));
        var era = Rules.EraFrom(eight.Select(x => new SlotPick(x.Slot, new[] { new PickRef(x.Choices[0].Id, x.Choices[0].Year) })).ToList(), o);
        Assert.False(era.DesignatedHitter);
        Assert.Equal(2021, era.Season);
    }

    [Fact]
    public void A_pitcher_with_30_or_more_plate_appearances_bats_with_his_own_line_else_his_decade_line()
    {
        var decade = new SeasonCounts(40000, 40000, 12000, 1500, 100, 4000, 600, 100, 100);
        var decades = new Dictionary<int, SeasonCounts> { [1960] = decade };
        var own = new SeasonCounts(40, 40, 10, 2, 0, 9, 2, 0, 1);
        var a = PastimeRivals.Api.Stats.PlayService.PitcherBattingLine(decades, own, 1965)!;
        Assert.Equal(3000, a.Pa);
        Assert.Equal(own.K * 75, a.K);
        Assert.Equal(own.Single * 75, a.Single);
        var b = PastimeRivals.Api.Stats.PlayService.PitcherBattingLine(decades, own with { Pa = 29, KKnownPa = 29 }, 1965)!;
        Assert.Equal(decade.K * 3000 / 40000, b.K);
        var none = PastimeRivals.Api.Stats.PlayService.PitcherBattingLine(decades, null, 1972)!;
        Assert.Equal(b.K, none.K);
        // A thin decade (under 20,000 PA) uses the decade before.
        decades[1970] = new SeasonCounts(1000, 1000, 900, 0, 0, 10, 0, 0, 0);
        Assert.Equal(b.K, PastimeRivals.Api.Stats.PlayService.PitcherBattingLine(decades, null, 1975)!.K);
    }

    [Fact]
    public void Plays_carry_the_engines_runner_outs_double_plays_and_sac_flies()
    {
        var o = new Oracle();
        var era = EraRules.From(new[] { (2000, "AL") });
        bool dp = false, sf = false;
        for (ulong seed = 0; seed < 300 && !(dp && sf); seed++)
        {
            // Batters alternate singles ("s") and outs in play ("o") so runners are on when outs happen.
            var h = Team("h", 2000, 9, "o"); var v = Team("v", 2000, 9, "o");
            for (var k = 1; k <= 9; k += 2) { h[k] = new SlotPick(k, new[] { new PickRef($"h{k}s", 2000) }); v[k] = new SlotPick(k, new[] { new PickRef($"v{k}s", 2000) }); }
            foreach (var a in Rules.PlayInning(new[] { h, v }, seed, o, era).AtBats)
            {
                var n = a.Inn!;
                if (n.DoublePlay) { dp = true; Assert.True(n.OutsAfter - n.OutsBefore == 2 || n.OutsAfter == 3); Assert.NotEmpty(n.RunnersOut!); }
                if (n.SacFly) { sf = true; Assert.Equal(OutType.Fly, n.OutType); Assert.NotEmpty(n.Scored); }
                Assert.All(n.RunnersOut!, r => Assert.Contains(r, n.BasesBefore));
            }
        }
        Assert.True(dp && sf);
    }
}
