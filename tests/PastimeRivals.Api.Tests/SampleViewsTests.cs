using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>
/// Plan 38 stage C tool, not a check: with PR_DATA (real stats) and PR_VIEWS_OUT set, plays computer inning games through
/// the API and saves real game views for the app's gates and screen tests (a 1-2-3 game, a batted-around half, a tie, and more).
/// </summary>
public class SampleViewsTests
{
    [Fact]
    public async Task Save_sample_inning_views()
    {
        var data = Environment.GetEnvironmentVariable("PR_DATA");
        var outDir = Environment.GetEnvironmentVariable("PR_VIEWS_OUT");
        if (data is null || outDir is null) return;
        Directory.CreateDirectory(outDir);
        var f = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "100000");
            b.UseSetting("Stats:CsvDir", data);
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IChallengeStore>(new MemoryChallengeStore());
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, TestIpFilter>();
            });
        });
        var want = new Dictionary<string, Func<JsonElement, bool>>
        {
            ["one-two-three"] = g => g.GetProperty("atBats").GetArrayLength() == 6,
            ["batted-around"] = g => g.GetProperty("atBats").EnumerateArray().GroupBy(a => (a.GetProperty("inning").GetInt32(), a.GetProperty("battingSide").GetInt32())).Any(x => x.Count() >= 13),
            ["extra-tie"] = g => g.GetProperty("winner").GetInt32() == -1,
            ["walk-off"] = g => g.GetProperty("innings").GetInt32() > 1 && g.GetProperty("winner").GetInt32() == 0,
            ["double-play"] = g => g.GetProperty("atBats").EnumerateArray().Any(a => a.GetProperty("doublePlay").GetBoolean()),
            ["error"] = g => g.GetProperty("atBats").EnumerateArray().Any(a => a.GetProperty("outType").ValueKind == JsonValueKind.String && a.GetProperty("outType").GetString() == "error"),
            ["no-dh"] = g => g.GetProperty("lineupSources")[0][9].GetString() == "pitcher",
        };
        var found = new Dictionary<string, string>();
        HttpClient? c = null;
        for (var i = 0; i < 1500 && found.Count < want.Count; i++)
        {
            if (i % 40 == 0)
            {
                c = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
                c.DefaultRequestHeaders.Add("X-Test-Ip", $"10.0.{i / 40 / 250}.{i / 40 % 250 + 1}");
                var me = await c.GetAsync("/api/me");
                var xsrf = me.Headers.GetValues("Set-Cookie").First(h => h.StartsWith("XSRF-TOKEN=")).Split(';')[0]["XSRF-TOKEN=".Length..];
                c.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf));
            }
            var q = await c!.GetFromJsonAsync<JsonElement>("/api/challenges/quickpick?mode=inning");
            var picks = q.GetProperty("slots").EnumerateArray().Select(s => new { slot = s.GetProperty("slot").GetInt32(), choices = s.GetProperty("choices").EnumerateArray().Select(x => new { id = x.GetProperty("id").GetString(), year = x.GetProperty("year").GetInt32() }).ToArray() }).ToArray();
            var r = await c.PostAsJsonAsync("/api/challenges/computer", new { picks, mode = "inning", level = 1 + i % 4, nickname = (string?)null });
            if (!r.IsSuccessStatusCode) continue;
            var raw = await r.Content.ReadAsStringAsync();
            var view = JsonDocument.Parse(raw).RootElement.GetProperty("view");
            var g = view.GetProperty("game");
            foreach (var (name, test) in want)
                if (!found.ContainsKey(name) && test(g)) { found[name] = view.GetRawText(); File.WriteAllText(Path.Combine(outDir, name + ".json"), view.GetRawText()); }
            if (i < 20) File.WriteAllText(Path.Combine(outDir, $"sample-{i:00}.json"), view.GetRawText());
        }
        File.WriteAllText(Path.Combine(outDir, "found.txt"), string.Join("\n", want.Keys.Select(k => $"{k}: {(found.ContainsKey(k) ? "yes" : "NO")}")));
    }
}
