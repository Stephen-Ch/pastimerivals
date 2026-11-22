using Microsoft.Extensions.Configuration;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 76: its own fixture (two or more players per year, plus Negro Leagues rows); FakeStats is left alone.</summary>
public sealed class Plan76Stats : IStatsSource
{
    // pa, bb, single, double, hr (strikeouts known on every PA, a fifth of PA)
    private static SeasonCounts C(int pa, int bb, int single, int dbl, int hr) => new(pa, pa, pa / 5, bb, 0, single, dbl, 0, hr);
    /// <summary>The filler's rates (10% BB, 15% 1B, 5% 2B, 3% HR) scaled to pa: exactly the same points per PA.</summary>
    private static SeasonCounts Avg(int pa) => C(pa, pa / 10, pa * 15 / 100, pa / 20, pa * 3 / 100);
    private static PlayerRow Mlb(string id, int year, SeasonCounts c, string pos = "RF") => new(id, year, c.Pa, 0, 0, c, 'A', "NYA", pos);

    public Task<StatsBundle> LoadAsync()
    {
        var years = new[] { 1927, 1941, 1950, 1951, 1952, 1953, 1960, 1961, 1962, 1963, 1970, 1971 };
        var leagues = new List<LeagueRow>();
        foreach (var y in years)
        {
            leagues.Add(new LeagueRow(y, "AL", "bat", Avg(40000)));
            leagues.Add(new LeagueRow(y, "AL", "pit", Avg(40000)));
        }
        leagues.Add(new LeagueRow(1999, "AL", "bat", Avg(40000)));   // the neutral league (1990-2019)
        leagues.Add(new LeagueRow(1999, "AL", "pit", Avg(40000)));
        leagues.Add(new LeagueRow(1945, "NN2", "bat", Avg(8000)));
        leagues.Add(new LeagueRow(1945, "NN2", "pit", Avg(8000)));

        var bat = new List<PlayerRow>();
        var pit = new List<PlayerRow>();
        foreach (var y in years)
        {
            bat.Add(Mlb("fillb001", y, Avg(20000)));
            pit.Add(Mlb("fillp001", y, Avg(20000), "P"));
        }
        // Best by score (1951) is not the most played (1950); 1952 is better still but under two thirds of 600.
        bat.Add(Mlb("bestb001", 1950, C(600, 50, 80, 20, 10)));
        bat.Add(Mlb("bestb001", 1951, C(450, 70, 90, 30, 30)));
        bat.Add(Mlb("bestb001", 1952, C(380, 80, 90, 40, 40)));
        bat.Add(Mlb("bestb001", 1953, C(250, 60, 60, 20, 30)));
        // Ties: same points per PA as the filler. 1960 (600 PA) beats 1961 (500 PA); 1962 vs 1963 (both 500): the earlier year.
        bat.Add(Mlb("tieb0001", 1960, Avg(600)));
        bat.Add(Mlb("tieb0001", 1961, Avg(500)));
        bat.Add(Mlb("tieb0002", 1962, Avg(500)));
        bat.Add(Mlb("tieb0002", 1963, Avg(500)));
        // Nothing reaches the floor (300): falls back to the most played season.
        bat.Add(Mlb("smalb001", 1970, C(200, 30, 40, 10, 10)));
        bat.Add(Mlb("smalb001", 1971, C(120, 30, 30, 10, 10)));
        // Most played is major league (1950): the huge Negro Leagues season (1945) is another group and never the default.
        bat.Add(new PlayerRow("nglb0001", 1945, 0, 0, 0, C(400, 80, 100, 40, 50), 'A', "HOM", "C", PaNn2: 400));
        bat.Add(Mlb("nglb0001", 1950, C(500, 40, 70, 20, 10)));
        bat.Add(Mlb("nglb0001", 1951, C(400, 50, 70, 20, 20)));
        // Plan 76 B: two legends in the data, listed out of shelf order (Williams first) to test the order; Ruth also has a 1928.
        bat.Add(Mlb("willt103", 1941, C(606, 147, 112, 33, 37)));
        bat.Add(Mlb("ruthb101", 1927, C(691, 137, 95, 29, 60)));
        bat.Add(Mlb("ruthb101", 1941, C(100, 10, 15, 5, 3)));
        // Pitchers: lower is better. 1951 allows less than 1950 (the most played).
        pit.Add(Mlb("pitc0001", 1950, C(800, 90, 140, 50, 30), "P"));
        pit.Add(Mlb("pitc0001", 1951, C(700, 40, 80, 20, 10), "P"));

        var cat = new StatsCatalog(leagues, Array.Empty<PlatoonRow>(), bat, pit, Array.Empty<ExposureRow>());
        var people = new List<PersonRow>
        {
            new("fillb001", "Fill", "Batter", "R", "R", 1920, ""), new("fillp001", "Fill", "Pitcher", "R", "R", 1920, ""),
            new("bestb001", "Best", "Season", "R", "R", 1925, "HOF"), new("tieb0001", "Tie", "One", "R", "R", 1935, ""),
            new("tieb0002", "Tie", "Two", "R", "R", 1935, ""), new("smalb001", "Small", "Sample", "R", "R", 1945, ""),
            new("nglb0001", "Two", "Leagues", "R", "R", 1920, "HOF"), new("ruthb101", "Babe", "Ruth", "L", "L", 1895, "HOF"),
            new("willt103", "Ted", "Williams", "L", "R", 1918, "HOF"), new("pitc0001", "Low", "Allowed", "R", "R", 1925, "HOF"),
        };
        var teams = new List<TeamRow> { new("NYA", "AL", "New York", 1903, 9999), new("HOM", "NN2", "Homestead", 1930, 1950) };
        return Task.FromResult(new StatsBundle(cat, people, teams));
    }
}

