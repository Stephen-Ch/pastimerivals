using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class ValidatorTests
{
    private static PlayerSeason Season(string id, int year, int pa, int h = 0, int k = 0, int kKnown = -1)
    {
        var s = new PlayerSeason { Id = id, Year = year };
        s.Counts.Add(pa, k, 0, 0, 0, h, 0, 0, 0);
        if (kKnown >= 0) s.Counts.KKnownPa = kKnown;
        s.Games = 1; s.PbpGames = 1;
        return s;
    }

    [Fact]
    public void Clean_data_has_no_red_checks()
    {
        var b = new List<PlayerSeason> { Season("a", 1950, 100, h: 30) };
        var p = new List<PlayerSeason> { Season("p", 1950, 100, h: 30) };
        var v = Validator.Run(b, p, new HashSet<string> { "a", "p" });
        Assert.Empty(v.Red);
    }

    [Fact]
    public void Impossible_counts_are_red()
    {
        var b = new List<PlayerSeason> { Season("a", 1950, 3, h: 5) }; // more hits than PA
        var v = Validator.Run(b, new List<PlayerSeason>(), new HashSet<string> { "a" });
        Assert.Contains(v.Red, r => r.Contains("a 1950"));
    }

    [Fact]
    public void Missing_person_record_is_red()
    {
        var v = Validator.Run(new List<PlayerSeason> { Season("ghost", 1950, 10) }, new List<PlayerSeason>(), new HashSet<string>());
        Assert.Contains(v.Red, r => r.Contains("ghost"));
    }

    [Fact]
    public void Batting_and_pitching_totals_that_disagree_by_more_than_half_a_percent_are_red()
    {
        var b = new List<PlayerSeason> { Season("a", 1950, 1000) };
        var p = new List<PlayerSeason> { Season("p", 1950, 1100) };
        var v = Validator.Run(b, p, new HashSet<string> { "a", "p" });
        Assert.Contains(v.Red, r => r.Contains("1950") && r.Contains("PA"));
    }

    [Fact]
    public void Unknown_strikeouts_are_amber_not_red()
    {
        var b = new List<PlayerSeason> { Season("a", 1905, 100, kKnown: 50) };
        var p = new List<PlayerSeason> { Season("p", 1905, 100) };
        var v = Validator.Run(b, p, new HashSet<string> { "a", "p" });
        Assert.Empty(v.Red);
        Assert.Contains(v.Amber, r => r.Contains("1905"));
    }

    [Fact]
    public void PA_gap_is_amber_when_batters_faced_was_estimated_that_year()
    {
        var b = new List<PlayerSeason> { Season("a", 1903, 1000) };
        var pit = Season("p", 1903, 1011);
        pit.EstimatedGames = 1;
        var v = Validator.Run(b, new List<PlayerSeason> { pit }, new HashSet<string> { "a", "p" });
        Assert.Empty(v.Red);
        Assert.Contains(v.Amber, r => r.Contains("1903") && r.Contains("estimated"));
    }
}
