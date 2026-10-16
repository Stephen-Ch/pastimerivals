namespace PastimeRivals.Engine;

public sealed record LeagueRow(int Year, string League, string Side, SeasonCounts Counts);
public sealed record PlayerRow(string Id, int Year, int PaAl, int PaNl, int PaFl, SeasonCounts Counts, char Grade);
public sealed record PlatoonRow(int Year, bool SameHand, SeasonCounts Counts);
public sealed record ExposureRow(string Role, string Id, int Year, int SameHandPa, int KnownPa);
public sealed record PlayerSeasonRef(PlayerRow Row, PlayerInput Input);

/// <summary>In-memory view of the pipeline tables, turning rows into engine inputs. No file or database access.</summary>
public sealed class StatsCatalog
{
    private const int MinPlatoonPa = 300_000;
    private readonly Dictionary<(int, string, string), SeasonCounts> _leagues;
    private readonly Dictionary<(int, bool), SeasonCounts> _platoon;
    private readonly Dictionary<(string, int), PlayerRow> _batters;
    private readonly Dictionary<(string, int), PlayerRow> _pitchers;
    private readonly Dictionary<(string, string, int), ExposureRow> _exposure;
    private readonly Dictionary<int, Platoon> _platoonCache = new();
    private readonly int _minYear, _maxYear;

    public StatsCatalog(IEnumerable<LeagueRow> leagues, IEnumerable<PlatoonRow> platoon, IEnumerable<PlayerRow> batters,
        IEnumerable<PlayerRow> pitchers, IEnumerable<ExposureRow> exposure)
    {
        _leagues = leagues.ToDictionary(l => (l.Year, l.League, l.Side), l => l.Counts);
        _platoon = platoon.ToDictionary(p => (p.Year, p.SameHand), p => p.Counts);
        _batters = batters.ToDictionary(b => (b.Id, b.Year));
        _pitchers = pitchers.ToDictionary(p => (p.Id, p.Year));
        _exposure = exposure.ToDictionary(e => (e.Role, e.Id, e.Year));
        var years = _leagues.Keys.Select(k => k.Item1).ToList();
        _minYear = years.Count > 0 ? years.Min() : 0;
        _maxYear = years.Count > 0 ? years.Max() : 0;
    }

    public IEnumerable<PlayerRow> Batters => _batters.Values;
    public IEnumerable<PlayerRow> Pitchers => _pitchers.Values;

    public static Rates ToRates(SeasonCounts c) => Rates.From(c.KRate, c.Rate(Outcome.Bb), c.Rate(Outcome.Hbp),
        c.Rate(Outcome.Single), c.Rate(Outcome.Double), c.Rate(Outcome.Triple), c.Rate(Outcome.Hr));

    public Rates LeagueRates(int year, string league, string side) => ToRates(_leagues[(year, league, side)]);

    /// <summary>League environment for a player-season, weighted by his plate appearances in each league.</summary>
    public Rates PlayerLeague(PlayerRow p, string side)
    {
        var parts = new[] { ("AL", p.PaAl), ("NL", p.PaNl), ("FL", p.PaFl) }
            .Where(x => x.Item2 > 0 && _leagues.ContainsKey((p.Year, x.Item1, side))).ToList();
        if (parts.Count == 0) throw new InvalidOperationException($"No league rows for {p.Id} {p.Year}");
        double total = parts.Sum(x => x.Item2);
        var v = new double[Rates.Count];
        foreach (var (lg, pa) in parts)
        {
            var r = LeagueRates(p.Year, lg, side);
            for (var i = 0; i < Rates.Count; i++) v[i] += r.Values[i] * pa / total;
        }
        return Rates.Normalize(v);
    }

    /// <summary>Neutral environment: pooled non-pitcher batting over a span of seasons (default 1990 to 2019, decision D4).</summary>
    public Rates Neutral(int from = 1990, int to = 2019) =>
        ToRates(Sum(_leagues.Where(kv => kv.Key.Item3 == "bat" && kv.Key.Item1 >= from && kv.Key.Item1 <= to).Select(kv => kv.Value)));

    /// <summary>Platoon factors pooled over seasons around the year, widening until there are enough plate appearances.</summary>
    public Platoon PlatoonFor(int year)
    {
        if (_platoonCache.TryGetValue(year, out var cached)) return cached;
        var result = Platoon.None;
        for (var w = 2; w <= 60; w++)
        {
            var (same, opp) = PlatoonCounts(year - w, year + w);
            if (same.Pa + opp.Pa < MinPlatoonPa && w < 60) continue;
            result = FromCounts(same, opp);
            break;
        }
        return _platoonCache[year] = result;
    }

    /// <summary>Platoon factors pooled over a fixed span (the neutral era for the matchup itself).</summary>
    public Platoon PlatoonOver(int from = 1990, int to = 2019)
    {
        var (same, opp) = PlatoonCounts(from, to);
        return FromCounts(same, opp);
    }

    private (SeasonCounts Same, SeasonCounts Opp) PlatoonCounts(int from, int to) => (
        Sum(_platoon.Where(kv => kv.Key.Item2 && kv.Key.Item1 >= from && kv.Key.Item1 <= to).Select(kv => kv.Value)),
        Sum(_platoon.Where(kv => !kv.Key.Item2 && kv.Key.Item1 >= from && kv.Key.Item1 <= to).Select(kv => kv.Value)));

    private static Platoon FromCounts(SeasonCounts same, SeasonCounts opp)
    {
        if (same.Pa == 0 || opp.Pa == 0) return Platoon.None;
        var all = ToRates(Add(same, opp));
        var s = ToRates(same);
        var o = ToRates(opp);
        return new Platoon(
            Enumerable.Range(0, 8).Select(i => all.Values[i] > 0 ? s.Values[i] / all.Values[i] : 1).ToArray(),
            Enumerable.Range(0, 8).Select(i => all.Values[i] > 0 ? o.Values[i] / all.Values[i] : 1).ToArray(),
            same.Pa / (double)(same.Pa + opp.Pa));
    }

    public PlayerSeasonRef? Batter(string id, int year) => Ref(_batters, "bat", id, year);
    public PlayerSeasonRef? Pitcher(string id, int year) => Ref(_pitchers, "pit", id, year);

    private PlayerSeasonRef? Ref(Dictionary<(string, int), PlayerRow> d, string side, string id, int year)
    {
        if (!d.TryGetValue((id, year), out var row)) return null;
        var ex = _exposure.TryGetValue((side, id, year), out var e) ? new Exposure(e.SameHandPa, e.KnownPa) : null;
        return new PlayerSeasonRef(row, new PlayerInput(row.Counts, PlayerLeague(row, side), ex, PlatoonFor(year)));
    }

    private static SeasonCounts Sum(IEnumerable<SeasonCounts> items) => items.Aggregate(SeasonCounts.Empty, Add);

    private static SeasonCounts Add(SeasonCounts a, SeasonCounts b) => new(a.Pa + b.Pa, a.KKnownPa + b.KKnownPa, a.K + b.K,
        a.Bb + b.Bb, a.Hbp + b.Hbp, a.Single + b.Single, a.Double + b.Double, a.Triple + b.Triple, a.Hr + b.Hr);
}
