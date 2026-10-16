using PastimeRivals.Engine;

namespace PastimeRivals.Engine.Tests;

public class StatsCatalogTests
{
    private static SeasonCounts C(int pa, int k, int bb, int hr, int single = 0) => new(pa, pa, k, bb, 0, single, 0, 0, hr);

    private static StatsCatalog Catalog() => new(
        leagues: new[]
        {
            new LeagueRow(1950, "AL", "bat", C(1000, 100, 100, 20, 150)),
            new LeagueRow(1950, "NL", "bat", C(1000, 200, 50, 40, 150)),
            new LeagueRow(1950, "AL", "pit", C(1100, 110, 110, 22, 165)),
            new LeagueRow(1950, "NL", "pit", C(1100, 220, 55, 44, 165)),
        },
        platoon: new[]
        {
            new PlatoonRow(1950, true, C(400, 60, 20, 8, 60)),
            new PlatoonRow(1950, false, C(600, 60, 50, 18, 90)),
        },
        batters: new[] { new PlayerRow("mover", 1950, 100, 300, 0, C(400, 60, 40, 10, 60), 'A') },
        pitchers: Array.Empty<PlayerRow>(),
        exposure: new[] { new ExposureRow("bat", "mover", 1950, 100, 400) });

    [Fact]
    public void Traded_players_league_is_weighted_by_plate_appearances()
    {
        var lg = Catalog().PlayerLeague(Catalog().Batter("mover", 1950)!.Row, "bat");
        // 25% AL (K 10%) + 75% NL (K 20%) = 17.5%
        Assert.Equal(0.175, lg[Outcome.K], 9);
    }

    [Fact]
    public void Platoon_factors_are_matchup_rate_over_overall_rate()
    {
        var p = Catalog().PlatoonFor(1950);
        // overall K = 120/1000 = 12%; same-hand K = 60/400 = 15% -> 1.25; opposite 10% -> 0.833
        Assert.Equal(1.25, p.Same[(int)Outcome.K], 6);
        Assert.Equal(0.1 / 0.12, p.Opposite[(int)Outcome.K], 6);
        Assert.Equal(0.4, p.LeagueSameShare, 9);
    }

    [Fact]
    public void Player_input_carries_exposure_and_own_era_platoon()
    {
        var b = Catalog().Batter("mover", 1950)!;
        Assert.Equal(0.25, b.Input.Exposure!.Share!.Value, 9);
        Assert.NotNull(b.Input.OwnEraPlatoon);
    }

    [Fact]
    public void Neutral_environment_pools_batting_rows_over_the_chosen_years()
    {
        var n = Catalog().Neutral(1950, 1950);
        Assert.Equal(0.15, n[Outcome.K], 9);  // (100 + 200) / 2000
    }

    [Fact]
    public void Unknown_player_returns_null() => Assert.Null(Catalog().Batter("nobody", 1950));
}
