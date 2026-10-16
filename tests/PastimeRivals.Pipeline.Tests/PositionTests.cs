using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class PositionTests
{
    private static Dictionary<string, int> G(params (string Pos, int Games)[] g) => g.ToDictionary(x => x.Pos, x => x.Games);

    [Fact]
    public void Picks_the_position_with_most_games_across_teams()
    {
        var rows = new[] { G(("lf", 56), ("rf", 99), ("of", 155)) };
        Assert.Equal("RF", Positions.Primary(rows));
    }

    [Fact]
    public void Sums_games_over_team_rows_for_traded_players()
    {
        var rows = new[] { G(("ss", 40), ("2b", 10)), G(("2b", 45)) };
        Assert.Equal("2B", Positions.Primary(rows));
    }

    [Fact]
    public void Uses_generic_outfield_only_when_specific_outfield_games_are_missing()
    {
        Assert.Equal("OF", Positions.Primary(new[] { G(("of", 120), ("1b", 5)) }));
    }

    [Fact]
    public void Ties_follow_fixed_order()
    {
        Assert.Equal("C", Positions.Primary(new[] { G(("c", 20), ("1b", 20)) }));
    }

    [Fact]
    public void Designated_hitter_counts_pitchers_batting_show_P_and_no_fielding_games_is_pinch_hitter()
    {
        Assert.Equal("DH", Positions.Primary(new[] { G(("dh", 140), ("1b", 3)) }));
        Assert.Equal("P", Positions.Primary(new[] { G(("p", 30)) }));   // a pitcher batting
        Assert.Equal("PH", Positions.Primary(new[] { G(("ph", 30)) }));
    }
}
