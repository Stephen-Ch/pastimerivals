using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Stats;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>
/// Plan 47 B4 tool, not a check: with PR_DATA (data/outall, the merged MLB + Negro Leagues data) and PR_POOLS_OUT set,
/// writes pools.csv from the API's own pool code (RandomPool levels 1-4 for pitchers and batters, and both Top50 lists).
/// Normal test runs write nothing. Columns: list,level,pitchers,era,id,year,era_size,eras
/// (era_size = seasons in that era's pool, eras = live eras in the pool; draw weight of a season = 1 / (eras * era_size)).
/// </summary>
public class PoolsExportTests
{
    [Fact]
    public async Task Export_pools()
    {
        var data = Environment.GetEnvironmentVariable("PR_DATA");
        var outDir = Environment.GetEnvironmentVariable("PR_POOLS_OUT");
        if (data is null || outDir is null) return;
        Directory.CreateDirectory(outDir);
        using var f = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.UseSetting("Stats:CsvDir", data));
        var oracle = await f.Services.GetRequiredService<PlayService>().OracleAsync();
        var lines = new List<string> { "list,level,pitchers,era,id,year,era_size,eras" };
        foreach (var pit in new[] { true, false })
        {
            for (var level = Challenges.Rules.MinLevel; level <= Challenges.Rules.MaxLevel; level++)
            {
                var eras = oracle.RandomPool(pit, level);
                var live = eras.Count(e => e.Count > 0);
                for (var e = 0; e < eras.Length; e++)
                    foreach (var p in eras[e]) lines.Add($"level,{level},{(pit ? 1 : 0)},{e},{p.Id},{p.Year},{eras[e].Count},{live}");
            }
            foreach (var p in oracle.Top50(pit)) lines.Add($"top50,0,{(pit ? 1 : 0)},-1,{p.Id},{p.Year},0,0");
        }
        File.WriteAllLines(Path.Combine(outDir, "pools.csv"), lines);
        Assert.True(lines.Count > 100);
    }
}
