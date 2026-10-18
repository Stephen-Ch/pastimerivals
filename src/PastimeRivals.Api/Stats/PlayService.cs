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
        public IReadOnlyList<TeamRow> Teams { get; }
        public Platoon NeutralPlatoon { get; }
        public IReadOnlyList<Challenges.PickRef>? TopBat, TopPit, CpuBat, CpuPit;
        private Dictionary<int, double>? _batMean, _pitMean;

        private static Dictionary<int, double> Means(Dictionary<string, List<PlayerRow>> pool) =>
            pool.Values.SelectMany(v => v).Where(r => r.Counts.Pa > 0).GroupBy(r => r.Year).ToDictionary(g => g.Key,
                g => (double)g.Sum(r => r.Counts.Bb + r.Counts.Hbp + r.Counts.Single + 2 * r.Counts.Double + 3 * r.Counts.Triple + 4 * r.Counts.Hr) / g.Sum(r => r.Counts.Pa));

        /// <summary>Challenge points per plate appearance divided by that year's average (1.0 = average for the year).</summary>
        public double Score(PlayerRow r, bool pitcher)
        {
            var means = pitcher ? (_pitMean ??= Means(Pit)) : (_batMean ??= Means(Bat));
            var c = r.Counts;
            var ppa = c.Pa == 0 ? 0 : (double)(c.Bb + c.Hbp + c.Single + 2 * c.Double + 3 * c.Triple + 4 * c.Hr) / c.Pa;
            return means.TryGetValue(r.Year, out var m) && m > 0 ? ppa / m : 1;
        }

        public Loaded(StatsBundle b)
        {
            Cat = b.Catalog;
            Teams = b.Teams ?? Array.Empty<TeamRow>();
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

    public async Task<ScoutingReport?> ReportAsync(string id, int year, string role)
    {
        var d = await _loaded.Value;
        var player = role == "pit" ? d.Cat.Pitcher(id, year) : d.Cat.Batter(id, year);
        if (player == null) return null;
        var p = d.People.GetValueOrDefault(id);
        var row = player.Row;
        var places = row.Teams.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(code => d.Teams.FirstOrDefault(t => t.Code == code && year >= t.FirstYear && year <= (t.LastYear >= 2021 ? 9999 : t.LastYear)))
            .Where(t => t != null).Select(t => $"{t!.City}, {t.League}").Distinct().ToList();
        return new ScoutingReport(id, p?.Name ?? id, role, year, Reports.AgeOn(p?.BirthDate, year), Reports.Height(p?.Height),
            Reports.Weight(p?.Weight), p?.Bats ?? "?", p?.Throws ?? "?", role == "pit" ? "P" : (row.Position is { Length: > 0 } pos ? pos : "?"),
            places, Line(row, role), row.Grade, Reports.EraOf(year), p?.Hof == "HOF",
            Reports.Ratios(row.Counts, player.Input.League, role));
    }

    /// <summary>Challenge rules need synchronous odds; call this first so the stats are loaded.</summary>
    public async Task<Challenges.IMatchupOracle> OracleAsync() => new Oracle(await _loaded.Value);

    public async Task<string?> NameAsync(string id) => (await _loaded.Value).People.TryGetValue(id, out var p) ? p.Name : null;

    public async Task<(string Name, string Bats, string Throws)?> PersonAsync(string id) =>
        (await _loaded.Value).People.TryGetValue(id, out var p) ? (p.Name, p.Bats, p.Throws) : null;

    private static double PointsPerPa(SeasonCounts c) => c.Pa == 0 ? 0 : (double)(c.Bb + c.Hbp + c.Single + 2 * c.Double + 3 * c.Triple + 4 * c.Hr) / c.Pa;

    /// <summary>Plan 24: suggested backups, the player-seasons nearest in challenge points per plate appearance (same role, other players).</summary>
    public async Task<IReadOnlyList<Challenges.PickRef>> SimilarAsync(string id, int year, bool pitcher, int n = 2, IEnumerable<string>? exclude = null)
    {
        var d = await _loaded.Value;
        var pool = pitcher ? d.Pit : d.Bat;
        if (!pool.TryGetValue(id, out var rows) || rows.FirstOrDefault(r => r.Year == year) is not { } me) return Array.Empty<Challenges.PickRef>();
        var skip = new HashSet<string>(exclude ?? Array.Empty<string>()) { id };
        double target;
        lock (d) target = d.Score(me, pitcher);
        var minPa = pitcher ? 400 : 300;
        double Gap(PlayerRow r) { lock (d) return Math.Abs(d.Score(r, pitcher) - target); }
        return pool.Where(kv => !skip.Contains(kv.Key))
            .Select(kv => kv.Value.Where(r => r.Counts.Pa >= minPa).MinBy(Gap))
            .Where(r => r != null)
            .OrderBy(r => Gap(r!)).ThenBy(r => r!.Id)
            .Take(n).Select(r => new Challenges.PickRef(r!.Id, r.Year)).ToList();
    }

    public async Task<bool> SeasonExistsAsync(string id, int year, bool pitcher)
    {
        var d = await _loaded.Value;
        return (pitcher ? d.Cat.Pitcher(id, year) : d.Cat.Batter(id, year)) != null;
    }

    private sealed class Oracle(Loaded d) : Challenges.IMatchupOracle
    {

        public Rates? Odds(Challenges.PickRef batter, Challenges.PickRef pitcher)
        {
            var bat = d.Cat.Batter(batter.Id, batter.Year);
            var pit = d.Cat.Pitcher(pitcher.Id, pitcher.Year);
            if (bat == null || pit == null) return null;
            var bp = d.People.GetValueOrDefault(batter.Id);
            var pp = d.People.GetValueOrDefault(pitcher.Id);
            bool? same = bp is { Bats: "L" or "R" or "B" } && pp is { Throws: "L" or "R" } ? bp.Bats != "B" && bp.Bats == pp.Throws : null;
            return Matchup.Compute(bat.Input, pit.Input, d.Neutral, d.NeutralPlatoon, EngineOptions.Default, same).Probabilities;
        }

        // Top 50 by challenge points per plate appearance (batters, 300+ PA) or fewest allowed (pitchers, 150+ batters faced).
        /// <summary>Plan 25: the computer picks from the best 40 per era at each position (200 in all), so it is beatable.</summary>
        public IReadOnlyList<Challenges.PickRef> ComputerPool(bool pitchers)
        {
            lock (d)
            {
                if (pitchers) return d.CpuPit ??= Rank(d, d.Pit, 400, ascending: true, perEra: 40);
                return d.CpuBat ??= Rank(d, d.Bat, 300, ascending: false, perEra: 40);
            }
        }

        public IReadOnlyList<Challenges.PickRef> Top50(bool pitchers)
        {
            lock (d)
            {
                if (pitchers) return d.TopPit ??= Rank(d, d.Pit, 400, ascending: true);
                return d.TopBat ??= Rank(d, d.Bat, 300, ascending: false);
            }
        }

        // Era-adjusted (each season against the average of its year), and 10 from each era so no one era fills the list.
        private static IReadOnlyList<Challenges.PickRef> Rank(Loaded d, Dictionary<string, List<PlayerRow>> pool, int minPa, bool ascending, int perEra = 10)
        {
            var rows = pool.Values.SelectMany(v => v).Where(r => r.Counts.Pa >= minPa).ToList();
            return rows.GroupBy(r => EraBucket(r.Year))
                .SelectMany(g => (ascending ? g.OrderBy(r => d.Score(r, ascending)) : g.OrderByDescending(r => d.Score(r, ascending))).ThenBy(r => r.Id).ThenBy(r => r.Year).Take(perEra))
                .Select(r => new Challenges.PickRef(r.Id, r.Year)).ToList();
        }

        private static int EraBucket(int y) => y < 1920 ? 0 : y < 1946 ? 1 : y < 1970 ? 2 : y < 1990 ? 3 : 4;
    }

    public static ulong NewSeed()
    {
        Span<byte> buf = stackalloc byte[8];
        RandomNumberGenerator.Fill(buf);
        return BitConverter.ToUInt64(buf);
    }
}
