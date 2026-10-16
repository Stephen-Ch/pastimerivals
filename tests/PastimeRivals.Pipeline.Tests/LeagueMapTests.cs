using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class LeagueMapTests
{
    private static readonly LeagueMap Map = LeagueMap.FromTeamAbr(new[]
    {
        "\"MIL\",\"AL\",\"Milwaukee\",\"Brewers\",\"1970\",\"1997\"",
        "\"MIL\",\"NL\",\"Milwaukee\",\"Brewers\",\"1998\",\"2021\"",
        "\"NYA\",\"AL\",\"New York\",\"Yankees\",\"1903\",\"2021\"",
        "\"BS1\",\"NA\",\"Boston\",\"Braves\",\"1871\",\"1875\"",
    });

    [Theory]
    [InlineData("MIL", 1990, "AL")]
    [InlineData("MIL", 2000, "NL")]
    [InlineData("NYA", 2025, "AL")] // TEAMABR stops at 2021 for active clubs; treated as still active
    [InlineData("BS1", 1872, "NA")]
    public void Maps_team_and_year_to_league(string team, int year, string league) =>
        Assert.Equal(league, Map.LeagueOf(team, year));

    [Fact]
    public void Unknown_team_returns_null() => Assert.Null(Map.LeagueOf("XYZ", 1950));

    [Fact]
    public void Only_AL_NL_FL_count_as_major_for_this_product()
    {
        Assert.True(LeagueMap.IsIncluded("AL"));
        Assert.True(LeagueMap.IsIncluded("FL"));
        Assert.False(LeagueMap.IsIncluded("NA"));
        Assert.False(LeagueMap.IsIncluded(null));
    }
}
