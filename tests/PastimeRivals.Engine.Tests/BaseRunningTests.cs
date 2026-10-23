using PastimeRivals.Engine;
using Xunit;
using Xunit.Abstractions;

namespace PastimeRivals.Engine.Tests;

/// <summary>Plan 38 stage A: base running rules and calibration against real seasons.</summary>
public class BaseRunningTests(ITestOutputHelper output)
{
    private static readonly string?[] Empty = new string?[3];
    private static string?[] B(string? first, string? second, string? third) => new[] { first, second, third };

    [Fact]
    public void Walk_forces_only_forced_runners()
    {
        var p = BaseRunning.Apply(Outcome.Bb, OutType.None, 0, B(null, "r2", "r3"), "bat", new SeededRandom(1));
        Assert.Equal(B("bat", "r2", "r3"), p.BasesAfter);
        Assert.Empty(p.Scored);
        var loaded = BaseRunning.Apply(Outcome.Bb, OutType.None, 1, B("r1", "r2", "r3"), "bat", new SeededRandom(1));
        Assert.Equal(new[] { "r3" }, loaded.Scored);
        Assert.Equal(B("bat", "r1", "r2"), loaded.BasesAfter);
    }

    [Fact]
    public void Home_run_and_triple_clear_the_bases()
    {
        var hr = BaseRunning.Apply(Outcome.Hr, OutType.None, 2, B("r1", "r2", "r3"), "bat", new SeededRandom(1));
        Assert.Equal(new[] { "r3", "r2", "r1", "bat" }, hr.Scored);
        Assert.All(hr.BasesAfter, x => Assert.Null(x));
        var tr = BaseRunning.Apply(Outcome.Triple, OutType.None, 0, B("r1", null, null), "bat", new SeededRandom(1));
        Assert.Equal(new[] { "r1" }, tr.Scored);
        Assert.Equal(B(null, null, "bat"), tr.BasesAfter);
    }

    [Fact]
    public void Strikeouts_and_pops_move_nobody()
    {
        foreach (var (o, t) in new[] { (Outcome.K, OutType.None), (Outcome.Oip, OutType.Pop) })
        {
            var p = BaseRunning.Apply(o, t, 0, B("r1", "r2", "r3"), "bat", new SeededRandom(5));
            Assert.Equal(1, p.OutsAfter);
            Assert.Equal(B("r1", "r2", "r3"), p.BasesAfter);
            Assert.Empty(p.Scored);
        }
    }

    [Fact]
    public void Every_state_and_outcome_keeps_the_runner_count_honest()
    {
        var outcomes = Enum.GetValues<Outcome>();
        for (var mask = 0; mask < 8; mask++)
            for (var outs = 0; outs < 3; outs++)
                foreach (var o in outcomes)
                    foreach (var t in o == Outcome.Oip ? new[] { OutType.Ground, OutType.Fly, OutType.Line, OutType.Pop, OutType.Error } : new[] { OutType.None })
                        for (ulong s = 0; s < 200; s++)
                        {
                            var before = B((mask & 1) != 0 ? "r1" : null, (mask & 2) != 0 ? "r2" : null, (mask & 4) != 0 ? "r3" : null);
                            var p = BaseRunning.Apply(o, t, outs, before, "bat", new SeededRandom(s));
                            Assert.InRange(p.OutsAfter, outs, 3);
                            var people = before.Count(x => x is not null) + 1;
                            var accounted = p.BasesAfter.Count(x => x is not null) + p.Scored.Count + p.RunnersOut.Count;
                            var batterOut = !p.BasesAfter.Contains("bat") && !p.Scored.Contains("bat");
                            if (p.OutsAfter < 3) Assert.Equal(people, accounted + (batterOut ? 1 : 0));
                            else Assert.All(p.BasesAfter, x => Assert.Null(x));
                            Assert.Equal(p.BasesAfter.Where(x => x is not null).Count(), p.BasesAfter.Where(x => x is not null).Distinct().Count());
                            if (p.OutsAfter == 3 && o == Outcome.Oip && t == OutType.Ground) Assert.Empty(p.Scored);   // no run on a force third out
                        }
    }

