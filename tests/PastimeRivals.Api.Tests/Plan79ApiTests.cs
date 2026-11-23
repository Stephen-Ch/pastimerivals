using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 79 shared helpers (no tests here, so subclasses don't rerun Part A).</summary>
public abstract class Plan79Base
{
    protected static WebApplicationFactory<Program> Factory(IChallengeStore store, Action<IServiceCollection>? more = null, Dictionary<string, string>? settings = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "10000");
            b.UseSetting("Funnel:Key", "test-funnel-key");
            foreach (var kv in settings ?? new()) b.UseSetting(kv.Key, kv.Value);
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IStatsSource, ChallengeStats>();
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<IChallengeStore>(store);
                s.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, TestIpFilter>();
                more?.Invoke(s);
            });
        });

    protected static async Task<HttpClient> Browser(WebApplicationFactory<Program> f, string? ip = null)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        if (ip is not null) c.DefaultRequestHeaders.Add("X-Test-Ip", ip);
        var me = await c.GetAsync("/api/me");
        me.EnsureSuccessStatusCode();
        var xsrf = me.Headers.GetValues("Set-Cookie").First(h => h.StartsWith("XSRF-TOKEN=")).Split(';')[0]["XSRF-TOKEN=".Length..];
        c.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf));
        return c;
    }

    protected static object Body(string? team, string p, string b1, string b2, string b3) => new
    {
        team,
        picks = new object[]
        {
            new { slot = 0, choices = new[] { new { id = p, year = 2000 } } },
            new { slot = 1, choices = new[] { new { id = b1, year = 2000 } } },
            new { slot = 2, choices = new[] { new { id = b2, year = 2000 } } },
            new { slot = 3, choices = new[] { new { id = b3, year = 2000 } } },
        },
    };

    protected static async Task<string> Create(HttpClient c, string? team)
    {
        var r = await c.PostAsJsonAsync("/api/challenges", Body(team, "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
    }

    protected static async Task<JsonElement> View(HttpClient c, string code) => await c.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");

    protected static string? Str(JsonElement e, string p) => e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

}

/// <summary>Plan 79 A: server-made team names through the API (memory store).</summary>
public class Plan79ApiTests : Plan79Base
{
    [Fact]
    public async Task Me_offers_four_list_names_and_says_typed_names_are_off_by_default()
    {
        var f = Factory(new MemoryChallengeStore());
        var c = f.CreateClient();
        var me = await c.GetFromJsonAsync<JsonElement>("/api/me");
        var teams = me.GetProperty("teams").EnumerateArray().Select(x => x.GetString()!).ToList();
        Assert.Equal(4, teams.Distinct().Count());
        Assert.All(teams, t => Assert.True(TeamNames.IsListName(t)));
        Assert.False(me.GetProperty("typedNames").GetBoolean());
    }

    [Fact]
    public async Task Create_keeps_a_list_name_and_refuses_a_made_up_one()
    {
        var f = Factory(new MemoryChallengeStore());
        var c = await Browser(f);
        var code = await Create(c, "Toledo Night Owls");
        var v = await View(c, code);
        Assert.Equal("Toledo Night Owls", Str(v, "creatorTeam"));
        Assert.Equal("Night Owls", Str(v, "creatorShort"));
        Assert.False(v.GetProperty("creatorTyped").GetBoolean());

        var bad = await c.PostAsJsonAsync("/api/challenges", Body("Gotham Bats", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal("Try another name.", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_missing_name_gets_a_server_name_for_old_tabs()
    {
        var f = Factory(new MemoryChallengeStore());
        var c = await Browser(f);
        var code = await Create(c, null);
        Assert.True(TeamNames.IsListName(Str(await View(c, code), "creatorTeam")));
    }

    [Fact]
    public async Task The_friend_sees_the_team_name_and_suggestions_that_skip_the_creators_city_and_the_link_preview_names_the_team()
    {
        var f = Factory(new MemoryChallengeStore());
        var creator = await Browser(f, "10.79.0.1");
        var friend = await Browser(f, "10.79.0.2");
        var code = await Create(creator, "Toledo Night Owls");
        var v = await View(friend, code);
        Assert.Equal("Toledo Night Owls", Str(v, "creatorTeam"));
        var choices = v.GetProperty("teamChoices").EnumerateArray().Select(x => x.GetString()!).ToList();
        Assert.Equal(4, choices.Count);
        Assert.DoesNotContain(choices, n => TeamNames.CityOf(n) == "Toledo");

        var html = await f.CreateClient().GetStringAsync($"/c/{code}");
        Assert.Contains("<title>The Toledo Night Owls challenged you on Pastime Rivals</title>", html);
        Assert.Contains("og:title\" content=\"The Toledo Night Owls challenged you on Pastime Rivals\"", html);
    }

    [Fact]
    public async Task Two_sides_never_share_a_city_a_stale_tab_gets_a_fresh_name()
    {
        var f = Factory(new MemoryChallengeStore());
        var creator = await Browser(f, "10.79.1.1");
        var friend = await Browser(f, "10.79.1.2");
        var code = await Create(creator, "Toledo Night Owls");
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body("Toledo Riveters", "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var view = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        var opp = Str(view, "opponentTeam");
        Assert.True(TeamNames.IsListName(opp));
        Assert.NotEqual("Toledo", TeamNames.CityOf(opp));
    }

    [Fact]
    public async Task Lock_keeps_the_friends_list_name_and_both_names_show_in_your_games()
    {
        var f = Factory(new MemoryChallengeStore());
        var creator = await Browser(f, "10.79.2.1");
        var friend = await Browser(f, "10.79.2.2");
        var code = await Create(creator, "Toledo Night Owls");
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body("Erie Kingfishers", "pit02", "bat04", "bat05", "bat06"));
        var view = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        Assert.Equal("Erie Kingfishers", Str(view, "opponentTeam"));
        Assert.Equal("Kingfishers", Str(view, "opponentShort"));
        var mine = await creator.GetFromJsonAsync<JsonElement>("/api/challenges/mine");
        Assert.Equal("Toledo Night Owls", Str(mine[0], "creatorTeam"));
        Assert.Equal("Erie Kingfishers", Str(mine[0], "opponentTeam"));
    }

    [Fact]
    public async Task Lock_refuses_a_made_up_name()
    {
        var f = Factory(new MemoryChallengeStore());
        var creator = await Browser(f, "10.79.3.1");
        var friend = await Browser(f, "10.79.3.2");
        var code = await Create(creator, "Toledo Night Owls");
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body("Gotham Bats", "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    [Fact]
    public async Task Computer_games_keep_your_name_and_the_computer_keeps_its_own()
    {
        var f = Factory(new MemoryChallengeStore());
        var c = await Browser(f);
        var r = await c.PostAsJsonAsync("/api/challenges/computer", Body("Boise Lanterns", "pit01", "bat01", "bat02", "bat03"));
        var view = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view");
        Assert.Equal("Boise Lanterns", Str(view, "creatorTeam"));
        Assert.Null(Str(view, "opponentTeam"));
        Assert.Equal("The Computer", Str(view, "opponentName"));
        var bad = await c.PostAsJsonAsync("/api/challenges/computer", Body("Gotham Bats", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Old_games_with_no_team_name_fall_back_to_nicknames()
    {
        var store = new MemoryChallengeStore();
        var f = Factory(store);
        var c = await Browser(f);
        var code = Identity.NewCode();
        var now = DateTime.UtcNow;
        await store.CreateChallengeAsync(new Challenge(code, Guid.NewGuid(), "Ace 1234", null, null, ChallengeStatus.Open, now, now.AddHours(72), null, null, null, null),
            new List<StoredPick> { new(0, 0, 0, "pit01", 2000), new(0, 1, 0, "bat01", 2000), new(0, 2, 0, "bat02", 2000), new(0, 3, 0, "bat03", 2000) }, Identity.Hash("k"), "ip");
        var v = await View(c, code);
        Assert.Null(Str(v, "creatorTeam"));
        Assert.Equal("Ace 1234", Str(v, "creatorName"));
        var html = await f.CreateClient().GetStringAsync($"/c/{code}");
        Assert.Contains("<title>You've been challenged on Pastime Rivals</title>", html);
    }

    [Fact]
    public async Task A_rematch_copies_a_stored_name_even_when_the_lists_no_longer_make_it()
    {
        var store = new MemoryChallengeStore();
        var f = Factory(store);
        var creator = await Browser(f, "10.79.4.1");
        var friend = await Browser(f, "10.79.4.2");
        var code = await Create(creator, "Toledo Night Owls");
        await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body("Erie Kingfishers", "pit02", "bat04", "bat05", "bat06"));
        // A word later leaves the lists: the stored name is trusted from then on.
        var old = (await store.GetAsync(code))!;
        await store.SetTeamAsync(code, 1, "Erie Glowworms", typed: false);
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Body("Erie Glowworms", "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var rm = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        Assert.Equal("Erie Glowworms", Str(await View(friend, rm), "creatorTeam"));
        // The old creator locks the rematch with their stored name.
        var lk = await creator.PostAsJsonAsync($"/api/challenges/{rm}/lock", Body("Toledo Night Owls", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.OK, lk.StatusCode);
        Assert.Equal("Toledo Night Owls", Str((await lk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view"), "opponentTeam"));
        Assert.Equal("Toledo Night Owls", old.CreatorTeam);
    }

    [Fact]
    public async Task Accepting_a_rematch_offers_your_stored_name_first_even_when_the_lists_no_longer_make_it()
    {
        var store = new MemoryChallengeStore();
        var f = Factory(store);
        var creator = await Browser(f, "10.79.5.1");
        var friend = await Browser(f, "10.79.5.2");
        var code = await Create(creator, "Toledo Night Owls");
        await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body("Erie Kingfishers", "pit02", "bat04", "bat05", "bat06"));
        await store.SetTeamAsync(code, 0, "Toledo Glowworms", typed: false);   // a word later leaves the lists
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Body("Erie Kingfishers", "pit02", "bat04", "bat05", "bat06"));
        var rm = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        var v = await View(creator, rm);
        Assert.Equal("Toledo Glowworms", v.GetProperty("teamChoices")[0].GetString());
        var lk = await creator.PostAsJsonAsync($"/api/challenges/{rm}/lock", Body("Toledo Glowworms", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.OK, lk.StatusCode);
        Assert.Equal("Toledo Glowworms", Str((await lk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view"), "opponentTeam"));
    }
}
