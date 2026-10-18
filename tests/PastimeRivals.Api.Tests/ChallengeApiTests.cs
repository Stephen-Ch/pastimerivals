using System.Net;
using Microsoft.Extensions.Configuration;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Tests;

public sealed class ChallengeStats : IStatsSource
{
    private static SeasonCounts C(int pa, int k, int bb, int hr, int single) => new(pa, pa, k, bb, 5, single, 30, 3, hr);

    public Task<StatsBundle> LoadAsync()
    {
        var leagues = new List<LeagueRow>();
        foreach (var lg in new[] { "AL", "NL" })
        {
            leagues.Add(new LeagueRow(2000, lg, "bat", C(40000, 6000, 3500, 1000, 6000)));
            leagues.Add(new LeagueRow(2000, lg, "pit", C(44000, 6800, 3800, 1050, 6400)));
        }
        var bats = Enumerable.Range(1, 12).Select(i => new PlayerRow($"bat{i:00}", 2000, 500 + i, 0, 0, C(500 + i, 90, 50, 10 + i, 90), 'A', "NYA", "RF"))
            .Append(new PlayerRow("ruthb101", 2000, 600, 0, 0, C(600, 80, 100, 50, 100), 'A', "NYA", "RF")).ToArray();
        var pits = Enumerable.Range(1, 4).Select(i => new PlayerRow($"pit{i:00}", 2000, 800, 0, 0, C(800, 200, 50, 15 + i, 120), 'A', "BOS", "P"))
            .Append(new PlayerRow("ruthb101", 2000, 300, 0, 0, C(300, 50, 30, 5, 50), 'A', "NYA", "P")).ToArray();
        var cat = new StatsCatalog(leagues, Array.Empty<PlatoonRow>(), bats, pits, Array.Empty<ExposureRow>());
        var people = bats.Select(b => b.Id).Concat(pits.Select(p => p.Id)).Distinct()
            .Select(id => new PersonRow(id, "First", id, "R", "R", 1970, "")).ToList();
        return Task.FromResult(new StatsBundle(cat, people, new List<TeamRow>()));
    }
}