    [Fact]
    public void Reaching_on_an_error_moves_every_runner_up_one()
    {
        var p = BaseRunning.Apply(Outcome.Oip, OutType.Error, 1, B("r1", null, "r3"), "bat", new SeededRandom(1));
        Assert.Equal(new[] { "r3" }, p.Scored);
        Assert.Equal(B("bat", "r1", null), p.BasesAfter);
        Assert.Equal(1, p.OutsAfter);
        Assert.Equal(0.05, BaseRunning.ReachOnErrorShare(1908));
        Assert.Equal(0.025, BaseRunning.ReachOnErrorShare(2024));
    }

    [Fact]
    public void Same_seed_same_play()
    {
        for (ulong s = 0; s < 500; s++)
        {
            var a = BaseRunning.Apply(Outcome.Single, OutType.None, 1, B("r1", "r2", null), "bat", new SeededRandom(s));
            var b = BaseRunning.Apply(Outcome.Single, OutType.None, 1, B("r1", "r2", null), "bat", new SeededRandom(s));
            Assert.Equal(a.BasesAfter, b.BasesAfter);
            Assert.Equal(a.Scored, b.Scored);
        }
    }

    [Fact]
    public void Walk_off_counts_runs_up_to_the_winning_run_and_all_runs_on_a_home_run()
    {
        // Home down 1 (needs 2 to win), runners on 2nd and 3rd: a single that scores both counts both.
        var single = Rates.From(0, 0, 0, 1, 0, 0, 0);
        var res = HalfInning.Play(_ => single, i => $"b{i}", 9, 0, i => (ulong)(1000 + i), stopWhenRunsReach: 2);
        Assert.True(res.Runs <= 2);
        var hr = Rates.From(0, 0, 0, 0, 0, 0, 1);
        var hrs = HalfInning.Play(_ => hr, i => $"b{i}", 9, 0, i => (ulong)i, stopWhenRunsReach: 1);
        Assert.Equal(1, hrs.Runs);   // solo shot ends it
    }

    [Fact]
    public void A_walk_off_hit_puts_nobody_out_after_the_winning_run()
    {
        // Sample 07 of the expert gate: two out, runners on first and third, a double; the plain engine sometimes throws
        // the runner from first out at home after the winning run has scored.
        var found = 0;
        for (ulong s = 0; s < 4000; s++)
        {
            var plain = BaseRunning.Apply(Outcome.Double, OutType.None, 2, B("r1", null, "r3"), "bat", new SeededRandom(s));
            if (plain.RunnersOut.Count == 0) continue;
            found++;
            Assert.Equal(3, plain.OutsAfter);
            var w = HalfInning.WalkOff(plain, 1);
            Assert.Equal(new[] { "r3" }, w.Scored);
            Assert.Empty(w.RunnersOut);
            Assert.Equal(2, w.OutsAfter);
        }
        Assert.True(found > 0);
        // Outs in play keep their outs: a sacrifice fly that wins it still has the batter out.
        for (ulong s = 0; s < 200; s++)
        {
            var fly = BaseRunning.Apply(Outcome.Oip, OutType.Fly, 1, B(null, null, "r3"), "bat", new SeededRandom(s));
            if (fly.Scored.Count == 0) continue;
            Assert.Equal(2, HalfInning.WalkOff(fly, 1).OutsAfter);
            break;
        }
    }

    // ---- Calibration (research 37, plan 38): league-average lineups against real runs per team per game. ----
    private static Rates League(params int[][] rows)
    {
        // rows: pa, k, bb, hbp, single, double, triple, hr (pitching side, both leagues)
        double Sum(int i) => rows.Sum(r => r[i]);
        var pa = Sum(0);
        return Rates.From(Sum(1) / pa, Sum(2) / pa, Sum(3) / pa, Sum(4) / pa, Sum(5) / pa, Sum(6) / pa, Sum(7) / pa);
    }

