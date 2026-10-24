using Microsoft.Extensions.Configuration;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;
using Xunit;
using Xunit.Abstractions;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 38 checks on the real pipeline output. Runs only when PR_DATA points at data/out (cloud workspace).</summary>
public class RealDataTests(ITestOutputHelper output)
{
    private static readonly string? Dir = Environment.GetEnvironmentVariable("PR_DATA");
    private static PlayService? _play;
    private static PlayService Play() => _play ??= new PlayService(new CsvStatsSource(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Stats:CsvDir"] = Dir }).Build()));

    /// <summary>Column index by header name (plan 41 added pa_nn2/pa_nal columns, so positions moved).</summary>
    private static int Col(string file, string name) => Array.IndexOf(File.ReadLines(Path.Combine(Dir!, file)).First().Split(','), name);

    private static (double Avg, double Obp, double Slg) Line(Rates r)
    {
        double P(Outcome o) => r[o];
        var h = P(Outcome.Single) + P(Outcome.Double) + P(Outcome.Triple) + P(Outcome.Hr);
        var ab = 1 - P(Outcome.Bb) - P(Outcome.Hbp);
        return (h / ab, h + P(Outcome.Bb) + P(Outcome.Hbp), (P(Outcome.Single) + 2 * P(Outcome.Double) + 3 * P(Outcome.Triple) + 4 * P(Outcome.Hr)) / ab);
    }

    [Theory]
    [InlineData(1900, 0.410)] [InlineData(1920, 0.475)] [InlineData(1950, 0.406)] [InlineData(1960, 0.345)] [InlineData(1980, 0.326)] [InlineData(2000, 0.324)]
    // The engine plays every matchup in one neutral environment (1990-2019 MLB), so a pitcher's bat is judged against his
    // own league and then placed there.
    public async Task Pitchers_bat_like_pitchers_of_their_decade(int decade, double dataOps)
    {
        if (Dir is null) return;
        var oracle = await Play().OracleAsync();
        // The 30 heaviest-workload pitchers of the decade, each batting against the others.
        var paCol = Col("pitchers.csv", "pa");
        var csv = File.ReadLines(Path.Combine(Dir, "pitchers.csv")).Skip(1).Select(l => l.Split(','))
            .Where(f => int.Parse(f[1]) / 10 * 10 == decade).OrderByDescending(f => int.Parse(f[paCol])).Take(30)
            .Select(f => new PickRef(f[0], int.Parse(f[1]))).ToList();
        double avg = 0, obp = 0, slg = 0; var n = 0;
        foreach (var b in csv)
            foreach (var p in csv.Where(x => x.Id != b.Id).Take(10))
            {
                var r = oracle.PitcherAtBat(b, p);
                Assert.NotNull(r);
                var l = Line(r!); avg += l.Avg; obp += l.Obp; slg += l.Slg; n++;
            }
        avg /= n; obp /= n; slg /= n;
        output.WriteLine($"{decade}s pitchers batting: {avg:F3} / {obp:F3} / {slg:F3}, OPS {obp + slg:F3} (decade data in its own era {dataOps:F3})");
        // These workhorses mostly bat with their own real lines (30+ PA), so the band is "clearly a pitcher": far below a
        // position player's OPS of about .730 in the neutral era.
        Assert.InRange(obp + slg, 0.28, 0.48);
        Assert.InRange(obp, 0.12, 0.23);
    }

    [Fact]
    public async Task An_AL_pitcher_with_no_batting_season_still_bats()
    {
        if (Dir is null) return;
        var oracle = await Play().OracleAsync();
        var al1985 = File.ReadLines(Path.Combine(Dir, "pitchers.csv")).Skip(1).Select(l => l.Split(','))
            .Where(f => f[1] == "1985" && int.Parse(f[3]) > 400 && int.Parse(f[4]) == 0).Select(f => new PickRef(f[0], 1985)).ToList();
        var bPa = Col("batters.csv", "pa");
        var batters = File.ReadLines(Path.Combine(Dir, "batters.csv")).Skip(1).Select(l => l.Split(',')).Where(f => f[1] == "1985" && int.Parse(f[bPa]) > 0).Select(f => f[0]).ToHashSet();
        var none = al1985.First(p => !batters.Contains(p.Id));
        var r = oracle.PitcherAtBat(none, al1985.First(p => p.Id != none.Id));
        Assert.NotNull(r);
        output.WriteLine($"{none.Id} 1985 batting: {Line(r!).Avg:F3} AVG");
        Assert.InRange(Line(r!).Avg, 0.08, 0.20);
    }
}
