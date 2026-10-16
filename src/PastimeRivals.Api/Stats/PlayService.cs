using System.Security.Cryptography;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Stats;

public sealed record PlayerHit(string Id, string Name, string Years, string Bats, string Throws, bool Hof);
public sealed record SeasonItem(int Year, string Teams, int Pa, string Line, char Grade, bool IsDefault);
public sealed record Side(string Id, string Name, int Year, string Hand);
public sealed record MatchupView(Side Batter, Side Pitcher, bool? SameHand, Dictionary<string, double> Probabilities,
    IReadOnlyList<OutcomeStep> Steps, string Neutral, string EngineVersion);

/// <summary>Loads the stats once (lazily) and answers search, season and matchup questions.</summary>
public sealed class PlayService(IStatsSource source)
{
    private readonly Lazy<Task<Loaded>> _loaded = new(async () => new Loaded(await source.LoadAsync()));

    private sealed class Loaded
    {
        public StatsCatalog Cat { get; }
        public Dictionary<string, PersonRow> People { get; }
        public Dictionary<string, List<PlayerRow>> Bat { get; }
        public Dictionary<string, List<PlayerRow>> Pit { get; }
        public Rates Neutral { get; }
        public Platoon NeutralPlatoon { get; }

        public Loaded(StatsBundle b)
        {
            Cat = b.Catalog;
            People = b.People.GroupBy(p => p.Id).ToDictionary(g => g.Key, g => g.First());
            Bat = b.Catalog.Batters.Where(r => r.Counts.Pa > 0).GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.OrderBy(r => r.Year).ToList());
            Pit = b.Catalog.Pitchers.Where(r => r.Counts.Pa > 0).GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.OrderBy(r => r.Year).ToList());
            Neutral = b.Catalog.Neutral();
            NeutralPlatoon = b.Catalog.PlatoonOver();
        }
    }

    public async Task<IReadOnlyList<PlayerHit>> SearchAsync(string q, string role)
    {
        var d = await _loaded.Value;
        q = q.Trim().ToLowerInvariant();
        if (q.Length == 0) return Array.Empty<PlayerHit>();
        var pool = role == "pit" ? d.Pit : d.Bat;
        return pool
            .Where(kv => d.People.TryGetValue(kv.Key, out var p) && Matches(p, q))
            .OrderByDescending(kv => kv.Value.Sum(r => r.Counts.Pa))
            .Take(20)
            .Select(kv =>
            {
                var p = d.People[kv.Key];
                return new PlayerHit(p.Id, p.Name, $"{kv.Value[0].Year}-{kv.Value[^1].Year}", p.Bats, p.Throws, p.Hof == "HOF");
            })
            .ToList();
    }

    // First or last name starts with the text, or the full name does (first-or-last-name prefix, kept from 2017).
    private static bool Matches(PersonRow p, string q) =>
        p.First.ToLowerInvariant().StartsWith(q) || p.Last.ToLowerInvariant().StartsWith(q) || p.Name.ToLowerInvariant().StartsWith(q);

    public async Task<IReadOnlyList<SeasonItem>?> SeasonsAsync(string id, string role)
    {
        var d = await _loaded.Value;
        if (!(role == "pit" ? d.Pit : d.Bat).TryGetValue(id, out var rows)) return null;
        var best = rows.MaxBy(r => r.Counts.Pa)!.Year;
        return rows.Select(r => new SeasonItem(r.Year, TeamsFor(r), r.Counts.Pa, Line(r, role), r.Grade, r.Year == best)).ToList();
    }

    private static string TeamsFor(PlayerRow r) => (r.PaAl, r.PaNl, r.PaFl) switch
    {
        ( > 0, > 0, _) => "AL/NL",
        ( > 0, _, _) => "AL",
        (_, > 0, _) => "NL",
        _ => "FL",
    };

    private static string Line(PlayerRow r, string role)
    {
        var c = r.Counts;
        var h = c.Single + c.Double + c.Triple + c.Hr;
        return role == "pit"
            ? $"{c.K} K, {c.Bb} BB, {c.Hr} HR allowed in {c.Pa} batters faced"
            : $"{h} H, {c.Hr} HR, {c.Bb} BB, {c.K} K in {c.Pa} PA";
    }

    public async Task<(MatchupView View, Rates Probabilities)?> MatchupAsync(string b, int by, string p, int py)
    {
        var d = await _loaded.Value;
        var bat = d.Cat.Batter(b, by);
        var pit = d.Cat.Pitcher(p, py);
        if (bat == null || pit == null) return null;
        var bp = d.People.GetValueOrDefault(b);
        var pp = d.People.GetValueOrDefault(p);
        bool? same = bp is { Bats: "L" or "R" or "B" } && pp is { Throws: "L" or "R" }
            ? bp.Bats != "B" && bp.Bats == pp.Throws
            : null;
        var m = Matchup.Compute(bat.Input, pit.Input, d.Neutral, d.NeutralPlatoon, EngineOptions.Default, same);
        var probs = Enum.GetValues<Outcome>().ToDictionary(o => o.ToString().ToLowerInvariant(), o => m.Probabilities[o]);
        var view = new MatchupView(
            new Side(b, bp?.Name ?? b, by, bp?.Bats ?? "?"),
            new Side(p, pp?.Name ?? p, py, pp?.Throws ?? "?"),
            same, probs, m.Steps, "1990-2019 MLB average", m.EngineVersion);
        return (view, m.Probabilities);
    }

    public static ulong NewSeed()
    {
        Span<byte> buf = stackalloc byte[8];
        RandomNumberGenerator.Fill(buf);
        return BitConverter.ToUInt64(buf);
    }
}
