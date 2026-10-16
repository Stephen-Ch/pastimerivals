using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Tests;

public sealed class FakeStats : IStatsSource
{
    private static SeasonCounts C(int pa, int k, int bb, int hr, int single) => new(pa, pa, k, bb, 5, single, 30, 3, hr);

    public Task<StatsBundle> LoadAsync()
    {
        var leagues = new List<LeagueRow>();
        foreach (var y in new[] { 1927, 1999, 2000 })
            foreach (var lg in new[] { "AL", "NL" })
            {
                leagues.Add(new LeagueRow(y, lg, "bat", C(40000, 6000, 3500, 1000, 6000)));
                leagues.Add(new LeagueRow(y, lg, "pit", C(44000, 6800, 3800, 1050, 6400)));
            }
        var cat = new StatsCatalog(leagues, Array.Empty<PlatoonRow>(),
            new[]
            {
                new PlayerRow("ruthb101", 1927, 691, 0, 0, C(691, 89, 137, 60, 95), 'A'),
                new PlayerRow("ruthb101", 1999, 10, 0, 0, C(10, 2, 1, 0, 2), 'A'),
                new PlayerRow("rodra001", 2000, 0, 300, 0, C(300, 60, 30, 10, 50), 'A'),
            },
            new[] { new PlayerRow("martp001", 1999, 835, 0, 0, C(835, 313, 37, 9, 113), 'A') },
            Array.Empty<ExposureRow>());
        var people = new List<PersonRow>
        {
            new("ruthb101", "Babe", "Ruth", "L", "L", 1895, "HOF"),
            new("rodra001", "Alex", "Rodriguez", "R", "R", 1975, ""),
            new("martp001", "Pedro", "Martinez", "R", "R", 1971, "HOF"),
        };
        return Task.FromResult(new StatsBundle(cat, people));
    }
}

public sealed class MemoryEvents : IEventSink
{
    public List<(string Name, string Session)> Events { get; } = new();
    public Task WriteAsync(string name, string session) { Events.Add((name, session)); return Task.CompletedTask; }
}

public class PlayApiTests
{
    private static (HttpClient Client, MemoryEvents Events) Make(int permitPerMinute = 1000)
    {
        var events = new MemoryEvents();
        var f = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", permitPerMinute.ToString());
            b.ConfigureServices(s =>
            {
                s.AddSingleton<IStatsSource, FakeStats>();
                s.AddSingleton<IEventSink>(events);
            });
        });
        return (f.CreateClient(), events);
    }

    [Fact]
    public async Task Search_matches_first_or_last_name_prefix()
    {
        var (c, _) = Make();
        var r = await c.GetFromJsonAsync<JsonElement>("/api/players/search?q=ru&role=bat");
        Assert.Contains(r.EnumerateArray(), p => p.GetProperty("id").GetString() == "ruthb101");
        var byFirst = await c.GetFromJsonAsync<JsonElement>("/api/players/search?q=alex&role=bat");
        Assert.Equal("rodra001", byFirst[0].GetProperty("id").GetString());
        var none = await c.GetFromJsonAsync<JsonElement>("/api/players/search?q=uth&role=bat");
        Assert.Equal(0, none.GetArrayLength());
    }

    [Fact]
    public async Task Search_by_role_only_returns_players_with_that_role()
    {
        var (c, _) = Make();
        var pit = await c.GetFromJsonAsync<JsonElement>("/api/players/search?q=pedro&role=pit");
        Assert.Equal(1, pit.GetArrayLength());
        var bat = await c.GetFromJsonAsync<JsonElement>("/api/players/search?q=pedro&role=bat");
        Assert.Equal(0, bat.GetArrayLength());
    }

    [Fact]
    public async Task Seasons_list_marks_the_biggest_season_as_default()
    {
        var (c, _) = Make();
        var s = await c.GetFromJsonAsync<JsonElement>("/api/players/ruthb101/seasons?role=bat");
        Assert.Equal(2, s.GetArrayLength());
        var def = s.EnumerateArray().Single(x => x.GetProperty("isDefault").GetBoolean());
        Assert.Equal(1927, def.GetProperty("year").GetInt32());
        Assert.Contains("60 HR", def.GetProperty("line").GetString());
    }

    [Fact]
    public async Task Matchup_returns_probabilities_that_sum_to_one_and_explanation_steps()
    {
        var (c, _) = Make();
        var m = await c.GetFromJsonAsync<JsonElement>("/api/matchup?b=ruthb101&by=1927&p=martp001&py=1999");
        var sum = m.GetProperty("probabilities").EnumerateObject().Sum(p => p.Value.GetDouble());
        Assert.Equal(1.0, sum, 6);
        Assert.Equal(8, m.GetProperty("steps").GetArrayLength());
        Assert.False(m.GetProperty("sameHand").GetBoolean()); // lefty batter vs righty pitcher
        Assert.Equal(EngineInfo.Version, m.GetProperty("engineVersion").GetString());
    }

    [Fact]
    public async Task Unknown_player_season_is_404()
    {
        var (c, _) = Make();
        var r = await c.GetAsync("/api/matchup?b=ruthb101&by=1950&p=martp001&py=1999");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
    }

    [Fact]
    public async Task Pitch_with_the_same_seed_replays_the_same_outcome()
    {
        var (c, _) = Make();
        var body = new { b = "ruthb101", by = 1927, p = "martp001", py = 1999 };
        var first = await (await c.PostAsJsonAsync("/api/pitch", body)).Content.ReadFromJsonAsync<JsonElement>();
        var seed = first.GetProperty("seed").GetString();
        var again = await (await c.PostAsJsonAsync("/api/pitch", new { body.b, body.by, body.p, body.py, seed }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(first.GetProperty("outcome").GetString(), again.GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task Sims_are_capped_at_1000_and_counts_add_up()
    {
        var (c, _) = Make();
        var r = await (await c.PostAsJsonAsync("/api/sims", new { b = "ruthb101", by = 1927, p = "martp001", py = 1999, n = 5000 }))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1000, r.GetProperty("n").GetInt32());
        Assert.Equal(1000, r.GetProperty("counts").EnumerateObject().Sum(x => x.Value.GetInt32()));
    }

    [Fact]
    public async Task Events_accept_known_names_only()
    {
        var (c, events) = Make();
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsJsonAsync("/api/events", new { name = "pitch", session = "abc" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/events", new { name = "hack", session = "abc" })).StatusCode);
        Assert.Single(events.Events);
    }

    [Fact]
    public async Task Too_many_requests_from_one_address_get_429()
    {
        var (c, _) = Make(permitPerMinute: 2);
        await c.GetAsync("/api/players/search?q=ru&role=bat");
        await c.GetAsync("/api/players/search?q=ru&role=bat");
        var third = await c.GetAsync("/api/players/search?q=ru&role=bat");
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
    }
}