    public static IEnumerable<object[]> Seasons() => new[]
    {
        // year, real runs per team per game (baseball-reference.com/leagues/majors/misc.shtml, R/G of both teams / 2), league rows
        new object[] { 1908, 3.385, new[] { new[] { 45590, 4990, 2915, 401, 7808, 1291, 505, 116 }, new[] { 45385, 4219, 3243, 380, 7682, 1246, 504, 151 } } },
        new object[] { 1930, 5.55, new[] { new[] { 48354, 4100, 3979, 208, 8634, 2373, 659, 673 }, new[] { 48911, 3849, 3692, 202, 9350, 2393, 626, 892 } } },
        new object[] { 1968, 3.42, new[] { new[] { 60099, 9639, 4881, 426, 9045, 1872, 338, 1104 }, new[] { 60728, 9501, 4275, 352, 10106, 1995, 359, 891 } } },
        new object[] { 2000, 5.14, new[] { new[] { 88949, 14033, 8390, 681, 14258, 4242, 426, 2696 }, new[] { 101312, 17323, 9847, 892, 15442, 4659, 526, 2997 } } },
        new object[] { 2019, 4.83, new[] { new[] { 93448, 21241, 7921, 963, 13022, 4412, 386, 3490 }, new[] { 93069, 21582, 7974, 1021, 12925, 4119, 399, 3286 } } },
    };

    private static (double RunsPerHalf, double DpRate, double SfRate) Simulate(Rates rates, int halves, ulong salt, double roe = 0)
    {
        long runs = 0, dpChances = 0, dps = 0, pa = 0, sfs = 0;
        for (var h = 0; h < halves; h++)
        {
            var res = HalfInning.Play(_ => rates, i => $"p{i}", 9, 0, i => Mix(salt, (ulong)h, (ulong)i), reachOnError: roe);
            runs += res.Runs;
            foreach (var p in res.Plays)
            {
                pa++;
                if (p.BasesBefore[0] is not null && p.OutsBefore < 2) { dpChances++; if (p.DoublePlay && p.OutType == OutType.Ground) dps++; }
                if (p.SacFly) sfs++;
            }
        }
        return (runs / (double)halves, dps / (double)dpChances, sfs / (double)pa);
    }

    private static ulong Mix(ulong a, ulong b, ulong c)
    {
        var z = a * 0x9E3779B97F4A7C15UL ^ b * 0xBF58476D1CE4E5B9UL ^ c * 0x94D049BB133111EBUL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        return z ^ (z >> 27);
    }

    [Theory]
    [MemberData(nameof(Seasons))]
    public void League_average_runs_match_the_real_season(int year, double realPerGame, int[][] rows)
    {
        var (rph, dp, sf) = Simulate(League(rows), 20000, (ulong)year, BaseRunning.ReachOnErrorShare(year));
        var target = realPerGame / 9;
        output.WriteLine($"{year}: sim {rph * 9:F2} runs per 9 (real {realPerGame:F2}), DP {dp:P1} of chances, SF {sf:P2} of PA");
        Assert.InRange(rph, target * 0.88, target * 1.12);
        Assert.InRange(dp, 0.09, 0.13);
        Assert.InRange(sf, 0.004, 0.012);   // expert: 0.4-1.2% (real about 0.6-1.0%)
    }

    [Fact]
    public void A_lineup_of_hall_of_fame_seasons_does_not_run_away()
    {
        // About .330 / .430 / .600 per plate appearance against an average pitcher.
        var star = Rates.From(0.10, 0.13, 0.006, 0.17, 0.045, 0.008, 0.06);
        var (rph, _, _) = Simulate(star, 20000, 77, BaseRunning.ReachOnErrorShare(2019));
        output.WriteLine($"Hall of Fame lineup: {rph:F2} runs per half");
        Assert.True(rph < 1.2, $"{rph:F2} runs per half");
    }
}
