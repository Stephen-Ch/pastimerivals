using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Engine;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 69: game status words, the result-waiting badge, and the counted share-back ("told").
/// Part of ChallengeApiTests, so ChallengeSqlTests reruns every scenario on a real SQL Server.</summary>
public partial class ChallengeApiTests
{
    private static async Task<Dictionary<string, JsonElement>> Mine(HttpClient c) =>
        (await c.GetFromJsonAsync<JsonElement[]>("/api/challenges/mine"))!.ToDictionary(e => e.GetProperty("code").GetString()!);

    private static string? Stage(Dictionary<string, JsonElement> m, string code) =>
        m[code].GetProperty("stage").ValueKind == JsonValueKind.Null ? null : m[code].GetProperty("stage").GetString();

    [Fact]
    public async Task Plan69_every_creator_row_in_order()
    {
        var store = NewStore();
        var f = Factory(store);
        var creator = await Browser(f);
        creator.DefaultRequestHeaders.Add("X-Test-Ip", "10.6.9.1");
        async Task<HttpClient> Friend(string ip) { var b = await Browser(f); b.DefaultRequestHeaders.Add("X-Test-Ip", ip); return b; }

        // Row 8: made, never sent.
        var (unsent, _) = await Create(creator);
        // Row 7: sent.
        var (sent, _) = await Create(creator);
        await creator.PostAsync($"/api/challenges/{sent}/sent", null);
        // Row 6: opened by a friend on another network.
        var (opened, _) = await Create(creator);
        await (await Friend("10.6.9.2")).GetAsync($"/api/challenges/{opened}");
        // Row 5: the friend started picking.
        var (picking, _) = await Create(creator);
        var picker = await Friend("10.6.9.3");
        await picker.GetAsync($"/api/challenges/{picking}");
        await picker.PostAsync($"/api/challenges/{picking}/picking", null);
        // Row 2: expired by time, nobody tried.
        var (expired, _) = await Create(creator);
        Age(store, expired);
        // Row 1: expired, a friend tried to open it late.
        var (late, _) = await Create(creator);
        Age(store, late);
        await (await Friend("10.6.9.4")).GetAsync($"/api/challenges/{late}");
        // Row 3: played, creator has not looked.
        var (played, _) = await Create(creator);
        var player = await Friend("10.6.9.5");
        Assert.Equal(HttpStatusCode.OK, (await player.PostAsJsonAsync($"/api/challenges/{played}/lock", Picks("pit02", "bat04", "bat05", "bat06"))).StatusCode);
        // Row 4: played and watched; then the creator sends a rematch.
        var (done, _) = await Create(creator);
        var doneFriend = await Friend("10.6.9.6");
        Assert.Equal(HttpStatusCode.OK, (await doneFriend.PostAsJsonAsync($"/api/challenges/{done}/lock", Picks("pit02", "bat04", "bat05", "bat06"))).StatusCode);
        await creator.GetAsync($"/api/challenges/{done}");

        var m = await Mine(creator);
        Assert.Equal(GameStage.Unsent, Stage(m, unsent));
        Assert.Equal(GameStage.Sent, Stage(m, sent));
        Assert.Equal(GameStage.Opened, Stage(m, opened));
        Assert.Equal(GameStage.Picking, Stage(m, picking));
        Assert.Equal(GameStage.Expired, Stage(m, expired));
        Assert.Equal(GameStage.ExpiredLate, Stage(m, late));
        Assert.Equal(GameStage.Result, Stage(m, played));
        Assert.Equal(GameStage.Done, Stage(m, done));
        Assert.False(m[done].GetProperty("rematchSent").GetBoolean());

        // Watching the result clears row 3.
        await creator.GetAsync($"/api/challenges/{played}");
        Assert.Equal(GameStage.Done, Stage(await Mine(creator), played));

        // Creator rematches "done": row 4 now says Rematch sent; the friend sees "Your friend wants a rematch".
        var rm = await creator.PostAsJsonAsync($"/api/challenges/{done}/rematch", Picks("pit03", "bat07", "bat08", "bat09"));
        Assert.Equal(HttpStatusCode.OK, rm.StatusCode);
        var rmCode = (await rm.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        Assert.True((await Mine(creator))[done].GetProperty("rematchSent").GetBoolean());
        var fm = await Mine(doneFriend);
        Assert.Equal(GameStage.YouPlayed, Stage(fm, done));
        Assert.False(fm[done].GetProperty("rematchSent").GetBoolean());
        Assert.Equal(GameStage.RematchForYou, Stage(fm, rmCode));
        // Once the friend plays it, the rematch row becomes an ordinary "You played" row.
        Assert.Equal(HttpStatusCode.OK, (await doneFriend.PostAsJsonAsync($"/api/challenges/{rmCode}/lock", Picks("pit02", "bat04", "bat05", "bat06"))).StatusCode);
        Assert.Equal(GameStage.YouPlayed, Stage(await Mine(doneFriend), rmCode));
        // A stranger never sees someone else's rematch.
        Assert.DoesNotContain(rmCode, (await Mine(await Friend("10.6.9.7"))).Keys);
    }

    [Fact]
    public async Task Plan69_computer_games_keep_old_rows_and_cannot_push_friend_games_off()
    {
        var store = NewStore();
        var f = Factory(store);
        var c = await Browser(f);
        var (friendGame, _) = await Create(c);
        var me = (await Mine(c))[friendGame];
        Assert.Equal(GameStage.Unsent, me.GetProperty("stage").GetString());
        // The guest id comes from the store: the friend game's creator.
        var guest = (await store.GetAsync(friendGame))!.CreatorId;
        var now = DateTime.UtcNow;
        for (var i = 0; i < 51; i++)
        {
            var code = $"cpu69-{i:D2}-{Guid.NewGuid():N}"[..22];
            await store.CreateChallengeAsync(new Challenge(code, guest, "Me", null, null, ChallengeStatus.Resolved, now.AddSeconds(i + 1), now.AddDays(7), null, null,
                new[] { 1, 0 }, 0, VsCpu: true, CpuLevel: 1), new List<StoredPick>(), "k" + i, new string('a', 64));
        }
        var list = await store.MineAsync(guest, ChallengeEndpoints.MineFriendGames, ChallengeEndpoints.MineCpuGames, DateTime.UtcNow);
        Assert.Contains(list, s => s.Code == friendGame);
        Assert.Equal(ChallengeEndpoints.MineCpuGames, list.Count(s => s.VsCpu));
        Assert.All(list.Where(s => s.VsCpu), s => Assert.Null(GameStage.Of(s, DateTime.UtcNow)));
        var m = await Mine(c);
        Assert.Contains(friendGame, m.Keys);
        Assert.All(m.Values.Where(v => v.GetProperty("vsCpu").GetBoolean()), v => Assert.Equal(JsonValueKind.Null, v.GetProperty("stage").ValueKind));
    }

    [Fact]
    public async Task Plan69_told_counts_once_from_the_friend_only()
    {
        var store = NewStore();
        var f = Factory(store);
        var admin = f.CreateClient();
        async Task<int[]> Totals()
        {
            var req = new HttpRequestMessage(HttpMethod.Get, "/api/admin/funnel?days=7"); req.Headers.Add("X-Funnel-Key", "test-funnel-key");
            var text = await (await admin.SendAsync(req)).Content.ReadAsStringAsync();
            Assert.Contains("told (share tapped)", text);
            return System.Text.RegularExpressions.Regex.Match(text, @"TOTAL((\s+\d+){8})").Groups[1].Value
                .Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(int.Parse).ToArray();
        }
        var before = await Totals();
        var creator = await Browser(f);
        creator.DefaultRequestHeaders.Add("X-Test-Ip", "10.6.8.1");
        var (code, _) = await Create(creator);
        var friend = await Browser(f);
        friend.DefaultRequestHeaders.Add("X-Test-Ip", "10.6.8.2");
        // Not played yet: nobody can tell.
        Assert.Equal(HttpStatusCode.NotFound, (await friend.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);
        var lk = await friend.PostAsJsonAsync($"/api/challenges/{code}/lock", Picks("pit02", "bat04", "bat05", "bat06"));
        var friendKey = (await lk.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("key").GetString()!;

        Assert.Equal(HttpStatusCode.NotFound, (await creator.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);
        var visitor = await Browser(f);
        visitor.DefaultRequestHeaders.Add("X-Test-Ip", "10.6.8.3");
        Assert.Equal(HttpStatusCode.NotFound, (await visitor.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await friend.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await friend.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);   // double tap
        var otherDevice = await Browser(f);                                                                                   // friend's private link only
        otherDevice.DefaultRequestHeaders.Add("X-Side-Key", friendKey);
        Assert.Equal(HttpStatusCode.NoContent, (await otherDevice.PostAsync($"/api/challenges/{code}/told", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await friend.PostAsync("/api/challenges/AAAAAAAAAAAAAAAAAAAAAA/told", null)).StatusCode);

        // Computer games never count.
        var cpu = await creator.PostAsJsonAsync("/api/challenges/computer", Picks("pit01", "bat01", "bat02", "bat03"));
        var cpuCode = (await cpu.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        Assert.Equal(HttpStatusCode.NotFound, (await creator.PostAsync($"/api/challenges/{cpuCode}/told", null)).StatusCode);

        var after = await Totals();
        Assert.Equal(1, after[7] - before[7]);
        Assert.True((await Mine(creator)).ContainsKey(code));
    }

    [Fact]
    public void Plan69_stage_function_covers_every_row()
    {
        var now = new DateTime(2026, 11, 22, 12, 0, 0, DateTimeKind.Utc);
        ChallengeSummary S(ChallengeStatus st, GameSteps steps, int side = 0, string? opp = null, DateTime? exp = null, bool cpu = false, bool forYou = false) =>
            new("c", side, st, "A", opp, now.AddHours(-1), exp ?? now.AddDays(1), cpu, Rules.Classic, steps, false, forYou);
        Assert.Equal(GameStage.ExpiredLate, GameStage.Of(S(ChallengeStatus.Expired, new(OpenedExpired: true)), now));
        Assert.Equal(GameStage.Expired, GameStage.Of(S(ChallengeStatus.Expired, new(Sent: true, Opened: true)), now));
        Assert.Equal(GameStage.Result, GameStage.Of(S(ChallengeStatus.Resolved, new(Played: true), opp: "B"), now));
        Assert.Equal(GameStage.Done, GameStage.Of(S(ChallengeStatus.Resolved, new(Played: true, Watched: true), opp: "B"), now));
        Assert.Equal(GameStage.Done, GameStage.Of(S(ChallengeStatus.Resolved, default, opp: "B"), now));   // old game, no played step: no badge
        Assert.Equal(GameStage.Picking, GameStage.Of(S(ChallengeStatus.Open, new(Sent: true, Opened: true, Picking: true)), now));
        Assert.Equal(GameStage.Opened, GameStage.Of(S(ChallengeStatus.Open, new(Sent: true, Opened: true)), now));
        Assert.Equal(GameStage.Sent, GameStage.Of(S(ChallengeStatus.Open, new(Sent: true)), now));
        Assert.Equal(GameStage.Unsent, GameStage.Of(S(ChallengeStatus.Open, default), now));
        // Open, no opponent, past expiry: expired by time even though the stored status is still open.
        Assert.Equal(GameStage.Expired, GameStage.Of(S(ChallengeStatus.Open, new(Sent: true), exp: now.AddMinutes(-1)), now));
        Assert.Equal(GameStage.ExpiredLate, GameStage.Of(S(ChallengeStatus.Open, new(OpenedExpired: true), exp: now.AddMinutes(-1)), now));
        Assert.Null(GameStage.Of(S(ChallengeStatus.Resolved, new(Played: true), opp: "Computer", cpu: true), now));
        Assert.Equal(GameStage.YouPlayed, GameStage.Of(S(ChallengeStatus.Resolved, new(Played: true), side: 1, opp: "B"), now));
        Assert.Equal(GameStage.RematchForYou, GameStage.Of(S(ChallengeStatus.Open, default, side: 1, forYou: true), now));
        Assert.True(GameStage.Waiting(GameStage.Result));
        Assert.True(GameStage.Waiting(GameStage.RematchForYou));
        Assert.False(GameStage.Waiting(GameStage.Done));
        Assert.False(GameStage.Waiting(null));
    }
}
