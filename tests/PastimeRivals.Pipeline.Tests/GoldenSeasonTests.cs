using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

/// <summary>
/// Hand-checked seasons against published official totals. Retrosheet's own counts can differ from
/// official totals by a play or two, so a tolerance of 2 is allowed. Runs only where the raw data has
/// been downloaded (Stephen's PC); in CI the data folder is absent and these return early.
/// </summary>
public class GoldenSeasonTests
{
    private static readonly string Raw = FindRaw();

    private static string FindRaw()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !Directory.Exists(Path.Combine(dir, "data", "raw", "zips"))) dir = Path.GetDirectoryName(dir);
        return dir == null ? "" : Path.Combine(dir, "data", "raw");
    }

    private static BuildResult? Year(int y)
    {
        if (Raw == "" || !File.Exists(Path.Combine(Raw, "zips", $"{y}csvs.zip"))) return null;
        var src = new RetrosheetSource(Raw);
        var map = LeagueMap.FromTeamAbr(File.ReadLines(Path.Combine(Raw, "TEAMABR.TXT")));
        return Aggregator.Build(src.Batting(y), src.Pitching(y), map);
    }

    private static void Near(int expected, int actual, string what) =>
        Assert.True(Math.Abs(expected - actual) <= 2, $"{what}: expected {expected}, got {actual}");

    [Theory]
    // id, year, PA, H, 2B, 3B, HR, BB, K, HBP (official totals)
    [InlineData("ruthb101", 1927, 691, 192, 29, 8, 60, 137, 89, 0)]
    [InlineData("gehrl101", 1927, 717, 218, 52, 18, 47, 109, 84, 3)]
    [InlineData("willt103", 1941, 606, 185, 33, 3, 37, 147, 27, 3)]
    [InlineData("mantm101", 1956, 652, 188, 22, 5, 52, 112, 99, 2)]
    [InlineData("bondb001", 2001, 664, 156, 32, 2, 73, 177, 93, 9)]
    [InlineData("ohtas001", 2023, 599, 151, 26, 8, 44, 91, 143, 3)]
    public void Batter_seasons_match_official_totals(string id, int year, int pa, int h, int d, int t, int hr, int bb, int k, int hbp)
    {
        var r = Year(year);
        if (r == null) return;
        var s = r.Batters.Single(b => b.Id == id).Counts;
        Near(pa, s.Pa, "PA"); Near(h, s.H, "H"); Near(d, s.Double, "2B"); Near(t, s.Triple, "3B");
        Near(hr, s.Hr, "HR"); Near(bb, s.Bb, "BB"); Near(k, s.K, "K"); Near(hbp, s.Hbp, "HBP");
    }

    [Theory]
    // id, year, BF, H, HR, BB, K, HBP (official totals)
    [InlineData("martp001", 1999, 835, 160, 9, 37, 313, 9)]
    [InlineData("koufs101", 1965, 1297, 216, 26, 71, 382, 5)]
    [InlineData("gibsb101", 1968, 1161, 198, 11, 62, 268, 7)]
    [InlineData("johnw102", 1913, 1280, 232, 9, 38, 243, 8)]
    public void Pitcher_seasons_match_official_totals(string id, int year, int bf, int h, int hr, int bb, int k, int hbp)
    {
        var r = Year(year);
        if (r == null) return;
        var s = r.Pitchers.Single(p => p.Id == id).Counts;
        Near(bf, s.Pa, "BF"); Near(h, s.H, "H"); Near(hr, s.Hr, "HR"); Near(bb, s.Bb, "BB"); Near(k, s.K, "K"); Near(hbp, s.Hbp, "HBP");
    }
}
