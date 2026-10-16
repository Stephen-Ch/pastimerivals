using System.IO.Compression;

namespace PastimeRivals.Pipeline;

/// <summary>Primary fielding position for a batter-season, from Retrosheet {year}allplayers.csv (plan 10).</summary>
public static class Positions
{
    // Fixed order also breaks ties.
    private static readonly string[] Order = { "c", "1b", "2b", "3b", "ss", "lf", "cf", "rf", "dh" };

    public static string Primary(IEnumerable<Dictionary<string, int>> teamRows)
    {
        var sum = new Dictionary<string, int>();
        foreach (var row in teamRows)
            foreach (var (k, v) in row) sum[k] = sum.GetValueOrDefault(k) + v;

        var best = Order.Select(p => (Pos: p, Games: sum.GetValueOrDefault(p))).Where(x => x.Games > 0)
            .Aggregate(((string Pos, int Games)?)null, (acc, x) => acc == null || x.Games > acc.Value.Games ? x : acc);
        var specificOf = sum.GetValueOrDefault("lf") + sum.GetValueOrDefault("cf") + sum.GetValueOrDefault("rf");
        var of = sum.GetValueOrDefault("of");
        if (specificOf == 0 && of > 0 && (best == null || of > best.Value.Games)) return "OF";
        return best?.Pos.ToUpperInvariant() ?? (sum.GetValueOrDefault("p") > 0 ? "P" : "PH");
    }

    /// <summary>Reads per team-season games by position for one year, keyed by player id.</summary>
    public static Dictionary<string, List<Dictionary<string, int>>> Read(string zipPath, int year)
    {
        var result = new Dictionary<string, List<Dictionary<string, int>>>();
        using var zip = ZipFile.OpenRead(zipPath);
        var entry = zip.GetEntry($"{year}allplayers.csv");
        if (entry == null) return result;
        using var reader = new StreamReader(entry.Open());
        var h = Csv.ParseLine(reader.ReadLine() ?? "");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = Csv.ParseLine(line);
            var row = new Dictionary<string, int>();
            for (var i = 0; i < h.Length && i < f.Length; i++)
                if (h[i].StartsWith("g_") && int.TryParse(f[i], out var g)) row[h[i][2..]] = g;
            var id = f[Array.IndexOf(h, "id")];
            if (!result.TryGetValue(id, out var list)) result[id] = list = new();
            list.Add(row);
        }
        return result;
    }
}
