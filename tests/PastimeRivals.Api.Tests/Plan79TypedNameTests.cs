using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;

namespace PastimeRivals.Api.Tests;

/// <summary>Counts bot checks, so order tests prove a refused name never burns one.</summary>
public sealed class CountingTurnstile : ITurnstile
{
    private int _calls;
    public int Calls => _calls;
    public Task<bool> PassesAsync(string? token, HttpContext ctx) { Interlocked.Increment(ref _calls); return Task.FromResult(true); }
}

/// <summary>Plan 79-A1: typed team names, the switch, reporting, admin swaps (memory store).</summary>
public class Plan79TypedNameTests : Plan79ApiTests
{
    private static readonly Dictionary<string, string> On = new() { ["Teams:TypedNames"] = "true", ["Admin:Key"] = "test-admin-key" };

    private static (WebApplicationFactory<Program> F, MemoryChallengeStore Store, CountingTurnstile Ts) Setup(bool on = true)
    {
        var store = new MemoryChallengeStore();
        var ts = new CountingTurnstile();
        return (Factory(store, s => s.AddSingleton<ITurnstile>(ts), on ? On : new() { ["Admin:Key"] = "test-admin-key" }), store, ts);
    }

    private static async Task<string> Err(HttpResponseMessage r) => (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()!;

    private static async Task<(string Code, HttpClient Creator, HttpClient Friend)> Played(WebApplicationFactory<Program> f, string creatorTeam, string friendTeam, string net)
    {
        var creator = await Browser(f, $"10.{net}.0.1");
        var friend = await Browser(f, $"10.{net}.0.2");
        var code = await Create(creator, creatorTeam);
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body(friendTeam, "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (code, creator, friend);
    }

    private static Task<HttpResponseMessage> Report(HttpClient c, string code, int side) => c.PostAsJsonAsync($"/api/challenges/{code}/report-name", new { side });

    [Fact]
    public async Task Me_says_typed_names_are_on_when_switched_on()
    {
        var (f, _, _) = Setup();
        Assert.True((await f.CreateClient().GetFromJsonAsync<JsonElement>("/api/me")).GetProperty("typedNames").GetBoolean());
    }

    [Fact]
    public async Task A_typed_name_is_cleaned_stored_and_flagged_on_create_lock_and_computer()
    {
        var (f, _, _) = Setup();
        var (code, creator, _) = await Played(f, "  the  Ｔａｃｏｍａ  Titans ", "Mighty Abcdefghijklmn", "80");
        var v = await View(creator, code);
        Assert.Equal("Tacoma Titans", Str(v, "creatorTeam"));
        Assert.True(v.GetProperty("creatorTyped").GetBoolean());
        Assert.Equal("Tacoma Titans", Str(v, "creatorShort"));
        Assert.Equal("Mighty Abcdefghijklmn", Str(v, "opponentTeam"));
        Assert.Equal("Mighty Abcd…", Str(v, "opponentShort"));
        var cpu = await creator.PostAsJsonAsync("/api/challenges/computer", Body("Jake's Nine", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal("Jake's Nine", Str((await cpu.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view"), "creatorTeam"));
    }

    [Fact]
    public async Task With_the_switch_off_a_typed_name_is_refused()
    {
        var (f, _, _) = Setup(on: false);
        var c = await Browser(f);
        var r = await c.PostAsJsonAsync("/api/challenges", Body("Tacoma Titans", "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        var ck = await c.PostAsJsonAsync("/api/challenges/check-team", new { team = "Tacoma Titans" });
        Assert.Equal(HttpStatusCode.BadRequest, ck.StatusCode);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("Tacoma Titans!")]
    [InlineData("Abc 123")]
    [InlineData("Go to evil.com")]
    [InlineData("Supercalifragilistic")]
    [InlineData("Tacoma F4g")]
    [InlineData("Erie Red Sox")]
    public async Task Every_rule_refuses_with_the_same_message_and_burns_no_bot_check(string name)
    {
        var (f, _, ts) = Setup();
        var creator = await Browser(f, "10.81.0.1");
        var r = await creator.PostAsJsonAsync("/api/challenges", Body(name, "pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal("Try another name.", await Err(r));
        var ck = await creator.PostAsJsonAsync("/api/challenges/check-team", new { team = name });
        Assert.Equal(HttpStatusCode.BadRequest, ck.StatusCode);
        Assert.Equal("Try another name.", await Err(ck));
        var code = await Create(creator, "Toledo Night Owls");
        var before = ts.Calls;
        var friend = await Browser(f, "10.81.0.2");
        var lk = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Body(name, "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.BadRequest, lk.StatusCode);
        Assert.Equal(before, ts.Calls);
        Assert.Equal(1, ts.Calls);   // only the good create used one
    }

    [Fact]
    public async Task Check_team_says_yes_to_a_good_name_and_needs_the_anti_forgery_token()
    {
        var (f, _, _) = Setup();
        var c = await Browser(f);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsJsonAsync("/api/challenges/check-team", new { team = "Toledo Night Owls" })).StatusCode);
        var bare = f.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await bare.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
    }

    [Fact]
    public async Task A_rematch_resending_a_now_refused_name_gets_a_server_name_and_runs_the_bot_check_once()
    {
        var (f, store, ts) = Setup();
        var (code, creator, friend) = await Played(f, "Toledo Night Owls", "Jake's Nine", "82");
        // The friend's name was reported by the creator: it is on the friend's refused list now.
        Assert.Equal(HttpStatusCode.NoContent, (await Report(creator, code, 1)).StatusCode);
        var before = ts.Calls;
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Body("Jake's Nine", "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(before + 1, ts.Calls);
        var rm = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        Assert.True(TeamNames.IsListName((await store.GetAsync(rm))!.CreatorTeam));
    }

    [Fact]
    public async Task A_strangers_report_swaps_that_game_only_and_blocks_nothing()
    {
        var (f, store, _) = Setup();
        var (code, _, friend) = await Played(f, "Jake's Nine", "Toledo Night Owls", "83");
        var stranger = await Browser(f, "10.83.9.9");
        var r = await Report(stranger, code, 0);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        var ch = (await store.GetAsync(code))!;
        Assert.True(TeamNames.IsListName(ch.CreatorTeam));
        Assert.False(ch.CreatorTyped);
        Assert.NotEqual(TeamNames.CityOf(ch.OpponentTeam), TeamNames.CityOf(ch.CreatorTeam));
        // The creator may still use the name in a new game.
        var owner = await Browser(f, "10.83.0.1");
        Assert.Single(store.Reports);
    }

    [Fact]
    public async Task The_other_players_report_swaps_and_puts_the_name_on_the_owners_refused_list_in_any_spelling()
    {
        var (f, store, _) = Setup();
        var (code, creator, friend) = await Played(f, "Toledo Night Owls", "Jake Smells", "84");
        Assert.Equal(HttpStatusCode.NoContent, (await Report(creator, code, 1)).StatusCode);
        Assert.False((await store.GetAsync(code))!.OpponentTyped);
        var again = await friend.PostAsJsonAsync("/api/challenges", Body("Jáke  Smells.", "pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.BadRequest, again.StatusCode);
        Assert.Equal("That name was reported. Try another.", await Err(again));
        var ck = await friend.PostAsJsonAsync("/api/challenges/check-team", new { team = "jake smells" });
        Assert.Equal("That name was reported. Try another.", await Err(ck));
    }

    [Fact]
    public async Task The_opponents_report_after_a_strangers_still_fills_the_refused_list_from_the_logged_name()
    {
        var (f, store, _) = Setup();
        var (code, creator, friend) = await Played(f, "Toledo Night Owls", "Jake Smells", "85");
        await Report(await Browser(f, "10.85.9.9"), code, 1);
        await Report(creator, code, 1);
        Assert.Equal(2, store.Reports.Count);
        var again = await friend.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake Smells" });
        Assert.Equal("That name was reported. Try another.", await Err(again));
    }

    [Fact]
    public async Task The_named_rematch_opponent_can_report_before_lock()
    {
        var (f, store, _) = Setup();
        var (code, creator, friend) = await Played(f, "Toledo Night Owls", "Erie Kingfishers", "86");
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Body("Jake Smells", "pit02", "bat04", "bat05", "bat06"));
        var rm = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await Report(creator, rm, 0)).StatusCode);
        Assert.False((await store.GetAsync(rm))!.CreatorTyped);
        Assert.Equal("That name was reported. Try another.", await Err(await friend.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake Smells" })));
    }

    [Fact]
    public async Task A_report_on_a_server_name_or_by_the_owner_changes_nothing_and_duplicates_log_once()
    {
        var (f, store, _) = Setup();
        var (code, creator, friend) = await Played(f, "Toledo Night Owls", "Jake Smells", "87");
        var stranger = await Browser(f, "10.87.9.9");
        Assert.Equal(HttpStatusCode.NoContent, (await Report(stranger, code, 0)).StatusCode);
        Assert.Equal("Toledo Night Owls", (await store.GetAsync(code))!.CreatorTeam);
        Assert.Equal(HttpStatusCode.NoContent, (await Report(friend, code, 1)).StatusCode);   // own name
        Assert.Equal("Jake Smells", (await store.GetAsync(code))!.OpponentTeam);
        Assert.Empty(store.Reports);
        await Report(stranger, code, 1);
        await Report(stranger, code, 1);
        Assert.Single(store.Reports);
    }

    [Fact]
    public async Task Bad_codes_on_report_name_count_as_misses()
    {
        var (f, _, _) = Setup();
        var c = await Browser(f, "10.88.0.1");
        HttpStatusCode last = 0;
        for (var i = 0; i < 31; i++) last = (await Report(c, "AAAAAAAAAAAAAAAAAAAAA" + (char)('a' + i % 26), 0)).StatusCode;
        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }

    [Fact]
    public async Task Check_team_has_its_own_limit_of_20_a_minute_per_network_block()
    {
        var (f, _, _) = Setup();
        var a = await Browser(f, "2001:db8:1:2::1");
        var b = await Browser(f, "2001:db8:1:2::99");
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.NoContent, (await b.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await a.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
        var other = await Browser(f, "2001:db8:9:9::1");
        Assert.Equal(HttpStatusCode.NoContent, (await other.PostAsJsonAsync("/api/challenges/check-team", new { team = "Jake's Nine" })).StatusCode);
    }

    [Fact]
    public async Task Admin_swaps_need_the_admin_key()
    {
        var (f, store, _) = Setup();
        var (code, _, _) = await Played(f, "Jake's Nine", "Mighty Riveters", "89");
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync("/api/admin/swap-team", new { code, side = 0 })).StatusCode);
        var wrong = new HttpRequestMessage(HttpMethod.Post, "/api/admin/swap-team") { Content = JsonContent.Create(new { code, side = 0 }) };
        wrong.Headers.Add("X-Admin-Key", "nope");
        Assert.Equal(HttpStatusCode.NotFound, (await c.SendAsync(wrong)).StatusCode);
        var ok = new HttpRequestMessage(HttpMethod.Post, "/api/admin/swap-team") { Content = JsonContent.Create(new { code, side = 0 }) };
        ok.Headers.Add("X-Admin-Key", "test-admin-key");
        Assert.Equal(HttpStatusCode.NoContent, (await c.SendAsync(ok)).StatusCode);
        Assert.False((await store.GetAsync(code))!.CreatorTyped);
        Assert.True((await store.GetAsync(code))!.OpponentTyped);
        var all = new HttpRequestMessage(HttpMethod.Post, "/api/admin/swap-all-typed");
        all.Headers.Add("X-Admin-Key", "test-admin-key");
        Assert.Equal(HttpStatusCode.OK, (await c.SendAsync(all)).StatusCode);
        Assert.Empty(await store.TypedTeamsAsync());
        Assert.True(TeamNames.IsListName((await store.GetAsync(code))!.OpponentTeam));
    }

    [Fact]
    public async Task The_link_preview_encodes_a_typed_name()
    {
        var (f, _, _) = Setup();
        var c = await Browser(f);
        var code = await Create(c, "A&B's Riveters");
        var html = await f.CreateClient().GetStringAsync($"/c/{code}");
        Assert.Contains("<title>The A&amp;B&#x27;s Riveters challenged you on Pastime Rivals</title>", html);
        Assert.DoesNotContain("A&B's", html);
    }

    [Fact]
    public async Task The_funnel_readout_lists_name_reports()
    {
        var (f, _, _) = Setup();
        var (code, creator, _) = await Played(f, "Toledo Night Owls", "Jake Smells", "90");
        await Report(creator, code, 1);
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/admin/funnel?days=7");
        req.Headers.Add("X-Funnel-Key", "test-funnel-key");
        var text = await (await f.CreateClient().SendAsync(req)).Content.ReadAsStringAsync();
        Assert.Contains($"Name reports (last 7 days): 1 | {code}", text);
    }
}
