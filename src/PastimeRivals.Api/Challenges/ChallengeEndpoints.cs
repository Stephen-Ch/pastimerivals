using Microsoft.AspNetCore.Antiforgery;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

public sealed record PickChoiceIn(string Id, int Year);
public sealed record SlotIn(int Slot, List<PickChoiceIn> Choices);
public sealed record FeedbackIn(string? Vote, string? Where, int? Level, string? Result);
public sealed record FeedbackReasonsIn(string[]? Reasons);
public sealed record PicksIn(List<SlotIn> Picks, string? Nickname, string? Turnstile, int? Level = null, int? Deco = null);
public sealed record NicknameIn(string Nickname);

public sealed record PlayerOut(string Id, int Year, string Name, string Bats = "R", string Throws = "R", string Bio = "");
public sealed record SlotOut(int Slot, IReadOnlyList<PlayerOut> Choices);
public sealed record AtBatOut(int Index, int Round, int BattingSide, PlayerOut Pitcher, PlayerOut Batter, string Seed, string Outcome, int Points);
public sealed record GameOut(IReadOnlyList<IReadOnlyList<PlayerOut>> Lineups, IReadOnlyList<AtBatOut> AtBats, int[] Totals, int Winner, IReadOnlyList<string> Notes);
public sealed record ChallengeView(string Code, string Status, string You, string CreatorName, string? OpponentName, DateTime ExpiresUtc,
    bool CanClaim, string? RematchOf, IReadOnlyList<SlotOut>? YourPicks, GameOut? Game, bool VsCpu = false, int CpuLevel = 1, int Deco = 1);
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
        api.MapGet("/challenges/quickpick", async (PlayService play) =>
        {
            var oracle = await play.OracleAsync();
            var used = new HashSet<string>();
            var slots = new List<SlotOut>();
            for (var slot = 0; slot < Rules.Slots; slot++)
            {
                var role = slot == 0 ? "pit" : "bat";
                if (Rules.DrawAtLevel(oracle, slot == 0, Rules.MinLevel, used, Rnd) is not { } first)
                    return Results.Problem("Player data is still loading. Try again.", statusCode: 503);
                used.Add(first.Id);
                var choices = new List<PlayerOut> { await Out(play, first, role) };
                foreach (var b in await play.SimilarAsync(first.Id, first.Year, slot == 0, 2, used)) { choices.Add(await Out(play, b, role)); used.Add(b.Id); }
                slots.Add(new SlotOut(slot, choices));
            }
            return Results.Ok(slots);
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
                s.Code, you = s.Side == 0 ? "creator" : "opponent", s.CreatorName, s.OpponentName, s.CreatedUtc, s.VsCpu,
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
            var id = await store.AddFeedbackAsync(new FeedbackRow(body.Vote, body.Where, body.Where == "cpu" ? body.Level : null, body.Result, EngineInfo.Version),
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
            if (!await ts.PassesAsync(body.Turnstile, ctx)) return Results.BadRequest(new { error = "Bot check failed. Try again." });
            if (await CheckPicks(body.Picks, play) is { } err) return Results.BadRequest(new { error = err });
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
            var clashes = body.Picks.Where(p => creatorFirsts.Contains(p.Choices[0].Id)).ToList();
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
            oracle.Top50(true); oracle.Top50(false); // build the fallback pools before the claim transaction starts
            var outcome = await store.LockAndResolveAsync(code, g.Id, g.Nickname, ToStored(body.Picks, side: 1), Identity.Hash(key), DateTime.UtcNow,
                all => Rules.Play(new[] { ToSlots(all, 0), ToSlots(all, 1) }, PlayService.NewSeed(), oracle));
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
            if (await CheckPicks(body.Picks, play) is { } err) return Results.BadRequest(new { error = err });
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
            for (var slot = 0; slot < Rules.Slots; slot++)
            {
                if (Rules.DrawAtLevel(oracle, slot == 0, level, used, Rnd) is not { } pick)
                    return Results.Problem("Player data is still loading. Try again.", statusCode: 503);
                used.Add(pick.Id);
                cpu.Add(new StoredPick(1, slot, 0, pick.Id, pick.Year));
            }
            oracle.Top50(true); oracle.Top50(false);

            var code = Identity.NewCode();
            var key = Identity.NewToken();
            // Reserved for the computer, so nobody else can ever claim it.
            var ch = new Challenge(code, g.Id, g.Nickname, null, null, ChallengeStatus.Open, now, now + Lifetime, ComputerId, null, null, null, VsCpu: true, CpuLevel: level, Deco: DecoOf(body));
            await store.CreateChallengeAsync(ch, ToStored(body.Picks, side: 0), Identity.Hash(key), ipHash);
            var outcome = await store.LockAndResolveAsync(code, ComputerId, ComputerName, cpu, Identity.Hash(Identity.NewToken()), now,
                all => Rules.Play(new[] { ToSlots(all, 0), ToSlots(all, 1) }, PlayService.NewSeed(), oracle));
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
            var other = g.Id == ch.CreatorId ? ch.OpponentId : ch.CreatorId;
            return await Create(body, ctx, store, play, ts, cfg, rematchOf: (code, other));
        });
    }

    /// <summary>Plan 32A: decoration version the creating app used (count and call text). Old apps send none = 1.</summary>
    internal static int DecoOf(PicksIn body) => body.Deco is { } d && d >= 1 && d <= 9 ? d : 1;

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
        sb.AppendLine("day         kind      created  sent  opened  opened-late  picking  played  watched");
        foreach (var d in r.Days)
            sb.AppendLine($"{d.Day:yyyy-MM-dd}  {(d.Rematch ? "rematch" : "first  ")}  {d.Created,7}  {d.Sent,4}  {d.Opened,6}  {d.OpenedExpired,11}  {d.Picking,7}  {d.Played,6}  {d.Watched,7}");
        int T(Func<FunnelDay, int> f) => r.Days.Sum(f);
        sb.AppendLine($"TOTAL                 {T(d => d.Created),7}  {T(d => d.Sent),4}  {T(d => d.Opened),6}  {T(d => d.OpenedExpired),11}  {T(d => d.Picking),7}  {T(d => d.Played),6}  {T(d => d.Watched),7}");
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
        if (await CheckPicks(body.Picks, play) is { } err) return Results.BadRequest(new { error = err });
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
        var ch = new Challenge(code, g.Id, g.Nickname, null, null, ChallengeStatus.Open, now, now + Lifetime, rematchOf?.Other, rematchOf?.Code, null, null, Deco: DecoOf(body));
        await store.CreateChallengeAsync(ch, ToStored(body.Picks, side: 0), Identity.Hash(key), ipHash);
        return Results.Ok(new CreatedOut(code, key));
    }

    private static async Task<string?> CheckPicks(List<SlotIn>? picks, PlayService play)
    {
        if (picks is null || picks.Any(p => p is null || p.Choices is null || p.Choices.Any(c => c is null))) return "Pick 1 pitcher and 3 batters.";
        var slots = picks.Select(p => new SlotPick(p.Slot, p.Choices.Select(c => new PickRef(c.Id, c.Year)).ToList())).ToList();
        if (Rules.Validate(slots) is { } err) return err;
        foreach (var s in slots!)
            foreach (var c in s.Choices)
                if (!await play.SeasonExistsAsync(c.Id, c.Year, pitcher: s.Slot == 0))
                    return $"No {(s.Slot == 0 ? "pitching" : "batting")} season for {c.Id} in {c.Year}.";
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
            foreach (var a in abs)
                outs.Add(new AtBatOut(a.Index, a.Round, a.BattingSide, await P(a.Pitcher), await P(a.Batter), a.Seed.ToString(), a.Outcome.ToString().ToLowerInvariant(), a.Points));
            var lineups = new List<IReadOnlyList<PlayerOut>>();
            for (var sd = 0; sd < 2; sd++)
            {
                var pitcher = outs.First(a => a.BattingSide == 1 - sd).Pitcher;
                var batters = outs.Where(a => a.BattingSide == sd && a.Round == 0).Select(a => a.Batter).ToList();
                lineups.Add(new[] { pitcher }.Concat(batters).ToList());
            }
            game = new GameOut(lineups, outs, ch.Totals!, ch.Winner ?? -1, ch.Notes ?? new List<string>());
        }
        return new ChallengeView(ch.Code, ch.Status.ToString().ToLowerInvariant(), you, ch.CreatorName, ch.OpponentName, ch.ExpiresUtc,
            canClaim, ch.RematchOf, yourPicks, game, ch.VsCpu, ch.CpuLevel ?? 1, ch.Deco ?? 1);
    }
}
