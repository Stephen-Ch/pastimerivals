using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>
/// Plan 38 stage B test data: "a" players are 2000 AL (DH on), "n" players 1965 NL (no DH). Pitchers np01-np04 also bat
/// (np01 with 40 plate appearances listed at P; the others never batted). Enough workload for the computer's pools.
/// </summary>
public sealed class InningStats : IStatsSource
{
    private static SeasonCounts C(int pa, int k, int bb, int hr, int single) => new(pa, pa, k, bb, 5, single, 30, 3, hr);

    public Task<StatsBundle> LoadAsync()
    {
        var leagues = new List<LeagueRow>();
        foreach (var (y, lg) in new[] { (2000, "AL"), (2000, "NL"), (1965, "NL"), (1965, "AL") })
        {
            leagues.Add(new LeagueRow(y, lg, "bat", C(40000, 6000, 3500, 1000, 6000)));
            leagues.Add(new LeagueRow(y, lg, "pit", C(44000, 6800, 3800, 1050, 6400)));
        }
        var bats = new List<PlayerRow>();
        for (var i = 1; i <= 24; i++) bats.Add(new PlayerRow($"ab{i:00}", 2000, 500 + i, 0, 0, C(500 + i, 90, 50, 10 + i, 90), 'A', "NYA", "RF"));
        for (var i = 1; i <= 24; i++) bats.Add(new PlayerRow($"nb{i:00}", 1965, 0, 500 + i, 0, C(500 + i, 90, 50, 10 + i, 90), 'A', "NYN", "RF"));
        bats.Add(new PlayerRow("np01", 1965, 0, 40, 0, C(40, 15, 1, 0, 4), 'A', "NYN", "P"));
        var pits = new List<PlayerRow>();
        for (var i = 1; i <= 6; i++) pits.Add(new PlayerRow($"ap{i:00}", 2000, 800, 0, 0, C(800, 200, 50, 15 + i, 120), 'A', "BOS", "P"));
        for (var i = 1; i <= 6; i++) pits.Add(new PlayerRow($"np{i:00}", 1965, 0, 800, 0, C(800, 200, 50, 15 + i, 120), 'A', "NYN", "P"));
        var cat = new StatsCatalog(leagues, Array.Empty<PlatoonRow>(), bats, pits, Array.Empty<ExposureRow>());
        var people = bats.Select(b => b.Id).Concat(pits.Select(p => p.Id)).Distinct().Select(id => new PersonRow(id, "First", id, "R", "R", 1970, "")).ToList();
        return Task.FromResult(new StatsBundle(cat, people, new List<TeamRow>()));
    }
}

/// <summary>Plan 38 stage B: inning games through the API (memory store; InningSqlTests reruns them on SQL Server).</summary>
public class InningApiTests
{
    protected virtual IChallengeStore NewStore() => new MemoryChallengeStore();

