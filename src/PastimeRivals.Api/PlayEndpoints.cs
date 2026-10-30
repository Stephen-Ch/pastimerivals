using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api;

public sealed record PitchRequest(string B, int By, string P, int Py, string? Seed, int? N);
public sealed record EventRequest(string Name, string Session, string? Source = null);

public static class PlayEndpoints
{
    private static readonly HashSet<string> EventNames = new() { "open", "matchup_view", "pitch", "sim1000", "share", "share_open", "art_wrong_look", "art_fallback", "cpu_game", "sim_open", "first_view", "art_note_shown", "art_note_more", "art_blank_why" };   // plan 36: first_view; plan 52B: art notes

    public static void MapPlay(this WebApplication app)
    {
        var api = app.MapGroup("/api").RequireRateLimiting("per-ip");

        api.MapGet("/players/search", async (string q, string? role, PlayService s) =>
            Results.Ok(await s.SearchAsync(q, role == "pit" ? "pit" : "bat")));

        api.MapGet("/players/{id}/seasons", async (string id, string? role, PlayService s) =>
            await s.SeasonsAsync(id, role == "pit" ? "pit" : "bat") is { } list ? Results.Ok(list) : Results.NotFound());

        api.MapGet("/matchup", async (string b, int by, string p, int py, PlayService s) =>
            await s.MatchupAsync(b, by, p, py) is { } m ? Results.Ok(m.View) : Results.NotFound());

        // Plan 39: random opening matchups for returning visitors (level-2 "good players", real workload). Read-only.
        api.MapGet("/matchup/random", async (int? n, PlayService s) =>
            Results.Ok(await s.RandomPairsAsync(Math.Clamp(n ?? 12, 1, 20))));

        api.MapGet("/card", async (string id, int year, string? role, PlayService s) =>
            await s.ReportAsync(id, year, role == "pit" ? "pit" : "bat") is { } r ? Results.Ok(r) : Results.NotFound());

        api.MapPost("/pitch", async (PitchRequest r, PlayService s) =>
        {
            if (await s.MatchupAsync(r.B, r.By, r.P, r.Py) is not { } m) return Results.NotFound();
            var seed = ulong.TryParse(r.Seed, out var given) ? given : PlayService.NewSeed();
            var outcome = Simulator.Draw(m.Probabilities, new SeededRandom(seed));
            return Results.Ok(new { outcome = outcome.ToString().ToLowerInvariant(), seed = seed.ToString(), engineVersion = EngineInfo.Version });
        });

        api.MapPost("/sims", async (PitchRequest r, PlayService s) =>
        {
            if (await s.MatchupAsync(r.B, r.By, r.P, r.Py) is not { } m) return Results.NotFound();
            var n = Math.Clamp(r.N ?? 1000, 1, 1000);
            var seed = ulong.TryParse(r.Seed, out var given) ? given : PlayService.NewSeed();
            var rng = new SeededRandom(seed);
            var counts = Enum.GetValues<Outcome>().ToDictionary(o => o.ToString().ToLowerInvariant(), _ => 0);
            for (var i = 0; i < n; i++) counts[Simulator.Draw(m.Probabilities, rng).ToString().ToLowerInvariant()]++;
            return Results.Ok(new { n, counts, seed = seed.ToString() });
        });

        api.MapPost("/events", async (EventRequest e, IEventSink sink) =>
        {
            if (!EventNames.Contains(e.Name) || string.IsNullOrWhiteSpace(e.Session) || e.Session.Length > 64)
                return Results.BadRequest();
            await sink.WriteAsync(e.Name, e.Session, CleanSource(e.Source));
            return Results.NoContent();
        });
    }

    /// <summary>Plan 29: utm_source/ref as given in a link: lowercase letters, digits and dashes, 1-30 long; anything else is dropped.</summary>
    public static string? CleanSource(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim().ToLowerInvariant();
        return s.Length <= 30 && s.All(ch => ch is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-') ? s : null;
    }
}
