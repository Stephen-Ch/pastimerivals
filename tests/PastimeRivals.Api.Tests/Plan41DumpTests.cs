using Microsoft.Extensions.Configuration;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;
using Xunit;
using Xunit.Abstractions;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 41 expert acceptance: prints neutral-league lines (vs a league-average pitcher/batter). Runs only with PR_NGL_DUMP set.</summary>
public class Plan41DumpTests(ITestOutputHelper output)
{
    [Fact]
    public async Task Dump()
    {
        var dir = Environment.GetEnvironmentVariable("PR_NGL_DUMP");
        if (dir is null) return;
        var b = await new CsvStatsSource(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Stats:CsvDir"] = dir }).Build()).LoadAsync();
        var cat = b.Catalog; var neutral = cat.Neutral(); var np = cat.PlatoonOver();
        var avg = new PlayerInput(SeasonCounts.Empty, neutral, null);
        string L(Rates r)
        {
            double h = r[Outcome.Single] + r[Outcome.Double] + r[Outcome.Triple] + r[Outcome.Hr], ab = 1 - r[Outcome.Bb] - r[Outcome.Hbp];
            var slg = (r[Outcome.Single] + 2 * r[Outcome.Double] + 3 * r[Outcome.Triple] + 4 * r[Outcome.Hr]) / ab;
            return $"AVG {h / ab:F3} OBP {h + r[Outcome.Bb] + r[Outcome.Hbp]:F3} SLG {slg:F3} HR {r[Outcome.Hr]:P1} BB {r[Outcome.Bb]:P1} K {r[Outcome.K]:P1}";
        }
        foreach (var (id, y) in new[] { ("gibsj101", 1936), ("gibsj101", 1943), ("leonb101", 1941), ("charo101", 1933), ("irvim101", 1941), ("campr102", 1945), ("dobyl101", 1946), ("eastl101", 1948), ("willc106", 1933), ("bellj103", 1933), ("ruthb101", 1927), ("willt103", 1941), ("dimaj101", 1941) })
            if (cat.Batter(id, y) is { } x) output.WriteLine($"BAT {id} {y} PA {x.Row.Counts.Pa}: {L(Matchup.Compute(x.Input, avg, neutral, np, EngineOptions.Default).Probabilities)}");
            else output.WriteLine($"BAT {id} {y}: none");
        var paige = cat.Pitchers.Where(r => r.Id == "paigs101" && r.IsNgl).Select(r => r.Year).ToList();
        foreach (var (id, y) in paige.Select(y => ("paigs101", y)).Concat(new[] { ("browr103", 1940), ("browr103", 1935), ("smitj103", 1941), ("fellb101", 1946), ("grovl101", 1931) }))
            if (cat.Pitcher(id, y) is { } x) output.WriteLine($"PIT {id} {y} BF {x.Row.Counts.Pa}: {L(Matchup.Compute(avg, x.Input, neutral, np, EngineOptions.Default).Probabilities)}");
        output.WriteLine($"NEUTRAL: {L(neutral)}");
    }
}
