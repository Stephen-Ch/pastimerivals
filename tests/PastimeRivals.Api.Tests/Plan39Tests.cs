using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 39: the app page is always re-checked; random opening matchups.</summary>
public class Plan39Tests
{
    private static WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "10000");
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IStatsSource, InningStats>();
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<IChallengeStore>(new MemoryChallengeStore());
            });
        });

    [Theory]
    [InlineData("GET", "/")] [InlineData("GET", "/index.html")] [InlineData("GET", "/c/new")] [InlineData("GET", "/c/abcdefghijklmnopqrstuv")]
    [InlineData("HEAD", "/c/abc")] [InlineData("GET", "/x/y")] [InlineData("GET", "/sw.js")] [InlineData("GET", "/art-manifest.json")]
    [InlineData("GET", "/manifest.webmanifest")]
    public async Task App_pages_and_unversioned_files_are_always_rechecked(string method, string path)
    {
        var r = await Factory().CreateClient().SendAsync(new HttpRequestMessage(new HttpMethod(method), path));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.True(r.Headers.CacheControl?.NoCache == true, $"{method} {path}: {r.Headers.CacheControl}");
    }

    [Fact]
    public async Task Versioned_scripts_are_left_alone()
    {
        var c = Factory().CreateClient();
        var html = await c.GetStringAsync("/");
        var script = System.Text.RegularExpressions.Regex.Match(html, "main-[A-Za-z0-9]+\\.js").Value;
        Assert.NotEmpty(script);
        var r = await c.GetAsync("/" + script);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.NotEqual(true, r.Headers.CacheControl?.NoCache);
    }

    [Fact]
    public async Task Random_matchups_are_real_good_seasons_with_names_and_lines_and_no_repeats()
    {
        var pairs = await Factory().CreateClient().GetFromJsonAsync<JsonElement>("/api/matchup/random?n=6");
        Assert.Equal(6, pairs.GetArrayLength());
        var ids = new List<string>();
        foreach (var p in pairs.EnumerateArray())
            foreach (var side in new[] { "pitcher", "batter" })
            {
                var x = p.GetProperty(side);
                ids.Add(x.GetProperty("id").GetString()!);
                Assert.False(string.IsNullOrEmpty(x.GetProperty("name").GetString()));
                Assert.True(x.GetProperty("year").GetInt32() > 1900);
                Assert.Contains(side == "pitcher" ? "batters faced" : " PA", x.GetProperty("line").GetString());
            }
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }
}
