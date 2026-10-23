using System.Collections.Concurrent;
using System.Security.Cryptography;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Stats;

public sealed record PlayerHit(string Id, string Name, string Years, string Bats, string Throws, bool Hof, string Bio = "");
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
        public IReadOnlyList<Challenges.PickRef>? TopBat, TopPit;
        public readonly Dictionary<(bool Pit, int Level), IReadOnlyList<Challenges.PickRef>[]> Levels = new();
        public readonly ConcurrentDictionary<(string Id, bool Pit), string> Bios = new();
        private Dictionary<int, double>? _batMean, _pitMean;
        private Dictionary<int, SeasonCounts>? _pitcherBatting;

        /// <summary>Plan 38: summed batting of pitchers by decade (batter seasons listed at P with 100+ batters faced that year).</summary>
        public Dictionary<int, SeasonCounts> PitcherBatting => _pitcherBatting ??= Bat.Values.SelectMany(v => v)
            .Where(r => r.Position == "P" && Pit.TryGetValue(r.Id, out var ps) && ps.Any(x => x.Year == r.Year && x.Counts.Pa >= 100))
            .GroupBy(r => r.Year / 10 * 10).ToDictionary(g => g.Key, g => g.Select(r => r.Counts).Aggregate(SeasonCounts.Empty, PlayService.Add));

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
                return new PlayerHit(p.Id, p.Name, $"{kv.Value[0].Year}-{kv.Value[^1].Year}", p.Bats, p.Throws, p.Hof == "HOF",
                    d.Bios.GetOrAdd((p.Id, role == "pit"), k => BuildBio(d, k.Id, k.Pit)));
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
            Reports.Ratios(row.Counts, player.Input.League, role), d.Bios.GetOrAdd((id, role == "pit"), k => BuildBio(d, k.Id, k.Pit)));
    }

    /// <summary>Plan 39: one side of a random opening matchup, with the same name and line the app's cards use.</summary>
    public sealed record RandomSide(string Id, string Name, int Year, string Line);
    public sealed record RandomPair(RandomSide Pitcher, RandomSide Batter);

    /// <summary>Plan 39: n random pitcher-batter pairs drawn like computer level 2 (better half of each era); no player twice.</summary>
    public async Task<IReadOnlyList<RandomPair>> RandomPairsAsync(int n)
    {
        var d = await _loaded.Value;
        var oracle = new Oracle(d);
        var used = new HashSet<string>();
        var pairs = new List<RandomPair>();
        int Rnd(int k) => RandomNumberGenerator.GetInt32(k);
        RandomSide? Side(bool pit)
        {
            if (Challenges.Rules.DrawAtLevel(oracle, pit, 2, used, Rnd) is not { } r) return null;
            used.Add(r.Id);
            var row = pit ? d.Cat.Pitcher(r.Id, r.Year)?.Row : d.Cat.Batter(r.Id, r.Year)?.Row;
            if (row is null) return null;
            return new RandomSide(r.Id, d.People.TryGetValue(r.Id, out var p) ? p.Name : r.Id, r.Year, Line(row, pit ? "pit" : "bat"));
        }
        for (var i = 0; i < n; i++)
        {
            if (Side(true) is not { } pit || Side(false) is not { } bat) break;
            pairs.Add(new RandomPair(pit, bat));
        }
        return pairs;
    }

    /// <summary>Challenge rules need synchronous odds; call this first so the stats are loaded.</summary>
    public async Task<Challenges.IMatchupOracle> OracleAsync() => new Oracle(await _loaded.Value);

    public async Task<string?> NameAsync(string id) => (await _loaded.Value).People.TryGetValue(id, out var p) ? p.Name : null;

    public async Task<(string Name, string Bats, string Throws)?> PersonAsync(string id) =>
        (await _loaded.Value).People.TryGetValue(id, out var p) ? (p.Name, p.Bats, p.Throws) : null;

    /// <summary>Plan 26: real-workload floors for random picks (same as the old top-50 floors).</summary>
    public const int BatFloor = 300, PitFloor = 400, LegendPitFloor = 600;

    /// <summary>Plan 26: one-line career bio, e.g. "1914-1935 · Boston AL, New York AL +1 · Hall of Fame · Best: 60 HR (1927)".</summary>
    public async Task<string> BioAsync(string id, string role)
    {
        var d = await _loaded.Value;
        var pit = role == "pit";
        return d.Bios.GetOrAdd((id, pit), k => BuildBio(d, k.Id, k.Pit));
    }

    private static string BuildBio(Loaded d, string id, bool pit)
    {
        if (!(pit ? d.Pit : d.Bat).TryGetValue(id, out var rows) || rows.Count == 0) return "";
        var parts = new List<string> { rows[0].Year == rows[^1].Year ? $"{rows[0].Year}" : $"{rows[0].Year}-{rows[^1].Year}" };
        // Places in the order he first played there (per-team plate appearances do not exist). City and league only (plan 10).
        var places = new List<string>();
        foreach (var r in rows)
            foreach (var code in r.Teams.Split('/', StringSplitOptions.RemoveEmptyEntries))
            {
                var t = d.Teams.FirstOrDefault(t => t.Code == code && r.Year >= t.FirstYear && r.Year <= (t.LastYear >= 2021 ? 9999 : t.LastYear));
                var name = t is null ? null : $"{System.Text.RegularExpressions.Regex.Replace(t.City, @"\.(?=\S)", ". ")} {t.League}";   // "St.Louis" -> "St. Louis"
                if (name is not null && !places.Contains(name)) places.Add(name);
            }
        if (places.Count > 0) parts.Add(string.Join(", ", places.Take(2)) + (places.Count > 2 ? $" +{places.Count - 2}" : ""));
        if (d.People.TryGetValue(id, out var p) && p.Hof == "HOF") parts.Add("Hall of Fame");
        // Ties go to the earliest year (rows are sorted by year, MaxBy keeps the first).
        if (pit)
        {
            var best = rows.MaxBy(r => r.Counts.K)!;
            if (best.Counts.K > 0) parts.Add($"Best: {best.Counts.K} K ({best.Year})");
        }
        else
        {
            var hr = rows.MaxBy(r => r.Counts.Hr)!;
            static int H(PlayerRow r) => r.Counts.Single + r.Counts.Double + r.Counts.Triple + r.Counts.Hr;
            var hits = rows.MaxBy(H)!;
            if (hr.Counts.Hr >= 20) parts.Add($"Best: {hr.Counts.Hr} HR ({hr.Year})");
            else if (H(hits) > 0) parts.Add($"Best: {H(hits)} H ({hits.Year})");
        }
        return string.Join(" · ", parts);
    }

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

    internal static SeasonCounts Add(SeasonCounts a, SeasonCounts b) => new(a.Pa + b.Pa, a.KKnownPa + b.KKnownPa, a.K + b.K,
        a.Bb + b.Bb, a.Hbp + b.Hbp, a.Single + b.Single, a.Double + b.Double, a.Triple + b.Triple, a.Hr + b.Hr);

    private static SeasonCounts Scale(SeasonCounts c, double f) => new((int)Math.Round(c.Pa * f), (int)Math.Round(c.KKnownPa * f), (int)Math.Round(c.K * f),
        (int)Math.Round(c.Bb * f), (int)Math.Round(c.Hbp * f), (int)Math.Round(c.Single * f), (int)Math.Round(c.Double * f), (int)Math.Round(c.Triple * f), (int)Math.Round(c.Hr * f));

    /// <summary>Plan 38: pitchers' batting decade line; a decade with under 20,000 plate appearances uses the decade before.</summary>
    public const int PitcherBatMinPa = 30, PitcherBatScaledPa = 3000, DecadeMinPa = 20000;

    /// <summary>
    /// Plan 38: the batting line a pitcher hits with when there is no DH: his own line if 30+ PA that season, else his
    /// decade's pitcher line. Null when there is no data at all.
    /// </summary>
    public static SeasonCounts? PitcherBattingLine(Dictionary<int, SeasonCounts> decades, SeasonCounts? own, int year)
    {
        SeasonCounts? line = null;
        for (var dec = year / 10 * 10; dec >= 1870; dec -= 10)
            if (decades.TryGetValue(dec, out var c) && c.Pa >= DecadeMinPa) { line = c; break; }
        line ??= decades.Values.Where(c => c.Pa > 0).OrderByDescending(c => c.Pa).FirstOrDefault();
        // Plan 38 as approved: his own line when he has 30+ PA that season, else the decade line. Either way scaled to
        // 3000 PA so the engine's pull toward the non-pitcher league average barely moves it.
        var use = own is { } mine && mine.Pa >= PitcherBatMinPa ? mine : line;
        if (use is null || use.Pa == 0) return null;
        return Scale(use, (double)PitcherBatScaledPa / use.Pa);
    }

    private sealed class Oracle(Loaded d) : Challenges.IMatchupOracle
    {
        /// <summary>Builds the decade pitcher-batting table now (it scans every batting season), outside any transaction.</summary>
        public void Warm() { lock (d) _ = d.PitcherBatting; }

        public string LeagueOf(Challenges.PickRef p, bool pitcher)
        {
            var row = pitcher ? d.Cat.Pitcher(p.Id, p.Year)?.Row : d.Cat.Batter(p.Id, p.Year)?.Row;
            return row is null ? "NL" : row.PaAl > 0 ? "AL" : row.PaNl > 0 ? "NL" : "FL";
        }

        public Rates? PitcherAtBat(Challenges.PickRef pb, Challenges.PickRef pitcher)
        {
            var pit = d.Cat.Pitcher(pitcher.Id, pitcher.Year);
            var asPitcher = d.Cat.Pitcher(pb.Id, pb.Year);
            var asBatter = d.Cat.Batter(pb.Id, pb.Year);
            if (pit == null || (asPitcher == null && asBatter == null)) return null;
            Dictionary<int, SeasonCounts> decades;
            lock (d) decades = d.PitcherBatting;
            var counts = PitcherBattingLine(decades, asBatter?.Row.Counts, pb.Year);
            if (counts is null) return null;
            var row = asBatter?.Row ?? asPitcher!.Row;
            var input = new PlayerInput(counts, d.Cat.PlayerLeague(row, "bat"), null, d.Cat.PlatoonFor(pb.Year));
            var bp = d.People.GetValueOrDefault(pb.Id);
            var pp = d.People.GetValueOrDefault(pitcher.Id);
            bool? same = bp is { Bats: "L" or "R" or "B" } && pp is { Throws: "L" or "R" } ? bp.Bats != "B" && bp.Bats == pp.Throws : null;
            return Matchup.Compute(input, pit.Input, d.Neutral, d.NeutralPlatoon, EngineOptions.Default, same).Probabilities;
        }

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

        public IReadOnlyList<Challenges.PickRef>[] RandomPool(bool pitchers, int level)
        {
            level = Math.Clamp(level, Challenges.Rules.MinLevel, Challenges.Rules.MaxLevel);
            lock (d)
            {
                if (!d.Levels.TryGetValue((pitchers, level), out var eras)) d.Levels[(pitchers, level)] = eras = BuildLevel(d, pitchers, level);
                return eras;
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

        /// <summary>Plan 26 levels. Strength = Loaded.Score (era-adjusted); higher is better for batters, lower for pitchers.
        /// 1 every real-workload season; 2 the better half of each era; 3 Hall of Famers' seasons in that better half;
        /// 4 the best 5% of each era (pitchers first need 600+ batters faced, so starters only). Call under lock(d).</summary>
        private static IReadOnlyList<Challenges.PickRef>[] BuildLevel(Loaded d, bool pit, int level)
        {
            var floor = pit ? PitFloor : BatFloor;
            var rows = (pit ? d.Pit : d.Bat).Values.SelectMany(v => v).Where(r => r.Counts.Pa >= floor).ToList();
            var eras = new IReadOnlyList<Challenges.PickRef>[5];
            for (var e = 0; e < eras.Length; e++)
            {
                var inEra = rows.Where(r => EraBucket(r.Year) == e);
                if (level == 4 && pit) inEra = inEra.Where(r => r.Counts.Pa >= LegendPitFloor);
                var list = inEra.ToList();
                var better = (pit ? list.OrderBy(r => d.Score(r, true)) : list.OrderByDescending(r => d.Score(r, false))).ThenBy(r => r.Id).ThenBy(r => r.Year).ToList();
                IEnumerable<PlayerRow> pick = level switch
                {
                    2 => better.Take((better.Count + 1) / 2),
                    3 => better.Take((better.Count + 1) / 2).Where(r => d.People.TryGetValue(r.Id, out var p) && p.Hof == "HOF"),
                    4 => better.Take(better.Count == 0 ? 0 : Math.Max(1, (int)Math.Ceiling(better.Count * 0.05))),
                    _ => better,
                };
                eras[e] = pick.OrderBy(r => r.Id, StringComparer.Ordinal).ThenBy(r => r.Year).Select(r => new Challenges.PickRef(r.Id, r.Year)).ToList();
            }
            return eras;
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
