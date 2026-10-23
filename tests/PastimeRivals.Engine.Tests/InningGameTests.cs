using PastimeRivals.Engine;
using Xunit;

namespace PastimeRivals.Engine.Tests;

/// <summary>Plan 38 stage A: the inning game loop and era rules.</summary>
public class InningGameTests
{
    private static readonly Rates Avg = Rates.From(0.20, 0.085, 0.01, 0.14, 0.045, 0.004, 0.03);
    private static readonly Rates Out = Rates.From(1, 0, 0, 0, 0, 0, 0);
    private static readonly Rates Hr = Rates.From(0, 0, 0, 0, 0, 0, 1);
    private static ulong Seed(int n) => 0x1234UL + (ulong)n * 7919UL;

    [Theory]
    [InlineData(1927, "AL", false)] [InlineData(1973, "AL", true)] [InlineData(1973, "NL", false)] [InlineData(2020, "NL", true)]
    [InlineData(2021, "NL", false)] [InlineData(2022, "NL", true)] [InlineData(1915, "FL", false)]
    public void Designated_hitter_follows_the_newest_home_season(int season, string league, bool dh)
    {
        var era = EraRules.From(new[] { (1950, "NL"), (season, league) });
        Assert.Equal(dh, era.DesignatedHitter);
        Assert.Equal(dh ? 9 : 8, era.PickedBatters);
    }

    [Fact]
    public void A_same_season_AL_NL_tie_lets_the_AL_player_decide_and_the_runner_starts_in_2020()
    {
        Assert.True(EraRules.From(new[] { (1980, "NL"), (1980, "AL") }).DesignatedHitter);
        Assert.False(EraRules.From(new[] { (2019, "AL") }).RunnerOnSecondInExtras);
        Assert.True(EraRules.From(new[] { (2020, "AL") }).RunnerOnSecondInExtras);
    }

    [Fact]
    public void Visitors_bat_first_and_each_half_ends_at_three_outs()
    {
        var g = InningGame.Play((_, _) => Avg, (s, i) => $"s{s}b{i}", EraRules.From(new[] { (1990, "AL") }), Seed, _ => 0.03);
        Assert.Equal(1, g.Plays[0].BattingSide);
        foreach (var grp in g.Plays.GroupBy(p => (p.Inning, p.BattingSide)))
        {
            var last = grp.Last().Play;
            var walkOff = grp.Key.BattingSide == 0 && grp.Key.Inning == g.Innings && g.Winner == 0;
            if (!walkOff) Assert.Equal(3, last.OutsAfter);
        }
        Assert.Equal(g.Totals[0], g.LineScore[0].Sum());
        Assert.Equal(g.Totals[1], g.LineScore[1].Sum());
        Assert.Equal(g.Totals.Sum(), g.Plays.Sum(p => p.Runs));
    }

    [Fact]
    public void Home_wins_on_the_first_run_in_a_tied_bottom_half()
    {
        // Visitors cannot score; home hits home runs: the game ends after one run... a home run counts all runs, bases empty = 1.
        var g = InningGame.Play((s, _) => s == 1 ? Out : Hr, (s, i) => $"s{s}b{i}", EraRules.From(new[] { (1990, "AL") }), Seed, _ => 0);
        Assert.Equal(0, g.Winner);
        Assert.Equal(new[] { 1, 0 }, g.Totals);
        Assert.Equal(1, g.Plays.Count(p => p.BattingSide == 0));
    }

    [Fact]
    public void A_scoreless_game_goes_three_extra_innings_then_ends_in_a_tie_with_the_runner_rule_by_era()
    {
        var old = InningGame.Play((_, _) => Out, (s, i) => $"s{s}b{i}", EraRules.From(new[] { (1990, "AL") }), Seed, _ => 0);
        Assert.Equal(-1, old.Winner);
        Assert.Equal(4, old.Innings);
        Assert.All(old.Plays, p => Assert.Null(p.Play.BasesBefore[1]));
        var modern = InningGame.Play((_, _) => Out, (s, i) => $"s{s}b{i}", EraRules.From(new[] { (2023, "NL") }), Seed, _ => 0);
        var firstExtra = modern.Plays.First(p => p.Inning == 2 && p.BattingSide == 1);
        // the runner is the visitors' last batter of the 1st (spot 2 after a 1-2-3 inning), leadoff is spot 3
        Assert.Equal("s1b2", firstExtra.Play.BasesBefore[1]);
        Assert.Equal(3, firstExtra.Spot);
    }

    [Fact]
    public void The_lineup_order_carries_over_and_the_same_seed_gives_the_same_game()
    {
        var era = EraRules.From(new[] { (1999, "NL") });
        var a = InningGame.Play((_, _) => Avg, (s, i) => $"s{s}b{i}", era, Seed, _ => 0.03);
        var b = InningGame.Play((_, _) => Avg, (s, i) => $"s{s}b{i}", era, Seed, _ => 0.03);
        Assert.Equal(a.Totals, b.Totals);
        Assert.Equal(a.Plays.Select(p => p.Batter), b.Plays.Select(p => p.Batter));
        foreach (var side in new[] { 0, 1 })
        {
            var spots = a.Plays.Where(p => p.BattingSide == side).Select(p => p.Spot).ToList();
            for (var i = 1; i < spots.Count; i++) Assert.Equal((spots[i - 1] + 1) % 9, spots[i]);
        }
    }
}