/// <summary>In-memory store with the same claim rule as SQL (one lock decides the claim).</summary>
public sealed class MemoryChallengeStore : IChallengeStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Guest> _guests = new();
    private readonly List<(string Ip, DateTime At)> _guestIps = new();
    private readonly Dictionary<string, (Challenge C, string Ip)> _ch = new();
    private readonly List<StoredPick> _picks = new();
    private readonly Dictionary<string, List<StoredPick>> _picksByCode = new();
    private readonly Dictionary<string, List<AtBatResult>> _atBats = new();
    private readonly Dictionary<string, (string, int)> _keys = new();

    public Task<Guest?> GuestByTokenHashAsync(string h) { lock (_gate) return Task.FromResult(_guests.GetValueOrDefault(h)); }
    public Task<Guest> CreateGuestAsync(string h, string n, string ip) { var g = new Guest(Guid.NewGuid(), n); lock (_gate) { _guests[h] = g; _guestIps.Add((ip, DateTime.UtcNow)); } return Task.FromResult(g); }
    public Task<int> GuestsCreatedSinceAsync(string ip, DateTime since) { lock (_gate) return Task.FromResult(_guestIps.Count(x => x.Ip == ip && x.At > since)); }
    public Task<bool> RematchExistsAsync(string code, Guid id) { lock (_gate) return Task.FromResult(_ch.Values.Any(v => v.C.RematchOf == code && v.C.CreatorId == id)); }
    public Task AddKeyAsync(string code, int side, string h) { lock (_gate) _keys[h] = (code, side); return Task.CompletedTask; }
    public Task SetNicknameAsync(Guid id, string n)
    {
        lock (_gate) foreach (var k in _guests.Where(kv => kv.Value.Id == id).Select(kv => kv.Key).ToList()) _guests[k] = _guests[k] with { Nickname = n };
        return Task.CompletedTask;
    }
    public Task CreateChallengeAsync(Challenge c, IReadOnlyList<StoredPick> picks, string keyHash, string ip)
    {
        lock (_gate) { _ch[c.Code] = (c, ip); _picksByCode[c.Code] = picks.ToList(); _keys[keyHash] = (c.Code, 0); }
        return Task.CompletedTask;
    }
    public Task<Challenge?> GetAsync(string code) { lock (_gate) return Task.FromResult(_ch.TryGetValue(code, out var v) ? v.C : null); }
    public Task<IReadOnlyList<StoredPick>> PicksAsync(string code) { lock (_gate) return Task.FromResult<IReadOnlyList<StoredPick>>(_picksByCode.GetValueOrDefault(code)?.ToList() ?? new()); }
    public Task<IReadOnlyList<AtBatResult>> AtBatsAsync(string code) { lock (_gate) return Task.FromResult<IReadOnlyList<AtBatResult>>(_atBats.GetValueOrDefault(code) ?? new()); }
    public Task ExpireAsync(string code)
    {
        lock (_gate) if (_ch.TryGetValue(code, out var v) && v.C.Status == ChallengeStatus.Open) _ch[code] = (v.C with { Status = ChallengeStatus.Expired }, v.Ip);
        return Task.CompletedTask;
    }
    public Task<LockOutcome> LockAndResolveAsync(string code, Guid oid, string oname, IReadOnlyList<StoredPick> picks, string keyHash, DateTime now,
        Func<IReadOnlyList<StoredPick>, GameResult> resolve)
    {
        lock (_gate)
        {
            if (!_ch.TryGetValue(code, out var v)) return Task.FromResult(LockOutcome.NotFound);
            var c = v.C;
            if (c.CreatorId == oid) return Task.FromResult(LockOutcome.OwnChallenge);
            if (c.RematchFor is { } rf && rf != oid) return Task.FromResult(LockOutcome.NotForYou);
            if (c.OpponentId is not null || c.Status == ChallengeStatus.Resolved) return Task.FromResult(LockOutcome.Taken);
            if (c.Status == ChallengeStatus.Expired || c.ExpiresUtc <= now) return Task.FromResult(LockOutcome.Expired);
            var all = _picksByCode[code].Concat(picks).ToList();
            var g = resolve(all);
            _picksByCode[code] = all;
            _atBats[code] = g.AtBats.ToList();
            _keys[keyHash] = (code, 1);
            _ch[code] = (c with { OpponentId = oid, OpponentName = oname, Status = ChallengeStatus.Resolved, Totals = g.Totals, Winner = g.Winner, Notes = g.Notes }, v.Ip);
            return Task.FromResult(LockOutcome.Locked);
        }
    }
    private readonly HashSet<string> _checked = new();
    public Task<bool> TryUseClashCheckAsync(string code) { lock (_gate) return Task.FromResult(_checked.Add(code)); }
    public Task<(string Code, int Side)?> SideByKeyHashAsync(string h) { lock (_gate) return Task.FromResult<(string, int)?>(_keys.TryGetValue(h, out var v) ? v : null); }
    public Task<int> CreatedSinceAsync(Guid? id, string? ip, DateTime since, bool vsCpu = false)
    {
        lock (_gate) return Task.FromResult(_ch.Values.Count(v => v.C.CreatedUtc > since && v.C.VsCpu == vsCpu && (id is { } g ? v.C.CreatorId == g : v.Ip == ip)));
    }
    public Task PurgeCpuGamesAsync(DateTime before)
    {
        lock (_gate) foreach (var k in _ch.Where(kv => kv.Value.C.VsCpu && kv.Value.C.CreatedUtc < before).Select(kv => kv.Key).ToList()) _ch.Remove(k);
        return Task.CompletedTask;
    }
    public Task<int> OpenCountAsync(Guid id, DateTime now)
    {
        lock (_gate) return Task.FromResult(_ch.Values.Count(v => v.C.CreatorId == id && v.C.Status == ChallengeStatus.Open && v.C.OpponentId is null && v.C.ExpiresUtc > now));
    }
    public Task<IReadOnlyList<ChallengeSummary>> MineAsync(Guid id, int take)
    {
        lock (_gate) return Task.FromResult<IReadOnlyList<ChallengeSummary>>(_ch.Values.Select(v => v.C).Where(c => c.CreatorId == id || c.OpponentId == id)
            .OrderByDescending(c => c.CreatedUtc).Take(take)
            .Select(c => new ChallengeSummary(c.Code, c.CreatorId == id ? 0 : 1, c.Status, c.CreatorName, c.OpponentName, c.CreatedUtc, c.ExpiresUtc, c.VsCpu)).ToList());
    }

    /// <summary>Test hook: push a challenge's expiry into the past.</summary>
    public void Age(string code) { lock (_gate) { var v = _ch[code]; _ch[code] = (v.C with { ExpiresUtc = DateTime.UtcNow.AddMinutes(-1) }, v.Ip); } }
}