    private static WebApplicationFactory<Program> Factory(IChallengeStore store) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "10000");
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IStatsSource, InningStats>();
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<IChallengeStore>(store);
                s.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, TestIpFilter>();
            });
        });

    private static async Task<HttpClient> Browser(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var me = await c.GetAsync("/api/me");
        var xsrf = me.Headers.GetValues("Set-Cookie").First(h => h.StartsWith("XSRF-TOKEN=")).Split(';')[0]["XSRF-TOKEN=".Length..];
        c.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf));
        return c;
    }

    /// <summary>An inning team: pitcher then batters, each with optional backups.</summary>
    private static object Team(string pitcher, int pitcherYear, IEnumerable<(string Id, int Year)> batters, string? mode = "inning", Dictionary<int, string[]>? backups = null)
    {
        var slots = new List<object> { new { slot = 0, choices = new[] { new { id = pitcher, year = pitcherYear } } } };
        var k = 1;
        foreach (var (id, y) in batters)
        {
            var list = new List<object> { new { id, year = y } };
            if (backups?.GetValueOrDefault(k) is { } bs) list.AddRange(bs.Select(b => (object)new { id = b, year = y }));
            slots.Add(new { slot = k++, choices = list });
        }
        return mode is null ? new { picks = slots } : new { picks = slots, mode };
    }

    private static IEnumerable<(string, int)> Al(int from, int n) => Enumerable.Range(from, n).Select(i => ($"ab{i:00}", 2000));
    private static IEnumerable<(string, int)> Nl(int from, int n) => Enumerable.Range(from, n).Select(i => ($"nb{i:00}", 1965));
    private static object OldApp(string p, string b1, string b2, string b3, int y) => new
    {
        picks = new object[]
        {
            new { slot = 0, choices = new[] { new { id = p, year = y } } }, new { slot = 1, choices = new[] { new { id = b1, year = y } } },
            new { slot = 2, choices = new[] { new { id = b2, year = y } } }, new { slot = 3, choices = new[] { new { id = b3, year = y } } },
        },
    };

    private static async Task<string> Create(HttpClient c, object body)
    {
        var r = await c.PostAsJsonAsync("/api/challenges", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
    }

    private static void CheckGame(JsonElement view, int batters)
    {
        Assert.Equal("inning", view.GetProperty("mode").GetString());
        var game = view.GetProperty("game");
        var totals = game.GetProperty("totals").EnumerateArray().Select(x => x.GetInt32()).ToArray();
        var line = game.GetProperty("lineScore").EnumerateArray().Select(s => s.EnumerateArray().Sum(x => x.GetInt32())).ToArray();
        Assert.Equal(totals, line);
        var abs = game.GetProperty("atBats").EnumerateArray().ToList();
        Assert.Equal(totals.Sum(), abs.Sum(a => a.GetProperty("points").GetInt32()));
        Assert.All(abs, a =>
        {
            Assert.Equal(a.GetProperty("scored").GetArrayLength(), a.GetProperty("points").GetInt32());
            Assert.Equal(3, a.GetProperty("basesBefore").GetArrayLength());
            Assert.Equal(a.GetProperty("inning").GetInt32() - 1, a.GetProperty("round").GetInt32());
        });
        var lineups = game.GetProperty("lineups").EnumerateArray().ToList();
        Assert.All(lineups, l => Assert.Equal(10, l.GetArrayLength()));
        Assert.Equal(2, game.GetProperty("lineupSources").GetArrayLength());
        Assert.Equal(batters, view.GetProperty("era").GetProperty("batters").GetInt32());
    }

    [Fact]
    public async Task Friends_play_an_inning_with_the_DH_and_both_see_runs_and_the_line_score()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var code = await Create(creator, Team("ap01", 2000, Al(1, 9)));
        var open = await friend.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("inning", open.GetProperty("mode").GetString());
        Assert.True(open.GetProperty("era").GetProperty("dh").GetBoolean());
        Assert.Equal(9, open.GetProperty("era").GetProperty("batters").GetInt32());
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(10, 9)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var a = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        CheckGame(a, 9);
        Assert.Equal(3, a.GetProperty("deco").GetInt32());
        var b = await creator.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal(a.GetProperty("game").GetProperty("atBats").GetRawText(), b.GetProperty("game").GetProperty("atBats").GetRawText());
        var mine = await creator.GetFromJsonAsync<JsonElement>("/api/challenges/mine");
        Assert.Equal("inning", mine[0].GetProperty("mode").GetString());
    }

    [Fact]
    public async Task An_old_app_on_an_inning_link_is_told_to_refresh_and_a_missing_mode_makes_a_classic_game()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var code = await Create(creator, Team("ap01", 2000, Al(1, 9)));
        var old = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", OldApp("ap02", "ab10", "ab11", "ab12", 2000));
        Assert.Equal(HttpStatusCode.Conflict, old.StatusCode);
        Assert.Equal("update", (await old.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var wrongMode = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(10, 9), mode: "classic"));
        Assert.Equal(HttpStatusCode.Conflict, wrongMode.StatusCode);
        // A new app on a classic link sends "classic"; an inning team there is told to refresh too.
        var classic = await Create(creator, OldApp("ap01", "ab01", "ab02", "ab03", 2000));
        var cv = await friend.GetFromJsonAsync<JsonElement>($"/api/challenges/{classic}");
        Assert.Equal("classic", cv.GetProperty("mode").GetString());
        Assert.Equal(JsonValueKind.Null, cv.GetProperty("era").ValueKind);
        Assert.Equal(HttpStatusCode.Conflict, (await friend.PostAsJsonAsync($"/api/challenges/{classic}/lock", Team("ap02", 2000, Al(10, 9)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await creator.PostAsJsonAsync("/api/challenges", Team("ap01", 2000, Al(1, 9), mode: "marathon"))).StatusCode);
        var ok = await friend.PostAsJsonAsync($"/api/challenges/{classic}/lock", OldApp("ap02", "ab10", "ab11", "ab12", 2000));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(7, (await ok.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view").GetProperty("game").GetProperty("lineups")[0].GetArrayLength() + 3);
    }

    [Fact]
    public async Task Lineups_must_match_the_era_and_a_friends_newer_player_does_not_change_it()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var nine = await creator.PostAsJsonAsync("/api/challenges", Team("np01", 1965, Nl(1, 9)));
        Assert.Equal(HttpStatusCode.BadRequest, nine.StatusCode);
        Assert.Equal(8, (await nine.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("batters").GetInt32());
        var eleven = await creator.PostAsJsonAsync("/api/challenges", Team("ap01", 2000, Al(1, 11)));
        Assert.Equal("Pick 1 pitcher and 8 or 9 batters.", (await eleven.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var short8 = await creator.PostAsJsonAsync("/api/challenges", Team("ap01", 2000, Al(1, 8)));
        Assert.Equal(9, (await short8.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("batters").GetInt32());

        var code = await Create(creator, Team("np01", 1965, Nl(1, 8)));
        var wrong = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(1, 9)));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Equal(8, (await wrong.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("batters").GetInt32());
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(1, 8)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var v = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        Assert.False(v.GetProperty("era").GetProperty("dh").GetBoolean());
        Assert.Equal(1965, v.GetProperty("era").GetProperty("season").GetInt32());
        CheckGame(v, 8);
        var game = v.GetProperty("game");
        Assert.Equal("np01", game.GetProperty("lineups")[0][9].GetProperty("id").GetString());
        Assert.Equal("ap02", game.GetProperty("lineups")[1][9].GetProperty("id").GetString());
        Assert.Equal("pitcher", game.GetProperty("lineupSources")[0][9].GetString());
    }

    [Fact]
    public async Task Clashes_over_ten_slots_name_at_most_three_players()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var code = await Create(creator, Team("ap01", 2000, Al(1, 9)));
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(1, 4).Concat(Al(14, 5)), backups: new() { [1] = new[] { "ab20" } }));
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("clash", j.GetProperty("error").GetString());
        Assert.Equal(3, j.GetProperty("clashes").GetArrayLength());
        // After the one notice, backups and seeded swaps fill in.
        var again = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(1, 4).Concat(Al(14, 5)), backups: new() { [1] = new[] { "ab20" } }));
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var v = (await again.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        var src = v.GetProperty("game").GetProperty("lineupSources")[1].EnumerateArray().Select(x => x.GetString()).ToList();
        Assert.Equal("backup", src[1]);
        Assert.Equal(3, src.Count(s => s == "swap"));
        var ids = v.GetProperty("game").GetProperty("lineups").EnumerateArray().SelectMany(l => l.EnumerateArray().Select(p => p.GetProperty("id").GetString())).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public async Task The_computer_plays_an_inning_and_its_pitcher_bats_when_there_is_no_DH()
    {
        var f = Factory(NewStore());
        var me = await Browser(f);
        var body = new { picks = ((dynamic)Team("np01", 1965, Nl(1, 8))).picks, mode = "inning", level = 1 };
        var r = await me.PostAsJsonAsync("/api/challenges/computer", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var v = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        CheckGame(v, 8);
        var cpu = v.GetProperty("game").GetProperty("lineups")[1];
        Assert.Equal(cpu[0].GetProperty("id").GetString(), cpu[9].GetProperty("id").GetString());
        Assert.True(v.GetProperty("vsCpu").GetBoolean());
        // A computer inning with the DH: 9 drawn batters.
        var dh = await me.PostAsJsonAsync("/api/challenges/computer", new { picks = ((dynamic)Team("ap01", 2000, Al(1, 9))).picks, mode = "inning" });
        CheckGame((await dh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view"), 9);
    }

    [Fact]
    public async Task A_rematch_keeps_the_mode_and_takes_its_era_from_the_new_home_side()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var code = await Create(creator, Team("np01", 1965, Nl(1, 8)));
        Assert.Equal(HttpStatusCode.OK, (await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Team("ap02", 2000, Al(1, 8)))).StatusCode);
        var stale = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", OldApp("ap02", "ab01", "ab02", "ab03", 2000));
        Assert.Equal("update", (await stale.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Team("ap02", 2000, Al(1, 9)));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var re = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();
        var v = await creator.GetFromJsonAsync<JsonElement>($"/api/challenges/{re}");
        Assert.Equal("inning", v.GetProperty("mode").GetString());
        Assert.True(v.GetProperty("era").GetProperty("dh").GetBoolean());
    }

    [Fact]
    public async Task Quick_pick_and_the_era_preview_agree_on_the_lineup_size()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        for (var i = 0; i < 8; i++)
        {
            var q = await c.GetFromJsonAsync<JsonElement>("/api/challenges/quickpick?mode=inning");
            var slots = q.GetProperty("slots");
            var batters = q.GetProperty("era").GetProperty("batters").GetInt32();
            Assert.Equal(batters, q.GetProperty("batters").GetInt32());
            Assert.Equal(batters + 1, slots.GetArrayLength());
            var p = slots[0].GetProperty("choices")[0];
            var url = $"/api/challenges/era?p={p.GetProperty("id").GetString()}:{p.GetProperty("year").GetInt32()}" +
                string.Concat(slots.EnumerateArray().Skip(1).Select(s => $"&b={s.GetProperty("choices")[0].GetProperty("id").GetString()}:{s.GetProperty("choices")[0].GetProperty("year").GetInt32()}"));
            Assert.Equal(batters, (await c.GetFromJsonAsync<JsonElement>(url)).GetProperty("batters").GetInt32());
        }
        // The friend asks for the size the stored era needs.
        foreach (var n in new[] { 8, 9 })
        {
            var q = await c.GetFromJsonAsync<JsonElement>($"/api/challenges/quickpick?mode=inning&batters={n}");
            Assert.Equal(n + 1, q.GetProperty("slots").GetArrayLength());
            Assert.Equal(n, q.GetProperty("batters").GetInt32());
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/challenges/quickpick?mode=inning&batters=3")).StatusCode);
        Assert.Equal(4, (await c.GetFromJsonAsync<JsonElement>("/api/challenges/quickpick")).GetArrayLength());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/challenges/era?p=nobody:1999")).StatusCode);
    }

    [Fact]
    public async Task A_long_game_is_stored_and_read_back_whole()
    {
        var store = NewStore();
        var now = DateTime.UtcNow;
        var code = Identity.NewCode();
        var era = EraRules.From(new[] { (2000, "AL") });
        await store.CreateChallengeAsync(new Challenge(code, Guid.NewGuid(), "A", null, null, ChallengeStatus.Open, now, now.AddHours(1), null, null, null, null,
            Deco: 3, Mode: Rules.Inning, Era: era), new[] { new StoredPick(0, 0, 0, "ap01", 2000) }, Identity.Hash(Identity.NewToken()), new string('a', 64));
        var abs = Enumerable.Range(0, 240).Select(i => new AtBatResult(i, i / 60, i % 2, new PickRef("ap01", 2000), new PickRef($"ab{i % 24 + 1:00}", 2000), (ulong)i * 1_000_003UL,
            Outcome.Single, i % 3 == 0 ? 1 : 0, new InningAtBat(i / 60 + 1, i % 9, i % 3, i % 3, new string?[] { "ab01", null, "ab03" }, new string?[] { null, "ab02", null },
                OutType.None, i % 3 == 0 ? new[] { "ab03" } : Array.Empty<string>()))).ToList();
        // Stage B2: the play kinds the base line needs come back whole.
        abs[10] = abs[10] with { Inn = abs[10].Inn! with { OutType = OutType.Ground, RunnersOut = new[] { "ab01" }, DoublePlay = true } };          // double play
        abs[11] = abs[11] with { Inn = abs[11].Inn! with { RunnersOut = new[] { "ab02" } } };                                                     // thrown out on a single
        abs[12] = abs[12] with { Inn = abs[12].Inn! with { OutType = OutType.Fly, SacFly = true } };                                             // sac fly
        abs[13] = abs[13] with { Inn = abs[13].Inn! with { OutType = OutType.Ground, RunnersOut = new[] { "ab01" } } };                           // force at second
        abs[14] = abs[14] with { Inn = abs[14].Inn! with { OutsAfter = 3, BasesAfter = new string?[3], RunnersOut = Array.Empty<string>() } };     // stranded runners
        var lineups = Enumerable.Range(0, 2).Select(s => (IReadOnlyList<LineupEntry>)Enumerable.Range(0, 10).Select(k => new LineupEntry($"ab{k + 1:00}", 2000, k == 0 ? "pick" : "backup")).ToList()).ToList();
        var game = new GameResult(42, new PickRef[2][], abs, new[] { 40, 40 }, -1, new List<string>(), new InningData(1, era, lineups, new[] { new[] { 10, 10, 10, 10 }, new[] { 10, 10, 10, 10 } }, 4));
        Assert.Equal(LockOutcome.Locked, await store.LockAndResolveAsync(code, Guid.NewGuid(), "B", Array.Empty<StoredPick>(), Identity.Hash(Identity.NewToken()), now, _ => game));
        var back = await store.AtBatsAsync(code);
        Assert.Equal(240, back.Count);
        Assert.True(back[10].Inn!.DoublePlay); Assert.Equal(new[] { "ab01" }, back[10].Inn!.RunnersOut);
        Assert.Equal(new[] { "ab02" }, back[11].Inn!.RunnersOut); Assert.False(back[11].Inn!.DoublePlay);
        Assert.True(back[12].Inn!.SacFly);
        Assert.Equal(new[] { "ab01" }, back[13].Inn!.RunnersOut);
        Assert.Empty(back[14].Inn!.RunnersOut!); Assert.Equal(3, back[14].Inn!.OutsAfter);
        Assert.Equal(abs[239].Seed, back[239].Seed);
        Assert.Equal(new string?[] { "ab01", null, "ab03" }, back[100].Inn!.BasesBefore);
        Assert.Equal(new[] { "ab03" }, back[99].Inn!.Scored);
        var ch = await store.GetAsync(code);
        Assert.Equal(Rules.Inning, ch!.Mode);
        Assert.True(ch.Era!.DesignatedHitter);
        Assert.Equal(4, ch.Inning!.Innings);
        Assert.Equal("backup", ch.Inning.Lineups[1][3].From);
    }
}

/// <summary>One shared test database: SQL test classes run one at a time.</summary>
[Xunit.Collection("sql")]
public class InningSqlTests : InningApiTests
{
    private static readonly string? Cs = Environment.GetEnvironmentVariable("PR_TEST_SQL");

    protected override IChallengeStore NewStore()
    {
        if (Cs is null) return new MemoryChallengeStore();
        var store = new SqlChallengeStore(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Stats"] = Cs }).Build());
        store.GetAsync("warm-up-creates-tables").GetAwaiter().GetResult();
        using var c = new Microsoft.Data.SqlClient.SqlConnection(Cs);
        c.Open();
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand("DELETE dbo.ch_atbats; DELETE dbo.ch_picks; DELETE dbo.ch_keys; DELETE dbo.ch_challenges; DELETE dbo.ch_guests;", c);
        cmd.ExecuteNonQuery();
        return store;
    }
}
