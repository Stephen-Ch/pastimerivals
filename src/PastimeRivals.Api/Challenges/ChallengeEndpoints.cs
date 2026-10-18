using Microsoft.AspNetCore.Antiforgery;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Challenges;

public sealed record PickChoiceIn(string Id, int Year);
public sealed record SlotIn(int Slot, List<PickChoiceIn> Choices);
public sealed record PicksIn(List<SlotIn> Picks, string? Nickname, string? Turnstile);
public sealed record NicknameIn(string Nickname);

public sealed record PlayerOut(string Id, int Year, string Name, string Bats = "R", string Throws = "R");
public sealed record SlotOut(int Slot, IReadOnlyList<PlayerOut> Choices);
public sealed record AtBatOut(int Index, int Round, int BattingSide, PlayerOut Pitcher, PlayerOut Batter, string Seed, string Outcome, int Points);
public sealed record GameOut(IReadOnlyList<IReadOnlyList<PlayerOut>> Lineups, IReadOnlyList<AtBatOut> AtBats, int[] Totals, int Winner, IReadOnlyList<string> Notes);
public sealed record ChallengeView(string Code, string Status, string You, string CreatorName, string? OpponentName, DateTime ExpiresUtc,
    bool CanClaim, string? RematchOf, IReadOnlyList<SlotOut>? YourPicks, GameOut? Game);
public sealed record CreatedOut(string Code, string Key);

public static class ChallengeEndpoints
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(72);
    // Counted then inserted without a lock, so a burst of parallel requests can overshoot by a few (accepted).
    public const int PerGuestPerDay = 20, PerIpPerDay = 200, MaxOpen = 50, GuestsPerIpPerDay = 300;

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
            foreach (var r in await play.SimilarAsync(id, year, role == "pit")) list.Add(await Out(play, r));
            return Results.Ok(list);
        });

        // Quick pick: a random team from the top 50 at each position, each with suggested backups.
        api.MapGet("/challenges/quickpick", async (PlayService play) =>
        {
            var oracle = await play.OracleAsync();
            var pits = oracle.Top50(true); var bats = oracle.Top50(false);
            if (pits.Count == 0 || bats.Count < 3) return Results.Problem("Player data is still loading. Try again.", statusCode: 503);
            var used = new HashSet<string>();
            var slots = new List<SlotOut>();
            for (var slot = 0; slot < Rules.Slots; slot++)
            {
                var pool = (slot == 0 ? pits : bats).Where(p => !used.Contains(p.Id)).ToList();
                var first = pool[System.Security.Cryptography.RandomNumberGenerator.GetInt32(pool.Count)];
                used.Add(first.Id);
                var choices = new List<PlayerOut> { await Out(play, first) };
                foreach (var b in await play.SimilarAsync(first.Id, first.Year, slot == 0, 2, used)) { choices.Add(await Out(play, b)); used.Add(b.Id); }
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
                s.Code, you = s.Side == 0 ? "creator" : "opponent", s.CreatorName, s.OpponentName, s.CreatedUtc,
                status = s.Status == ChallengeStatus.Open && s.OpponentName is null && s.ExpiresUtc <= now ? "expired" : s.Status.ToString().ToLowerInvariant(),
            }));
        });

        api.MapGet("/challenges/{code}", async (string code, HttpContext ctx, IChallengeStore store, PlayService play, MissCounter misses) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch)
            {
                misses.Miss(ip);
                return Results.NotFound();
            }
            return Results.Ok(await ViewFor(ch, ctx, store, play, misses));
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
            return Results.Ok(new { key, view = await ViewFor(ch, ctx, store, play, misses, asGuest: g) });
        });

        write.MapPost("/challenges/{code}/rematch", async (string code, PicksIn body, HttpContext ctx, IChallengeStore store, PlayService play, Turnstile ts, IConfiguration cfg, MissCounter misses) =>
        {
            var ip = MissCounter.KeyFor(ctx);
            if (misses.Blocked(ip)) return Results.StatusCode(StatusCodes.Status429TooManyRequests);
            var g = await CurrentGuest(ctx, store);
            if (!Identity.CodePattern().IsMatch(code) || await store.GetAsync(code) is not { } ch
                || g is null || ch.Status != ChallengeStatus.Resolved || (g.Id != ch.CreatorId && g.Id != ch.OpponentId))
            {
                misses.Miss(ip);
                return Results.NotFound();
            }
            if (await store.RematchExistsAsync(code, g.Id)) return Results.Conflict(new { error = "already" });
            var other = g.Id == ch.CreatorId ? ch.OpponentId : ch.CreatorId;
            return await Create(body, ctx, store, play, ts, cfg, rematchOf: (code, other));
        });
    }

    private static async Task<PlayerOut> Out(PlayService play, PickRef r) =>
        await play.PersonAsync(r.Id) is { } p ? new PlayerOut(r.Id, r.Year, p.Name, p.Bats, p.Throws) : new PlayerOut(r.Id, r.Year, r.Id);

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
        var ch = new Challenge(code, g.Id, g.Nickname, null, null, ChallengeStatus.Open, now, now + Lifetime, rematchOf?.Other, rematchOf?.Code, null, null);
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
        var canClaim = ch.Status == ChallengeStatus.Open && ch.OpponentId is null && side != 0
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
            canClaim, ch.RematchOf, yourPicks, game);
    }
}