/// <summary>Runs every scenario against the in-memory store; ChallengeSqlTests reruns them on a real SQL Server.</summary>
public class ChallengeApiTests
{
    protected virtual IChallengeStore NewStore() => new MemoryChallengeStore();

    protected virtual void Age(IChallengeStore store, string code) => ((MemoryChallengeStore)store).Age(code);

    [Fact]
    public async Task Expired_challenges_cannot_be_claimed_and_show_expired()
    {
        var store = NewStore();
        var f = Factory(store);
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator);
        Age(store, code);
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        var v = await friend.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("expired", v.GetProperty("status").GetString());
        Assert.False(v.GetProperty("canClaim").GetBoolean());
    }

    [Fact]
    public async Task Claims_on_different_challenges_at_once_all_succeed()
    {
        var f = Factory(NewStore());
        var creators = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Browser(f)));
        var codes = new List<string>();
        foreach (var c in creators) codes.Add((await Create(c)).Code);
        var friends = await Task.WhenAll(codes.Select(_ => Browser(f)));
        var results = await Task.WhenAll(codes.Select((code, i) => friends[i].PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"))));
        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
    }

    [Fact]
    public async Task A_retried_lock_from_the_winner_returns_the_same_game()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator);
        var first = await (await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"))).Content.ReadFromJsonAsync<JsonElement>();
        var retry = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var second = await retry.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(first.GetProperty("view").GetProperty("game").GetRawText(), second.GetProperty("view").GetProperty("game").GetRawText());
    }

    [Fact]
    public async Task Failed_claims_do_not_create_guests_and_rematch_hides_real_codes()
    {
        var store = NewStore();
        var f = Factory(store);
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator);
        await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        var late = await Browser(f);
        var r = await late.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
        Assert.DoesNotContain(r.Headers.TryGetValues("Set-Cookie", out var sc) ? sc : Array.Empty<string>(), h => h.StartsWith(Identity.GuestCookie + "="));
        var rm = await late.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.NotFound, rm.StatusCode);
        var once = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.OK, once.StatusCode);
        var twice = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.Conflict, twice.StatusCode);
    }

    [Fact]
    public async Task Similar_and_quickpick_give_valid_teams()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        var sim = await c.GetFromJsonAsync<JsonElement>("/api/challenges/similar?id=bat05&year=2000&role=bat");
        Assert.Equal(2, sim.GetArrayLength());
        Assert.DoesNotContain(sim.EnumerateArray(), x => x.GetProperty("id").GetString() == "bat05");
        var qp = await c.GetFromJsonAsync<JsonElement>("/api/challenges/quickpick");
        Assert.Equal(4, qp.GetArrayLength());
        var body = new { picks = qp.EnumerateArray().Select(sl => new { slot = sl.GetProperty("slot").GetInt32(),
            choices = sl.GetProperty("choices").EnumerateArray().Select(ch => new { id = ch.GetProperty("id").GetString(), year = ch.GetProperty("year").GetInt32() }).ToArray() }).ToArray() };
        var r = await c.PostAsJsonAsync("/api/challenges", body);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Clash_check_happens_once_per_challenge_even_for_a_new_browser()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var (code, _) = await Create(creator);
        var a = await Browser(f);
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat01", "bat05", "bat06"))).StatusCode);
        var b = await Browser(f);
        var probe = await b.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat07", "bat02", "bat06"));
        Assert.Equal(HttpStatusCode.OK, probe.StatusCode);   // no second warning: it locks and the backup or top-50 pick plays
    }

    [Fact]
    public async Task Computer_game_plays_at_once_with_no_shared_players_and_user_at_home()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        var r = await c.PostAsJsonAsync("/api/challenges/computer", Picks("pit01", "bat01", "bat02", "bat03", backup1: "bat10"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        var view = j.GetProperty("view");
        Assert.True(view.GetProperty("vsCpu").GetBoolean());
        Assert.Equal("creator", view.GetProperty("you").GetString());
        Assert.Equal("The Computer", view.GetProperty("opponentName").GetString());
        var game = view.GetProperty("game");
        var mine = new[] { "pit01", "bat01", "bat02", "bat03", "bat10" };
        Assert.DoesNotContain(game.GetProperty("lineups")[1].EnumerateArray(), p => mine.Contains(p.GetProperty("id").GetString()));
        Assert.Equal(1, game.GetProperty("atBats")[0].GetProperty("battingSide").GetInt32());   // computer bats first
        // Nobody can claim it, and it cannot be rematched.
        var code = j.GetProperty("code").GetString();
        var other = await Browser(f);
        Assert.Equal(HttpStatusCode.Conflict, (await other.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit02", "bat04", "bat05", "bat06"))).StatusCode);
        var list = await c.GetFromJsonAsync<JsonElement>("/api/challenges/mine");
        Assert.True(list[0].GetProperty("vsCpu").GetBoolean());
    }

    [Fact]
    public async Task Computer_games_do_not_use_up_friend_challenge_limits()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        for (var i = 0; i < ChallengeEndpoints.PerGuestPerDay + 2; i++)
            Assert.Equal(HttpStatusCode.OK, (await c.PostAsJsonAsync("/api/challenges/computer", Picks("pit01", "bat01", "bat02", "bat03"))).StatusCode);
        var (code, _) = await Create(c);   // still allowed
        Assert.False(string.IsNullOrEmpty(code));
    }

    [Fact]
    public async Task Computer_game_needs_the_anti_forgery_header()
    {
        var f = Factory(NewStore());
        var r = await f.CreateClient().PostAsJsonAsync("/api/challenges/computer", Picks("pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Null_picks_get_a_400_not_a_500()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        var r = await c.PostAsync("/api/challenges", new StringContent("{\"picks\":[null,{\"slot\":1,\"choices\":[null]}]}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
    }

    protected WebApplicationFactory<Program> Factory(IChallengeStore store) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "10000");
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IStatsSource, ChallengeStats>();
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<IChallengeStore>(store);
            });
        });

    /// <summary>A browser: its own cookie jar, and the anti-forgery header Angular would send.</summary>
    protected static async Task<HttpClient> Browser(WebApplicationFactory<Program> f)
    {
        var c = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var me = await c.GetAsync("/api/me");
        me.EnsureSuccessStatusCode();
        var xsrf = me.Headers.GetValues("Set-Cookie").First(h => h.StartsWith("XSRF-TOKEN=")).Split(';')[0]["XSRF-TOKEN=".Length..];
        c.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(xsrf));
        return c;
    }

    protected static object Picks(string p, string b1, string b2, string b3, string? backup1 = null) => new
    {
        picks = new object[]
        {
            new { slot = 0, choices = new[] { new { id = p, year = 2000 } } },
            new { slot = 1, choices = backup1 is null ? new[] { new { id = b1, year = 2000 } } : new[] { new { id = b1, year = 2000 }, new { id = backup1, year = 2000 } } },
            new { slot = 2, choices = new[] { new { id = b2, year = 2000 } } },
            new { slot = 3, choices = new[] { new { id = b3, year = 2000 } } },
        },
    };

    protected static async Task<(string Code, string Key)> Create(HttpClient c, object? body = null)
    {
        var r = await c.PostAsJsonAsync("/api/challenges", body ?? Picks("pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var j = await r.Content.ReadFromJsonAsync<JsonElement>();
        return (j.GetProperty("code").GetString()!, j.GetProperty("key").GetString()!);
    }

    [Fact]
    public async Task Two_guests_play_a_challenge_and_both_see_the_same_game()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator);
        Assert.Matches("^[A-Za-z0-9_-]{22}$", code);

        var view = await friend.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("visitor", view.GetProperty("you").GetString());
        Assert.True(view.GetProperty("canClaim").GetBoolean());

        var lockR = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.OK, lockR.StatusCode);
        var locked = await lockR.Content.ReadFromJsonAsync<JsonElement>();
        var friendGame = locked.GetProperty("view").GetProperty("game");
        Assert.Equal("opponent", locked.GetProperty("view").GetProperty("you").GetString());

        var creatorView = await creator.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("creator", creatorView.GetProperty("you").GetString());
        Assert.Equal("resolved", creatorView.GetProperty("status").GetString());
        Assert.Equal(friendGame.GetProperty("atBats").GetRawText(), creatorView.GetProperty("game").GetProperty("atBats").GetRawText());
        Assert.True(friendGame.GetProperty("atBats").GetArrayLength() >= 6);
    }

    [Fact]
    public async Task Before_the_game_nobody_else_sees_the_creators_picks()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var anon = f.CreateClient();
        var (code, _) = await Create(creator, Picks("pit03", "bat07", "bat08", "bat09", backup1: "bat10"));

        foreach (var c in new[] { friend, anon })
        {
            var raw = await c.GetStringAsync($"/api/challenges/{code}");
            foreach (var id in new[] { "pit03", "bat07", "bat08", "bat09", "bat10" }) Assert.DoesNotContain(id, raw);
            var mine = await c.GetStringAsync("/api/challenges/mine");
            Assert.DoesNotContain("pit03", mine);
        }
        var own = await creator.GetStringAsync($"/api/challenges/{code}");
        Assert.Contains("bat10", own);
    }

    [Fact]
    public async Task Only_one_friend_can_claim_and_the_creator_cannot()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var (code, _) = await Create(creator);
        var own = await creator.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        Assert.Equal(HttpStatusCode.Conflict, own.StatusCode);

        var friends = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Browser(f)));
        var results = await Task.WhenAll(friends.Select(fr => fr.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"))));
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(4, results.Count(r => r.StatusCode == HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task Opening_a_link_never_claims_it_or_creates_a_guest()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var (code, _) = await Create(creator);
        var bot = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var r = await bot.GetAsync($"/api/challenges/{code}");
        Assert.False(r.Headers.TryGetValues("Set-Cookie", out var cookies) && cookies.Any(c => c.StartsWith(Identity.GuestCookie + "=")));
        var again = await creator.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("open", again.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Changes_without_the_anti_forgery_header_are_refused()
    {
        var f = Factory(NewStore());
        var c = f.CreateClient();
        var r = await c.PostAsJsonAsync("/api/challenges", Picks("pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
    }

    [Fact]
    public async Task Private_link_shows_only_its_own_side_in_a_fresh_browser()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var (code, key) = await Create(creator, Picks("pit03", "bat07", "bat08", "bat09"));
        var otherPhone = f.CreateClient();
        otherPhone.DefaultRequestHeaders.Add("X-Side-Key", key);
        var v = await otherPhone.GetFromJsonAsync<JsonElement>($"/api/challenges/{code}");
        Assert.Equal("creator", v.GetProperty("you").GetString());
        Assert.False(v.GetProperty("canClaim").GetBoolean());
        Assert.Contains("bat07", v.GetRawText());

        var (code2, _) = await Create(creator);
        var wrong = await otherPhone.GetFromJsonAsync<JsonElement>($"/api/challenges/{code2}");
        Assert.Equal("visitor", wrong.GetProperty("you").GetString());
    }

    [Fact]
    public async Task Duplicate_picks_are_resolved_from_backups()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator, Picks("pit01", "bat01", "bat02", "bat03", backup1: "bat10"));
        var first = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat01", "bat05", "bat06", backup1: "bat11"));
        Assert.Equal(HttpStatusCode.Conflict, first.StatusCode);
        var clash = await first.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("clash", clash.GetProperty("error").GetString());
        Assert.Equal("bat01", Assert.Single(clash.GetProperty("clashes").EnumerateArray()).GetProperty("id").GetString());
        Assert.DoesNotContain("bat02", clash.GetRawText());
        // Second try with the same clash: no more warnings, the backup plays and the creator keeps bat01.
        var r = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat01", "bat05", "bat06", backup1: "bat11"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var game = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("view").GetProperty("game");
        Assert.Contains(game.GetProperty("lineups")[0].EnumerateArray(), p => p.GetProperty("id").GetString() == "bat01");
        Assert.Contains(game.GetProperty("lineups")[1].EnumerateArray(), p => p.GetProperty("id").GetString() == "bat11");
        var ids = game.GetProperty("lineups").EnumerateArray().SelectMany(l => l.EnumerateArray()).Select(p => p.GetProperty("id").GetString()).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Single(game.GetProperty("notes").EnumerateArray());
    }

    [Fact]
    public async Task Bad_picks_are_rejected()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        var noSeason = await c.PostAsJsonAsync("/api/challenges", Picks("bat01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, noSeason.StatusCode);
        var twice = await c.PostAsJsonAsync("/api/challenges", Picks("pit01", "bat01", "bat01", "bat03"));
        Assert.Equal(HttpStatusCode.BadRequest, twice.StatusCode);
    }

    [Fact]
    public async Task Rematch_is_claimable_only_by_the_original_opponent()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var stranger = await Browser(f);
        var (code, _) = await Create(creator);
        await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));

        var rm = await friend.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.OK, rm.StatusCode);
        var newCode = (await rm.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString();
        var s = await stranger.PostAsJsonAsync($"/api/challenges/{newCode}/lock", Picks("pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.Conflict, s.StatusCode);
        var ok = await creator.PostAsJsonAsync($"/api/challenges/{newCode}/lock", Picks("pit01", "bat01", "bat02", "bat03"));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var strangerRematch = await stranger.PostAsJsonAsync($"/api/challenges/{code}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.NotFound, strangerRematch.StatusCode);
    }

    [Fact]
    public async Task Mine_lists_both_roles()
    {
        var f = Factory(NewStore());
        var creator = await Browser(f);
        var friend = await Browser(f);
        var (code, _) = await Create(creator);
        await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        var mine = await friend.GetFromJsonAsync<JsonElement>("/api/challenges/mine");
        Assert.Equal("opponent", mine[0].GetProperty("you").GetString());
        Assert.Equal("resolved", mine[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task Guessing_codes_gets_blocked()
    {
        var f = Factory(NewStore());
        var c = f.CreateClient();
        HttpStatusCode last = HttpStatusCode.OK;
        for (var i = 0; i < 31; i++) last = (await c.GetAsync($"/api/challenges/{Identity.NewCode()}")).StatusCode;
        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }

    [Fact]
    public async Task Nickname_must_be_a_generated_one()
    {
        var f = Factory(NewStore());
        var c = await Browser(f);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsJsonAsync("/api/me", new { nickname = "Jimmy Smith" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.PutAsJsonAsync("/api/me", new { nickname = "Slugger 4821" })).StatusCode);
        var me = await c.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal("Slugger 4821", me.GetProperty("nickname").GetString());
    }
}

/// <summary>Same scenarios on a real SQL Server when PR_TEST_SQL holds a connection string (cloud workspace has one).</summary>
public class ChallengeSqlTests : ChallengeApiTests
{
    private static readonly string? Cs = Environment.GetEnvironmentVariable("PR_TEST_SQL");

    protected override IChallengeStore NewStore()
    {
        if (Cs is null) return new MemoryChallengeStore();
        var cfg = new Microsoft.Extensions.Configuration.ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["ConnectionStrings:Stats"] = Cs }).Build();
        var store = new SqlChallengeStore(cfg);
        store.GetAsync("warm-up-creates-tables").GetAwaiter().GetResult();
        // Each test starts clean so the per-address daily limits do not carry over between runs.
        using var c = new Microsoft.Data.SqlClient.SqlConnection(Cs);
        c.Open();
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand("DELETE dbo.ch_atbats; DELETE dbo.ch_picks; DELETE dbo.ch_keys; DELETE dbo.ch_challenges; DELETE dbo.ch_guests;", c);
        cmd.ExecuteNonQuery();
        return store;
    }

    protected override void Age(IChallengeStore store, string code)
    {
        if (store is MemoryChallengeStore m) { m.Age(code); return; }
        using var c = new Microsoft.Data.SqlClient.SqlConnection(Cs);
        c.Open();
        using var cmd = new Microsoft.Data.SqlClient.SqlCommand("UPDATE dbo.ch_challenges SET expires_utc = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE code = @c", c);
        cmd.Parameters.Add("@c", System.Data.SqlDbType.VarChar, 24).Value = code;
        cmd.ExecuteNonQuery();
    }
}

public class SqlKeyRepositoryTests
{
    [Fact]
    public void Keys_round_trip_through_sql()
    {
        var cs = Environment.GetEnvironmentVariable("PR_TEST_SQL");
        if (cs is null) return;
        var repo = new SqlKeyRepository(cs);
        var name = "key-" + Guid.NewGuid();
        repo.StoreElement(new System.Xml.Linq.XElement("key", new System.Xml.Linq.XAttribute("id", name)), name);
        Assert.Contains(repo.GetAllElements(), e => (string?)e.Attribute("id") == name);
    }
}