public class Plan76Tests
{
    private static HttpClient Make() => new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
    {
        b.UseSetting("RateLimit:PerMinute", "1000");
        b.ConfigureServices(s => { s.AddSingleton<IStatsSource, Plan76Stats>(); s.AddSingleton<IEventSink>(new MemoryEvents()); });
    }).CreateClient();

    private static async Task<JsonElement[]> Seasons(HttpClient c, string id, string role = "bat") =>
        (await c.GetFromJsonAsync<JsonElement>($"/api/players/{id}/seasons?role={role}")).EnumerateArray().ToArray();
    private static int YearWhere(JsonElement[] s, string flag) => s.Single(x => x.GetProperty(flag).GetBoolean()).GetProperty("year").GetInt32();

    [Fact]
    public async Task Batter_best_by_score_differs_from_most_played_and_two_thirds_rule_holds()
    {
        var s = await Seasons(Make(), "bestb001");
        Assert.Equal(1950, YearWhere(s, "isDefault"));   // most played, unchanged meaning
        Assert.Equal(1951, YearWhere(s, "isBest"));      // 1952 scores higher but has 380 < 400 PA
        Assert.All(s, x => Assert.False(x.GetProperty("bestFallback").GetBoolean()));
    }

    [Fact]
    public async Task Pitcher_lowest_score_wins()
    {
        var s = await Seasons(Make(), "pitc0001", "pit");
        Assert.Equal(1950, YearWhere(s, "isDefault"));
        Assert.Equal(1951, YearWhere(s, "isBest"));
    }

    [Fact]
    public async Task Negro_Leagues_season_is_not_in_a_major_league_players_group()
    {
        var s = await Seasons(Make(), "nglb0001");
        Assert.Equal(1950, YearWhere(s, "isDefault"));
        Assert.Equal(1951, YearWhere(s, "isBest"));
    }

    [Fact]
    public async Task Nothing_qualifies_falls_back_to_most_played_marked_as_fallback()
    {
        var s = await Seasons(Make(), "smalb001");
        Assert.Equal(1970, YearWhere(s, "isDefault"));
        Assert.Equal(1970, YearWhere(s, "isBest"));
        Assert.True(s.Single(x => x.GetProperty("year").GetInt32() == 1970).GetProperty("bestFallback").GetBoolean());
    }

    [Fact]
    public async Task Featured_lists_shelf_pairs_in_order_and_skips_missing_ones()
    {
        var c = Make();
        var bat = (await c.GetFromJsonAsync<JsonElement>("/api/players/featured?role=bat")).EnumerateArray().ToArray();
        Assert.Equal(new[] { "ruthb101", "willt103" }, bat.Select(x => x.GetProperty("id").GetString()));   // shelf order, not data order
        var ruth = bat[0];
        Assert.Equal(1927, ruth.GetProperty("year").GetInt32());
        Assert.Equal("Babe Ruth", ruth.GetProperty("name").GetString());
        Assert.Equal("1927-1941", ruth.GetProperty("years").GetString());
        Assert.True(ruth.GetProperty("hof").GetBoolean());
        Assert.Equal("L", ruth.GetProperty("bats").GetString());
        Assert.Contains("60 HR", ruth.GetProperty("line").GetString());
        Assert.True(ruth.TryGetProperty("bio", out _));
        var pit = (await c.GetFromJsonAsync<JsonElement>("/api/players/featured?role=pit")).EnumerateArray().ToArray();
        Assert.Empty(pit);   // no shelf pitcher in this fixture
    }

    [Fact]
    public async Task Featured_pick_is_an_allowed_event()
    {
        var events = new MemoryEvents();
        var c = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "1000");
            b.ConfigureServices(s => { s.AddSingleton<IStatsSource, Plan76Stats>(); s.AddSingleton<IEventSink>(events); });
        }).CreateClient();
        var r = await c.PostAsJsonAsync("/api/events", new { name = "featured_pick", session = "s1", source = "bat" });
        Assert.Equal(System.Net.HttpStatusCode.NoContent, r.StatusCode);
        Assert.Contains(events.Events, e => e.Name == "featured_pick");
    }

    [Fact]
    public async Task Ties_go_to_more_plate_appearances_then_the_earlier_year()
    {
        var c = Make();
        Assert.Equal(1960, YearWhere(await Seasons(c, "tieb0001"), "isBest"));
        Assert.Equal(1962, YearWhere(await Seasons(c, "tieb0002"), "isBest"));
    }
}

