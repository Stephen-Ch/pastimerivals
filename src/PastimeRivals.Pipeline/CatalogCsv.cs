using PastimeRivals.Engine;

namespace PastimeRivals.Pipeline;

/// <summary>Loads the pipeline's output CSVs into a StatsCatalog (used by tests and the backtest).</summary>
public static class CatalogCsv
{
    public static StatsCatalog Load(string outDir)
    {
        var leagues = Rows(Path.Combine(outDir, "leagues.csv")).Select(r =>
            new LeagueRow(I(r, "year"), r["league"], r["side"], Counts(r)));
        var platoon = Directory.GetFiles(outDir, "platoon_*.csv").SelectMany(Rows).Select(r =>
            new PlatoonRow(I(r, "year"), r["matchup"] == "same", Counts(r)));
        var exposure = Directory.GetFiles(outDir, "exposure_*.csv").SelectMany(Rows).Select(r =>
            new ExposureRow(r["role"], r["id"], I(r, "year"), I(r, "pa_same_hand"), I(r, "pa_with_hand_known")));
        return new StatsCatalog(leagues, platoon, Players(Path.Combine(outDir, "batters.csv")),
            Players(Path.Combine(outDir, "pitchers.csv")), exposure);
    }

    private static IEnumerable<PlayerRow> Players(string path) => Rows(path).Select(r =>
        new PlayerRow(r["id"], I(r, "year"), I(r, "pa_al"), I(r, "pa_nl"), I(r, "pa_fl"), Counts(r), r["grade"][0]));

    private static SeasonCounts Counts(Dictionary<string, string> r) => new(I(r, "pa"),
        r.ContainsKey("k_known_pa") ? I(r, "k_known_pa") : I(r, "pa"), I(r, "k"), I(r, "bb"), I(r, "hbp"),
        I(r, "single"), I(r, "double"), I(r, "triple"), I(r, "hr"));

    private static int I(Dictionary<string, string> r, string k) => int.Parse(r[k]);

    private static IEnumerable<Dictionary<string, string>> Rows(string path)
    {
        using var reader = new StreamReader(path);
        var h = Csv.ParseLine(reader.ReadLine() ?? "");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = Csv.ParseLine(line);
            var d = new Dictionary<string, string>(h.Length);
            for (var i = 0; i < h.Length; i++) d[h[i]] = i < f.Length ? f[i] : "";
            yield return d;
        }
    }
}
