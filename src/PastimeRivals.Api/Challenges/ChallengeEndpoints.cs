using Microsoft.AspNetCore.Antiforgery;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

public sealed record PickChoiceIn(string Id, int Year);
public sealed record SlotIn(int Slot, List<PickChoiceIn> Choices);
public sealed record FeedbackIn(string? Vote, string? Where, int? Level, string? Result, string? Mode = null);
public sealed record FeedbackReasonsIn(string[]? Reasons);
/// <summary>Mode (plan 38): "classic" or "inning"; old apps send none, which means classic.</summary>
public sealed record PicksIn(List<SlotIn> Picks, string? Nickname, string? Turnstile, int? Level = null, int? Deco = null, string? Mode = null);
public sealed record NicknameIn(string Nickname);

public sealed record PlayerOut(string Id, int Year, string Name, string Bats = "R", string Throws = "R", string Bio = "");
public sealed record SlotOut(int Slot, IReadOnlyList<PlayerOut> Choices);
public sealed record AtBatOut(int Index, int Round, int BattingSide, PlayerOut Pitcher, PlayerOut Batter, string Seed, string Outcome, int Points,
    int? Inning = null, int? Spot = null, int? OutsBefore = null, int? OutsAfter = null, string?[]? BasesBefore = null, string?[]? BasesAfter = null,
    string? OutType = null, IReadOnlyList<string>? Scored = null);
public sealed record GameOut(IReadOnlyList<IReadOnlyList<PlayerOut>> Lineups, IReadOnlyList<AtBatOut> AtBats, int[] Totals, int Winner, IReadOnlyList<string> Notes,
    int[][]? LineScore = null, int? Innings = null, IReadOnlyList<IReadOnlyList<string>>? LineupSources = null);
/// <summary>Plan 38: the game's era rules (shown before the game too: the friend needs to know 8 or 9 batters).</summary>
public sealed record EraOut(bool Dh, bool RunnerOnSecond, int Season, int Batters)
{
    public static EraOut Of(EraRules e) => new(e.DesignatedHitter, e.RunnerOnSecondInExtras, e.Season, e.PickedBatters);
}
public sealed record ChallengeView(string Code, string Status, string You, string CreatorName, string? OpponentName, DateTime ExpiresUtc,
    bool CanClaim, string? RematchOf, IReadOnlyList<SlotOut>? YourPicks, GameOut? Game, bool VsCpu = false, int CpuLevel = 1, int Deco = 1,
    string Mode = Rules.Classic, EraOut? Era = null);
public sealed record CreatedOut(string Code, string Key);