/// <summary>Plan 76 C on the real data (data/outall). Runs only when PR_DATA points at it (cloud workspace).</summary>
public class Plan76RealDataTests
{
    private static readonly string? Dir = Environment.GetEnvironmentVariable("PR_DATA");
    private static PlayService? _play;
    private static PlayService Play() => _play ??= new PlayService(new CsvStatsSource(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Stats:CsvDir"] = Dir }).Build()));

    [Fact]
    public async Task All_16_legend_pairs_are_in_the_data_in_order()
    {
        if (Dir is null) return;
        var bat = await Play().FeaturedAsync("bat");
        var pit = await Play().FeaturedAsync("pit");
        Assert.Equal(PlayService.FeaturedBatters.Select(x => $"{x.Id} {x.Year}"), bat.Select(x => $"{x.Id} {x.Year}"));
        Assert.Equal(PlayService.FeaturedPitchers.Select(x => $"{x.Id} {x.Year}"), pit.Select(x => $"{x.Id} {x.Year}"));
        Assert.False(bat.Single(x => x.Id == "bondb001").Hof);   // Bonds: no Hall of Fame badge
        Assert.Equal(15, bat.Concat(pit).Count(x => x.Hof));
    }

    [Theory]
    [InlineData("ruthb101", "bat", 1920)] [InlineData("willt103", "bat", 1941)] [InlineData("maysw101", "bat", 1965)] [InlineData("aaroh101", "bat", 1971)]
    [InlineData("bondb001", "bat", 2001)] [InlineData("schmm001", "bat", 1980)] [InlineData("robij103", "bat", 1952)]
    [InlineData("martp001", "pit", 2000)] [InlineData("koufs101", "pit", 1963)] [InlineData("ryann001", "pit", 1977)] [InlineData("kersc001", "pit", 2015)]
    [InlineData("paigs101", "pit", 1952)]
    public async Task Best_season_matches_the_plan_review_numbers(string id, string role, int year)
    {
        if (Dir is null) return;
        var s = await Play().SeasonsAsync(id, role);
        Assert.NotNull(s);
        Assert.Equal(year, s!.Single(x => x.IsBest).Year);
        Assert.False(s.Single(x => x.IsBest).BestFallback);
    }
}
