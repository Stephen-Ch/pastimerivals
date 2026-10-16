using PastimeRivals.Engine;

namespace PastimeRivals.Api.Stats;

/// <summary>Development source: reads the pipeline's CSV output folder (Stats:CsvDir) instead of SQL Server.</summary>
public sealed class CsvStatsSource(IConfiguration cfg) : IStatsSource
{
    public Task<StatsBundle> LoadAsync()
    {
        var dir = cfg["Stats:CsvDir"] ?? throw new InvalidOperationException("Stats:CsvDir not set");
        static int I(Dictionary<string, string> r, string k) => int.TryParse(r.GetValueOrDefault(k), out var v) ? v : 0;
        static SeasonCounts C(Dictionary<string, string> r) => new(I(r, "pa"), r.ContainsKey("k_known_pa") ? I(r, "k_known_pa") : I(r, "pa"),
            I(r, "k"), I(r, "bb"), I(r, "hbp"), I(r, "single"), I(r, "double"), I(r, "triple"), I(r, "hr"));
        static PlayerRow P(Dictionary<string, string> r) => new(r["id"], I(r, "year"), I(r, "pa_al"), I(r, "pa_nl"), I(r, "pa_fl"), C(r), r["grade"][0]);

        var cat = new StatsCatalog(
            Rows(Path.Combine(dir, "leagues.csv")).Select(r => new LeagueRow(I(r, "year"), r["league"], r["side"], C(r))),
            Directory.GetFiles(dir, "platoon_*.csv").SelectMany(Rows).Select(r => new PlatoonRow(I(r, "year"), r["matchup"] == "same", C(r))),
            Rows(Path.Combine(dir, "batters.csv")).Select(P).Where(p => p.Counts.Pa > 0),
            Rows(Path.Combine(dir, "pitchers.csv")).Select(P).Where(p => p.Counts.Pa > 0),
            Directory.GetFiles(dir, "exposure_*.csv").SelectMany(Rows).Select(r =>
                new ExposureRow(r["role"], r["id"], I(r, "year"), I(r, "pa_same_hand"), I(r, "pa_with_hand_known"))));
        var people = Rows(Path.Combine(dir, "people.csv")).Select(r => new PersonRow(r["id"], r["first"], r["last"], r["bats"], r["throws"],
            int.TryParse(r["birth_year"], out var y) ? y : null, r["hof"])).ToList();
        return Task.FromResult(new StatsBundle(cat, people));
    }

    private static IEnumerable<Dictionary<string, string>> Rows(string path)
    {
        using var reader = new StreamReader(path);
        var h = Import.CsvTable.SplitLine(reader.ReadLine() ?? "");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = Import.CsvTable.SplitLine(line);
            var d = new Dictionary<string, string>(h.Length);
            for (var i = 0; i < h.Length; i++) d[h[i]] = i < f.Length ? f[i] : "";
            yield return d;
        }
    }
}