public static class ChallengeEndpoints
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(72);
    // Counted then inserted without a lock, so a burst of parallel requests can overshoot by a few (accepted).
    public const int PerGuestPerDay = 20, PerIpPerDay = 200, MaxOpen = 50, GuestsPerIpPerDay = 300;
    public const int CpuPerGuestPerDay = 50, CpuPerIpPerDay = 200;
    /// <summary>The computer's fixed id (plan 25). Never a real guest.</summary>
    public static readonly Guid ComputerId = new("00000000-0000-0000-0000-00000000c0de");
    public const string ComputerName = "The Computer";

    private static string Salt(IConfiguration cfg) => cfg["Challenges:IpSalt"] ?? "local-dev-only";

    public static void MapChallenges(this WebApplication app)
    {
        // Challenge replies change as the game moves on; browsers must never show a saved copy on back/forward.
        var api = app.MapGroup("/api").RequireRateLimiting("per-ip").AddEndpointFilter(async (ic, next) =>
        {
            ic.HttpContext.Response.Headers.CacheControl = "no-store";
            return await next(ic);
        });

        // Suggested backups for a pick (plan 24: filled in automatically, the player can change them).
        api.MapGet("/challenges/similar", async (string id, int year, string role, PlayService play) =>
        {
            var list = new List<PlayerOut>();
            foreach (var r in await play.SimilarAsync(id, year, role == "pit")) list.Add(await Out(play, r, bioRole: role == "pit" ? "pit" : "bat"));
            return Results.Ok(list);
        });

        // Quick pick (plan 26): a fully random team (random era, then a random real-workload season), each with suggested backups.
        // Plan 38: ?mode=inning returns { era, slots }. batters=8|9 (the friend, whose size is fixed by the stored era) draws
        // exactly that many. Without it (a home team) it draws 9, and drops one when the drawn team's era has no DH.
        api.MapGet("/challenges/quickpick", async (string? mode, int? batters, PlayService play) =>
        {
            var inning = mode == Rules.Inning;
            if (batters is { } nb && (!inning || nb is not (8 or 9))) return Results.BadRequest();
            var oracle = await play.OracleAsync();
            for (var attempt = 0; ; attempt++)
            {
                var drawn = await QuickTeam(oracle, play, inning ? (batters ?? 9) : Rules.Slots - 1);
                if (drawn is null) return Results.Problem("Player data is still loading. Try again.", statusCode: 503);
                if (!inning) return Results.Ok(drawn);
                EraRules Era(List<SlotOut> t) => Rules.EraFrom(t.Select(x => new SlotPick(x.Slot, new[] { new PickRef(x.Choices[0].Id, x.Choices[0].Year) })).ToList(), oracle);
                var era = Era(drawn);
                if (batters is { } want)
                    return Results.Ok(new { era = (EraOut?)null, batters = want, slots = drawn });
                if (era.DesignatedHitter) return Results.Ok(new { era = EraOut.Of(era), batters = 9, slots = drawn });
                if (EightFromNine(drawn, oracle) is { } eight) return Results.Ok(new { era = EraOut.Of(Era(eight)), batters = 8, slots = eight });
                if (attempt >= 20) return Results.Problem("Could not draw a team. Try again.", statusCode: 503);
            }
        });

        // Plan 38: era rules for a home team being picked: p = pitcher "id:year", b = batters "id:year" (first choices).
        api.MapGet("/challenges/era", async (string? p, string[]? b, HttpContext ctx, PlayService play, MissCounter misses) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            var refs = new List<SlotPick>();
            var all = new[] { p }.Concat(b ?? Array.Empty<string>()).ToList();
            if (p is null || all.Count > 10) return Results.BadRequest();
            for (var i = 0; i < all.Count; i++)
            {
                var parts = all[i]?.Split(':');
                if (parts is not { Length: 2 } || parts[0].Length is < 1 or > 12 || !int.TryParse(parts[1], out var y)) return Results.BadRequest();
                if (!await play.SeasonExistsAsync(parts[0], y, pitcher: i == 0)) { misses.Miss(ip); return Results.BadRequest(); }
                refs.Add(new SlotPick(i, new[] { new PickRef(parts[0], y) }));
            }
            return Results.Ok(EraOut.Of(Rules.EraFrom(refs, await play.OracleAsync())));
        });

        // Reading never creates a guest; it hands out the anti-forgery token the app sends back on every change.
        api.MapGet("/me", async (HttpContext ctx, IChallengeStore store, IAntiforgery af) =>
        {
            IssueXsrf(ctx, af);
            var g = await CurrentGuest(ctx, store);
            return Results.Ok(new { nickname = g?.Nickname, choices = Identity.NicknameChoices() });
        });

        var write = api.MapGroup("").AddEndpointFilter(async (ic, next) =>
        {
            var af = ic.HttpContext.RequestServices.GetRequiredService<IAntiforgery>();
            return await af.IsRequestValidAsync(ic.HttpContext) ? await next(ic) : Results.StatusCode(StatusCodes.Status403Forbidden);
        });

        write.MapPut("/me", async (NicknameIn body, HttpContext ctx, IChallengeStore store, IConfiguration cfg) =>
        {
            if (!Identity.IsGeneratedNickname(body.Nickname)) return Results.BadRequest(new { error = "Pick one of the suggested names." });
            var g = await CurrentGuest(ctx, store);
            if (g is null)
            {
                if (await NewGuest(ctx, store, body.Nickname, cfg) is null) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            }
            else await store.SetNicknameAsync(g.Id, body.Nickname);
            return Results.Ok(new { nickname = body.Nickname });
        });

        write.MapPost("/challenges", async (PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, Turnstile ts, IConfiguration cfg) =>
            await Create(body, ctx, store, play, ts, cfg, rematchOf: null));

        api.MapGet("/challenges/mine", async (HttpContext ctx, IChallengeStore store) =>
        {
            var g = await CurrentGuest(ctx, store);
            if (g is null) return Results.Ok(Array.Empty<object>());
            var list = await store.MineAsync(g.Id, 50);
            var now = DateTime.UtcNow;
            return Results.Ok(list.Select(s => new
            {
                s.Code, you = s.Side == 0 ? "creator" : "opponent", s.CreatorName, s.OpponentName, s.CreatedUtc, s.VsCpu, s.Mode,
                status = s.Status == ChallengeStatus.Open && s.OpponentName is null && s.ExpiresUtc <= now ? "expired" : s.Status.ToString().ToLowerInvariant(),
            }));
        });

        api.MapGet("/challenges/{code}", async (string code, HttpContext ctx, IChallengeStore store, PlayService play, MissCounter misses, IConfiguration cfg) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch)
            {
                misses.Miss(ip);
                return Results.NotFound();
            }
            var view = await ViewFor(ch, ctx, store, play, misses);
            // Plan 29 funnel: a friend (not the creator by cookie, private key or address) opened it; the creator watched the result.
            if (!ch.VsCpu)
            {
                if (view.You == "visitor") await Funnel(store, code, view.Status == "expired" ? "opened_expired" : "opened", Identity.IpHash(ctx, Salt(cfg)));
                else if (view.You == "creator" && view.Status == "resolved") await Funnel(store, code, "watched");
            }
            return Results.Ok(view);
        });

        // Plan 29: the creator sent or copied the link (shared and waiting screens).
        write.MapPost("/challenges/{code}/sent", async (string code, HttpContext ctx, IChallengeStore store, MissCounter misses) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch) { misses.Miss(ip); return Results.NotFound(); }
            if (await SideOf(ch, ctx, store) != 0) return Results.NotFound();
            await Funnel(store, code, "sent");
            return Results.NoContent();
        });

        // Plan 29: the friend started picking (intro screen: "Pick your team" or "Quick pick").
        write.MapPost("/challenges/{code}/picking", async (string code, HttpContext ctx, IChallengeStore store, MissCounter misses, IConfiguration cfg) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch) { misses.Miss(ip); return Results.NotFound(); }
            if (ch.VsCpu || ch.Status != ChallengeStatus.Open || await SideOf(ch, ctx, store) == 0) return Results.NoContent();
            await Funnel(store, code, "picking", Identity.IpHash(ctx, Salt(cfg)));
            return Results.NoContent();
        });

        // Plan 30: one-tap feedback. Fixed choices only (no free text until the age screen and privacy policy exist).
        write.MapPost("/feedback", async (FeedbackIn body, HttpContext ctx, IChallengeStore store, IConfiguration cfg) =>
        {
            if (body.Vote is not ("up" or "down") || body.Where is not ("cpu" or "friend" or "practice")) return Results.BadRequest();
            if (body.Level is { } lv && (lv < Rules.MinLevel || lv > Rules.MaxLevel)) return Results.BadRequest();
            if (body.Result is not (null or "win" or "loss" or "draw")) return Results.BadRequest();
            var mode = body.Mode is Rules.Classic or Rules.Inning ? body.Mode : null;
            var id = await store.AddFeedbackAsync(new FeedbackRow(body.Vote, body.Where, body.Where == "cpu" ? body.Level : null, body.Result, EngineInfo.Version, mode),
                Identity.IpHash(ctx, Salt(cfg)), DateTime.UtcNow, FeedbackPerIpPerDay);
            return id is null ? Results.StatusCode(StatusCodes.Status429TooManyRequests) : Results.Ok(new { id });
        });
        write.MapPost("/feedback/{id:guid}", async (Guid id, FeedbackReasonsIn body, HttpContext ctx, IChallengeStore store, IConfiguration cfg) =>
        {
            var keys = (body.Reasons ?? Array.Empty<string>()).Distinct().ToList();
            if (keys.Count == 0 || keys.Count > 4 || (!keys.All(FeedbackUp.Contains) && !keys.All(FeedbackDown.Contains))) return Results.BadRequest();
            var ok = await store.SetFeedbackReasonsAsync(id, string.Join(",", keys), Identity.IpHash(ctx, Salt(cfg)), DateTime.UtcNow);
            return ok ? Results.NoContent() : Results.NotFound();
        });

        // Plan 29: funnel readout, plain text. Hidden (404) unless Funnel:Key is set and given.
        api.MapGet("/admin/funnel", async (int? days, HttpRequest req, IChallengeStore store, IConfiguration cfg) =>
        {
            var key = cfg["Funnel:Key"];
            var given = req.Headers["X-Funnel-Key"].ToString();
            if (string.IsNullOrEmpty(key) || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                    System.Text.Encoding.UTF8.GetBytes(given), System.Text.Encoding.UTF8.GetBytes(key)))
                return Results.NotFound();
            var n = Math.Clamp(days ?? 30, 1, 365);
            var r = await store.FunnelReportAsync(DateTime.UtcNow.Date.AddDays(1 - n));
            req.HttpContext.Response.Headers["X-Content-Type-Options"] = "nosniff";
            return Results.Text(FunnelText(r, n), "text/plain; charset=utf-8");
        });

        write.MapPost("/challenges/{code}/lock", async (string code, PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, Turnstile ts, MissCounter misses, IConfiguration cfg) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } before) { misses.Miss(ip); return Results.NotFound(); }
            // Plan 38: an app that does not know this game's mode (an old app on an inning link) is told to refresh.
            if (ModeOf(body) != before.Mode) return Results.Conflict(new { error = "update" });
            if (!await ts.PassesAsync(body.Turnstile, ctx)) return Results.BadRequest(new { error = "Bot check failed. Try again." });
            if (await CheckPicks(body.Picks, play, before.Era) is { } err) return Results.BadRequest(err);
            if (body.Nickname is not null && !Identity.IsGeneratedNickname(body.Nickname)) return Results.BadRequest(new { error = "Pick one of the suggested names." });

            var current = await CurrentGuest(ctx, store);
            // A retried lock from the friend who already won the claim (lost response) gets the game back, with a fresh private key.
            if (current is not null && before.OpponentId == current.Id)
            {
                var again = Identity.NewToken();
                await store.AddKeyAsync(code, 1, Identity.Hash(again));
                return Results.Ok(new { key = again, view = await ViewFor(before, ctx, store, play, misses, asGuest: current) });
            }
            // Refuse before creating a guest, so failed claims never add rows.
            if (before.Status != ChallengeStatus.Open || before.OpponentId is not null) return Results.Conflict(new { error = before.Status == ChallengeStatus.Expired ? "expired" : "taken" });
            if (before.ExpiresUtc <= DateTime.UtcNow) return Results.Conflict(new { error = "expired" });
            if (current is not null && current.Id == before.CreatorId) return Results.Conflict(new { error = "own" });
            if (before.RematchFor is { } rf && rf != current?.Id) return Results.Conflict(new { error = "not_for_you" });

            // D26: the challenger keeps any player both picked. Once per challenge, the friend is told which of their
            // first choices are taken so they can choose again; after that, their backups play. Only clashing players
            // are named, and only once, so the challenger's team cannot be found by trial and error.
            var creatorFirsts = (await store.PicksAsync(code)).Where(p => p.Side == 0 && p.Rank == 0).Select(p => p.PlayerId).ToHashSet();
            // Plan 38: an inning team has 10 slots; the notice names at most 3 (classic is unchanged: at most 4 slots).
            var clashes = body.Picks.Where(p => creatorFirsts.Contains(p.Choices[0].Id)).Take(before.Mode == Rules.Inning ? 3 : int.MaxValue).ToList();
            if (clashes.Count > 0 && await store.TryUseClashCheckAsync(code))
            {
                var named = new List<object>();
                foreach (var c in clashes) named.Add(new { slot = c.Slot, id = c.Choices[0].Id, name = await play.NameAsync(c.Choices[0].Id) ?? c.Choices[0].Id });
                return Results.Conflict(new { error = "clash", creatorName = before.CreatorName, clashes = named });
            }

            var g = current ?? await NewGuest(ctx, store, body.Nickname ?? Identity.NewNickname(), cfg);
            if (g is null) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (body.Nickname is not null && body.Nickname != g.Nickname) { await store.SetNicknameAsync(g.Id, body.Nickname); g = g with { Nickname = body.Nickname }; }
            var key = Identity.NewToken();
            var oracle = await play.OracleAsync();
            oracle.Top50(true); oracle.Top50(false); oracle.Warm(); // build the fallback pools and pitcher batting before the claim transaction starts
            var outcome = await store.LockAndResolveAsync(code, g.Id, g.Nickname, ToStored(body.Picks, side: 1), Identity.Hash(key), DateTime.UtcNow,
                all => PlayGame(before, all, PlayService.NewSeed(), oracle));
            switch (outcome)
            {
                case LockOutcome.NotFound: misses.Miss(ip); return Results.NotFound();
                case LockOutcome.Taken: return Results.Conflict(new { error = "taken" });
                case LockOutcome.Expired: return Results.Conflict(new { error = "expired" });
                case LockOutcome.OwnChallenge: return Results.Conflict(new { error = "own" });
                case LockOutcome.NotForYou: return Results.Conflict(new { error = "not_for_you" });
            }
            var ch = (await store.GetAsync(code))!;
            await Funnel(store, code, "played");
            return Results.Ok(new { key, view = await ViewFor(ch, ctx, store, play, misses, asGuest: g) });
        });

        // Plan 25: play the computer. The user is the home side (keeps every pick); the computer bats first.
        write.MapPost("/challenges/computer", async (PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, IConfiguration cfg, MissCounter misses) =>
        {
            if (ModeOf(body) is not { } mode) return Results.BadRequest(new { error = "Unknown game mode." });
            var oracle0 = await play.OracleAsync();
            var era = mode == Rules.Inning ? EraOfBody(body, oracle0) : null;
            if (mode == Rules.Inning && era is null) return Results.BadRequest(new { error = "Pick 1 pitcher and 8 or 9 batters." });
            if (await CheckPicks(body.Picks, play, era) is { } err) return Results.BadRequest(err);
            if (body.Nickname is not null && !Identity.IsGeneratedNickname(body.Nickname)) return Results.BadRequest(new { error = "Pick one of the suggested names." });
            var now = DateTime.UtcNow;
            var ipHash = Identity.IpHash(ctx, Salt(cfg));
            var g = await CurrentGuest(ctx, store);
            if (g is not null && await store.CreatedSinceAsync(g.Id, null, now.AddDays(-1), vsCpu: true) >= CpuPerGuestPerDay) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (await store.CreatedSinceAsync(null, ipHash, now.AddDays(-1), vsCpu: true) >= CpuPerIpPerDay) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            g ??= await NewGuest(ctx, store, body.Nickname ?? Identity.NewNickname(), cfg);
            if (g is null) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (body.Nickname is not null && body.Nickname != g.Nickname) { await store.SetNicknameAsync(g.Id, body.Nickname); g = g with { Nickname = body.Nickname }; }

            var oracle = await play.OracleAsync();
            var level = Math.Clamp(body.Level ?? Rules.MinLevel, Rules.MinLevel, Rules.MaxLevel);
            // The computer never uses any of the user's players, in any season or role (all 12 picks).
            var used = body.Picks.SelectMany(p => p.Choices).Select(c => c.Id).ToHashSet();
            var cpu = new List<StoredPick>();
            for (var slot = 0; slot < (era is null ? Rules.Slots : era.PickedBatters + 1); slot++)
            {
                if (Rules.DrawAtLevel(oracle, slot == 0, level, used, Rnd) is not { } pick)
                    return Results.Problem("Player data is still loading. Try again.", statusCode: 503);
                used.Add(pick.Id);
                cpu.Add(new StoredPick(1, slot, 0, pick.Id, pick.Year));
            }
            oracle.Top50(true); oracle.Top50(false); oracle.Warm();

            var code = Identity.NewCode();
            var key = Identity.NewToken();
            // Reserved for the computer, so nobody else can ever claim it.
            var ch = new Challenge(code, g.Id, g.Nickname, null, null, ChallengeStatus.Open, now, now + Lifetime, ComputerId, null, null, null, VsCpu: true, CpuLevel: level,
                Deco: DecoOf(body, mode), Mode: mode, Era: era);
            await store.CreateChallengeAsync(ch, ToStored(body.Picks, side: 0), Identity.Hash(key), ipHash);
            var outcome = await store.LockAndResolveAsync(code, ComputerId, ComputerName, cpu, Identity.Hash(Identity.NewToken()), now,
                all => PlayGame(ch, all, PlayService.NewSeed(), oracle));
            if (outcome != LockOutcome.Locked) return Results.Problem("Could not start the game. Try again.", statusCode: 500);
            try { await store.PurgeCpuGamesAsync(now.AddDays(-30)); } catch { /* retention is best effort */ }
            var view = await ViewFor((await store.GetAsync(code))!, ctx, store, play, misses, asGuest: g);
            return Results.Ok(new { code, key, view });
        });

        write.MapPost("/challenges/{code}/rematch", async (string code, PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, Turnstile ts, IConfiguration cfg, MissCounter misses) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            var g = await CurrentGuest(ctx, store);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch
                || g is null || ch.Status != ChallengeStatus.Resolved || ch.VsCpu || (g.Id != ch.CreatorId && g.Id != ch.OpponentId))
            {
                misses.Miss(ip);
                return Results.NotFound();
            }
            if (await store.RematchExistsAsync(code, g.Id)) return Results.Conflict(new { error = "already" });
            // Plan 38: a rematch keeps the game's mode (its era is worked out again from the new home side's picks).
            if (ModeOf(body) != ch.Mode) return Results.Conflict(new { error = "update" });
            var other = g.Id == ch.CreatorId ? ch.OpponentId : ch.CreatorId;
            return await Create(body, ctx, store, play, ts, cfg, rematchOf: (code, other));
        });
    }

    /// <summary>Plan 32A: decoration version the creating app used (count and call text). Old apps send none = 1.</summary>
    internal static int DecoOf(PicksIn body, string mode = Rules.Classic) =>
        mode == Rules.Inning ? Rules.InningDeco : body.Deco is { } d && d >= 1 && d <= 9 ? d : 1;

    /// <summary>Plan 38: "classic" when the app sends no mode (old apps), null when the mode is unknown.</summary>
    internal static string? ModeOf(PicksIn body) => body.Mode switch { null or Rules.Classic => Rules.Classic, Rules.Inning => Rules.Inning, _ => null };

    /// <summary>Plan 38: era rules from a home side's first choices as sent (null when the picks are too broken to read).</summary>
    private static EraRules? EraOfBody(PicksIn body, IMatchupOracle oracle)
    {
        if (body.Picks is null || body.Picks.Count is 0 or > 10 || body.Picks.Any(p => p?.Choices is not { Count: > 0 } || p.Choices[0] is null)) return null;
        return Rules.EraFrom(body.Picks.Select(p => new SlotPick(p.Slot, new[] { new PickRef(p.Choices[0].Id, p.Choices[0].Year) })).ToList(), oracle);
    }

    private static GameResult PlayGame(Challenge ch, IReadOnlyList<StoredPick> all, ulong seed, IMatchupOracle oracle) =>
        ch.Mode == Rules.Inning
            ? Rules.PlayInning(new[] { ToSlots(all, 0), ToSlots(all, 1) }, seed, oracle, ch.Era!)
            : Rules.Play(new[] { ToSlots(all, 0), ToSlots(all, 1) }, seed, oracle);

    /// <summary>Plan 29: funnel counts never break the request they ride on.</summary>
    private static async Task Funnel(IChallengeStore store, string code, string step, string? notFromIp = null)
    {
        try { await store.FunnelAsync(code, step, notFromIp); } catch { /* counting is best effort */ }
    }

    /// <summary>0 creator, 1 friend, null anyone else: by guest cookie, else by private key (same rule as ViewFor).</summary>
    private static async Task<int?> SideOf(Challenge ch, HttpContext ctx, IChallengeStore store)
    {
        var g = await CurrentGuest(ctx, store);
        if (g is not null && g.Id == ch.CreatorId) return 0;
        if (g is not null && g.Id == ch.OpponentId) return 1;
        if (ctx.Request.Headers.TryGetValue("X-Side-Key", out var k) && Identity.KeyPattern().IsMatch(k.ToString())
            && await store.SideByKeyHashAsync(Identity.Hash(k.ToString())) is { } h && h.Code == ch.Code) return h.Side;
        return null;
    }

    public static string FunnelText(FunnelReport r, int days)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"Pastime Rivals funnel, last {days} days (UTC; friend challenges grouped by the day they were created)");
        sb.AppendLine("day         kind     mode     created  sent  opened  opened-late  picking  played  watched");
        foreach (var d in r.Days)
            sb.AppendLine($"{d.Day:yyyy-MM-dd}  {(d.Rematch ? "rematch" : "first  ")}  {d.Mode,-7}  {d.Created,7}  {d.Sent,4}  {d.Opened,6}  {d.OpenedExpired,11}  {d.Picking,7}  {d.Played,6}  {d.Watched,7}");
        int T(Func<FunnelDay, int> f) => r.Days.Sum(f);
        sb.AppendLine($"TOTAL                          {T(d => d.Created),7}  {T(d => d.Sent),4}  {T(d => d.Opened),6}  {T(d => d.OpenedExpired),11}  {T(d => d.Picking),7}  {T(d => d.Played),6}  {T(d => d.Watched),7}");
        sb.AppendLine($"Spread (friends who played and later made their own challenge): {r.Spread}");
        sb.AppendLine($"Computer games (kept 30 days): {r.Computer.Sum(c => c.Games)}" + (r.Computer.Count > 0 ? " | " + string.Join(", ", r.Computer.Select(c => $"{c.Day:MM-dd} {c.Games}")) : ""));
        sb.AppendLine("App opens by source: " + (r.Sources.Count == 0 ? "none yet" : string.Join(", ", r.Sources.Select(s => $"{s.Source} {s.Opens}"))));
        if (r.Feedback is { } fb)
        {
            int V(string v) => fb.Votes.Where(x => x.Vote == v).Sum(x => x.N);
            sb.AppendLine($"Feedback: {V("up")} yes, {V("down")} no" + (fb.Votes.Count == 0 ? "" : " | " + string.Join(", ", fb.Votes.Select(x => $"{x.Where} {x.Vote} {x.Result} {x.N}"))));
            if (fb.Reasons.Count > 0) sb.AppendLine("Reasons: " + string.Join(", ", fb.Reasons.Select(x => $"{x.Vote}:{x.Reason} {x.N}")));
        }
        return sb.ToString();
    }

    public const int FeedbackPerIpPerDay = 10;
    /// <summary>Plan 30 reason keys: thumbs up "What do you like?", thumbs down "What would make it better?".</summary>
    public static readonly HashSet<string> FeedbackUp = new() { "oldtime", "friends", "quick", "animation" };
    public static readonly HashSet<string> FeedbackDown = new() { "hard", "confusing", "slow", "players" };

    private static int Rnd(int n) => System.Security.Cryptography.RandomNumberGenerator.GetInt32(n);

    /// <summary>
    /// Plan 38: a drawn home team of 9 batters whose era has no DH loses its oldest-season batter (never the newest, who
    /// set the rules) and is renumbered. Null if the rules would change (cannot happen with today's rules; then draw again).
    /// </summary>
    public static List<SlotOut>? EightFromNine(List<SlotOut> nine, IMatchupOracle oracle)
    {
        EraRules Era(List<SlotOut> t) => Rules.EraFrom(t.Select(x => new SlotPick(x.Slot, new[] { new PickRef(x.Choices[0].Id, x.Choices[0].Year) })).ToList(), oracle);
        var before = Era(nine);
        var drop = nine.Skip(1).OrderBy(x => x.Choices[0].Year).ThenBy(x => x.Slot).First();
        var eight = nine.Where(x => x != drop).Select((x, i) => new SlotOut(i, x.Choices)).ToList();
        var after = Era(eight);
        return after == before ? eight : null;
    }

    /// <summary>Quick pick (plan 26): slot 0 a random pitcher, then that many random batters, each with 2 suggested backups. Null while data loads.</summary>
    private static async Task<List<SlotOut>?> QuickTeam(IMatchupOracle oracle, PlayService play, int batters)
    {
        var used = new HashSet<string>();
        var slots = new List<SlotOut>();
        for (var slot = 0; slot <= batters; slot++)
        {
            var role = slot == 0 ? "pit" : "bat";
            if (Rules.DrawAtLevel(oracle, slot == 0, Rules.MinLevel, used, Rnd) is not { } first) return null;
            used.Add(first.Id);
            var choices = new List<PlayerOut> { await Out(play, first, role) };
            foreach (var b in await play.SimilarAsync(first.Id, first.Year, slot == 0, 2, used)) { choices.Add(await Out(play, b, role)); used.Add(b.Id); }
            slots.Add(new SlotOut(slot, choices));
        }
        return slots;
    }

    /// <summary>bioRole "pit" or "bat" adds the plan 26 bio line (pick screens only; game views stay small).</summary>
    private static async Task<PlayerOut> Out(PlayService play, PickRef r, string? bioRole = null) =>
        await play.PersonAsync(r.Id) is { } p
            ? new PlayerOut(r.Id, r.Year, p.Name, p.Bats, p.Throws, bioRole is null ? "" : await play.BioAsync(r.Id, bioRole))
            : new PlayerOut(r.Id, r.Year, r.Id);

    private static void IssueXsrf(HttpContext ctx, IAntiforgery af)
    {
        var tokens = af.GetAndStoreTokens(ctx);
        // Angular's HttpClient reads this cookie and sends it back as the X-XSRF-TOKEN header.
        ctx.Response.Cookies.Append("XSRF-TOKEN", tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false, Secure = ctx.Request.IsHttps, SameSite = SameSiteMode.Strict, Path = "/",
        });
    }

    private static async Task<IResult> Create(PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, Turnstile ts, IConfiguration cfg,
        (string Code, Guid? Other)? rematchOf)
    {
        if (!await ts.PassesAsync(body.Turnstile, ctx)) return Results.BadRequest(new { error = "Bot check failed. Try again." });
        if (ModeOf(body) is not { } mode) return Results.BadRequest(new { error = "Unknown game mode." });
        var era = mode == Rules.Inning ? EraOfBody(body, await play.OracleAsync()) : null;
        if (mode == Rules.Inning && era is null) return Results.BadRequest(new { error = "Pick 1 pitcher and 8 or 9 batters." });
        if (await CheckPicks(body.Picks, play, era) is { } err) return Results.BadRequest(err);
        if (body.Nickname is not null && !Identity.IsGeneratedNickname(body.Nickname)) return Results.BadRequest(new { error = "Pick one of the suggested names." });

        var now = DateTime.UtcNow;
        var ipHash = Identity.IpHash(ctx, Salt(cfg));
        var g = await CurrentGuest(ctx, store);
        if (g is not null)
        {
            if (await store.CreatedSinceAsync(g.Id, null, now.AddDays(-1)) >= PerGuestPerDay) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (await store.OpenCountAsync(g.Id, now) >= MaxOpen) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }
        if (await store.CreatedSinceAsync(null, ipHash, now.AddDays(-1)) >= PerIpPerDay) return Results.StatusCode(StatusCodes.Status429TooManyRequests);

        g ??= await NewGuest(ctx, store, body.Nickname ?? Identity.NewNickname(), cfg);
        if (g is null) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        if (body.Nickname is not null && body.Nickname != g.Nickname) { await store.SetNicknameAsync(g.Id, body.Nickname); g = g with { Nickname = body.Nickname }; }
        var code = Identity.NewCode();
        var key = Identity.NewToken();
        var ch = new Challenge(code, g.Id, g.Nickname, null, null, ChallengeStatus.Open, now, now + Lifetime, rematchOf?.Other, rematchOf?.Code, null, null,
            Deco: DecoOf(body, mode), Mode: mode, Era: era);
        await store.CreateChallengeAsync(ch, ToStored(body.Picks, side: 0), Identity.Hash(key), ipHash);
        return Results.Ok(new CreatedOut(code, key));
    }

    /// <summary>Null when the picks are fine, else the 400 body. era null = classic; else an inning team for that era (pitcher plus 8 or 9 batters).</summary>
    private static async Task<object?> CheckPicks(List<SlotIn>? picks, PlayService play, EraRules? era = null)
    {
        object Bad(string e) => era is null ? new { error = e } : new { error = e, batters = era.PickedBatters };
        if (picks is null || picks.Any(p => p is null || p.Choices is null || p.Choices.Any(c => c is null)))
            return Bad(era is null ? "Pick 1 pitcher and 3 batters." : $"Pick 1 pitcher and {era.PickedBatters} batters.");
        var slots = picks.Select(p => new SlotPick(p.Slot, p.Choices.Select(c => new PickRef(c.Id, c.Year)).ToList())).ToList();
        if ((era is null ? Rules.Validate(slots) : Rules.ValidateInning(slots, era.PickedBatters)) is { } err) return Bad(err);
        foreach (var s in slots!)
            foreach (var c in s.Choices)
                if (!await play.SeasonExistsAsync(c.Id, c.Year, pitcher: s.Slot == 0))
                    return Bad($"No {(s.Slot == 0 ? "pitching" : "batting")} season for {c.Id} in {c.Year}.");
        return null;
    }

    private static List<StoredPick> ToStored(List<SlotIn> picks, int side) =>
        picks.SelectMany(p => p.Choices.Select((c, rank) => new StoredPick(side, p.Slot, rank, c.Id, c.Year))).ToList();

    private static List<SlotPick> ToSlots(IReadOnlyList<StoredPick> all, int side) =>
        all.Where(p => p.Side == side).GroupBy(p => p.Slot).OrderBy(g => g.Key)
            .Select(g => new SlotPick(g.Key, g.OrderBy(p => p.Rank).Select(p => new PickRef(p.PlayerId, p.Year)).ToList())).ToList();

    private static async Task<Guest?> CurrentGuest(HttpContext ctx, IChallengeStore store) =>
        ctx.Request.Cookies.TryGetValue(Identity.GuestCookie, out var t) && Identity.KeyPattern().IsMatch(t)
            ? await store.GuestByTokenHashAsync(Identity.Hash(t))
            : null;

    /// <summary>Makes a guest and sets the cookie, or returns null when this address has made too many guests today.</summary>
    private static async Task<Guest?> NewGuest(HttpContext ctx, IChallengeStore store, string nickname, IConfiguration cfg)
    {
        var ipHash = Identity.IpHash(ctx, Salt(cfg));
        if (await store.GuestsCreatedSinceAsync(ipHash, DateTime.UtcNow.AddDays(-1)) >= GuestsPerIpPerDay) return null;
        var token = Identity.NewToken();
        var g = await store.CreateGuestAsync(Identity.Hash(token), nickname, ipHash);
        Identity.SetGuestCookie(ctx, token);
        return g;
    }

    /// <summary>
    /// The only place a challenge is turned into a response. Before the game is played, a side's picks go only to that side.
    /// </summary>
    private static async Task<ChallengeView> ViewFor(Challenge ch, HttpContext ctx, IChallengeStore store, PlayService play, MissCounter misses, Guest? asGuest = null)
    {
        var now = DateTime.UtcNow;
        if (ch.Status == ChallengeStatus.Open && ch.OpponentId is null && ch.ExpiresUtc <= now)
        {
            await store.ExpireAsync(ch.Code);
            ch = ch with { Status = ChallengeStatus.Expired };
        }
        var g = asGuest ?? await CurrentGuest(ctx, store);
        int? side = g is null ? null : g.Id == ch.CreatorId ? 0 : g.Id == ch.OpponentId ? 1 : null;
        if (side is null && ctx.Request.Headers.TryGetValue("X-Side-Key", out var k) && Identity.KeyPattern().IsMatch(k.ToString()))
        {
            var hit = await store.SideByKeyHashAsync(Identity.Hash(k.ToString()));
            if (hit is { } h && h.Code == ch.Code) side = h.Side;
            else misses.Miss(MissCounter.KeyFor(ctx));
        }
        var you = side switch { 0 => "creator", 1 => "opponent", _ => "visitor" };
        var canClaim = !ch.VsCpu && ch.Status == ChallengeStatus.Open && ch.OpponentId is null && side != 0
            && (ch.RematchFor is null || ch.RematchFor == g?.Id);

        async Task<PlayerOut> P(PickRef r) => await Out(play, r);

        IReadOnlyList<SlotOut>? yourPicks = null;
        if (side is { } s)
        {
            var mine = (await store.PicksAsync(ch.Code)).Where(p => p.Side == s).ToList();
            var slots = new List<SlotOut>();
            foreach (var grp in mine.GroupBy(p => p.Slot).OrderBy(x => x.Key))
            {
                var choices = new List<PlayerOut>();
                foreach (var p in grp.OrderBy(p => p.Rank)) choices.Add(await P(new PickRef(p.PlayerId, p.Year)));
                slots.Add(new SlotOut(grp.Key, choices));
            }
            yourPicks = slots;
        }

        GameOut? game = null;
        if (ch.Status == ChallengeStatus.Resolved)
        {
            var abs = await store.AtBatsAsync(ch.Code);
            var outs = new List<AtBatOut>();
            var names = new Dictionary<string, PlayerOut>();
            async Task<PlayerOut> Named(PickRef r) => names.TryGetValue($"{r.Id}:{r.Year}", out var x) ? x : names[$"{r.Id}:{r.Year}"] = await P(r);
            foreach (var a in abs)
            {
                var n = a.Inn;
                outs.Add(new AtBatOut(a.Index, a.Round, a.BattingSide, await Named(a.Pitcher), await Named(a.Batter), a.Seed.ToString(), a.Outcome.ToString().ToLowerInvariant(), a.Points,
                    n?.Inning, n?.Spot, n?.OutsBefore, n?.OutsAfter, n?.BasesBefore, n?.BasesAfter, n is null || n.OutType == OutType.None ? null : n.OutType.ToString().ToLowerInvariant(), n?.Scored));
            }
            if (ch.Mode == Rules.Inning && ch.Inning is { } inn)
            {
                // Lineups from the stored lineup ([0] pitcher, then the 9 spots), never from the plays (a side may bat 3 or 13 times).
                var lu = new List<IReadOnlyList<PlayerOut>>();
                foreach (var team in inn.Lineups)
                {
                    var list = new List<PlayerOut>();
                    foreach (var e in team) list.Add(await Named(new PickRef(e.Id, e.Year)));
                    lu.Add(list);
                }
                game = new GameOut(lu, outs, ch.Totals!, ch.Winner ?? -1, ch.Notes ?? new List<string>(), inn.LineScore, inn.Innings,
                    inn.Lineups.Select(team => (IReadOnlyList<string>)team.Select(e => e.From).ToList()).ToList());
            }
            var lineups = new List<IReadOnlyList<PlayerOut>>();
            for (var sd = 0; sd < 2 && game is null; sd++)
            {
                var pitcher = outs.First(a => a.BattingSide == 1 - sd).Pitcher;
                var batters = outs.Where(a => a.BattingSide == sd && a.Round == 0).Select(a => a.Batter).ToList();
                lineups.Add(new[] { pitcher }.Concat(batters).ToList());
            }
            game ??= new GameOut(lineups, outs, ch.Totals!, ch.Winner ?? -1, ch.Notes ?? new List<string>());
        }
        return new ChallengeView(ch.Code, ch.Status.ToString().ToLowerInvariant(), you, ch.CreatorName, ch.OpponentName, ch.ExpiresUtc,
            canClaim, ch.RematchOf, yourPicks, game, ch.VsCpu, ch.CpuLevel ?? 1, ch.Deco ?? 1, ch.Mode, ch.Era is null ? null : EraOut.Of(ch.Era));
    }
}
