using System.IO.Compression;
using System.Text;

namespace PastimeRivals.Pipeline;

public enum PlayOutcome { K, Bb, Hbp, Single, Double, Triple, Hr, Oip }

public sealed record PlayRecord(int Year, string Batter, string Pitcher, string BatHand, string PitHand, PlayOutcome PlayOutcome, string BatTeam = "");

public static class PlayByPlay
{
    /// <summary>True when batter and pitcher throw/bat from the same side. Switch hitters ("B") always take the opposite side.</summary>
    public static bool IsSameHand(string batHand, string pitHand) => batHand != "B" && batHand == pitHand;

    public static PlayOutcome Classify(string single, string dbl, string triple, string hr, string walk, string hbp, string k) =>
        k == "1" ? PlayOutcome.K : walk == "1" ? PlayOutcome.Bb : hbp == "1" ? PlayOutcome.Hbp : hr == "1" ? PlayOutcome.Hr :
        triple == "1" ? PlayOutcome.Triple : dbl == "1" ? PlayOutcome.Double : single == "1" ? PlayOutcome.Single : PlayOutcome.Oip;

    /// <summary>Streams plate appearances from {year}plays.csv (regular season, pa=1).</summary>
    public static IEnumerable<PlayRecord> ReadPlays(string zipPath, int year, LeagueMap map)
    {
        using var zip = ZipFile.OpenRead(zipPath);
        var entry = zip.GetEntry($"{year}plays.csv");
        if (entry == null) yield break;
        using var reader = new StreamReader(entry.Open());
        var h = Csv.ParseLine(reader.ReadLine() ?? "");
        int Ix(string n) => Array.IndexOf(h, n);
        int pa = Ix("pa"), gt = Ix("gametype"), bat = Ix("batter"), pit = Ix("pitcher"), bh = Ix("bathand"), ph = Ix("pithand"),
            s = Ix("single"), d = Ix("double"), team = Ix("pitteam"), bteam = Ix("batteam"), t = Ix("triple"), hr = Ix("hr"), w = Ix("walk"), hbp = Ix("hbp"), k = Ix("k");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = line.Split(','); // plays.csv has no quoted fields in the columns used here
            if (f.Length <= gt || f[pa] != "1" || f[gt] != "regular") continue;
            if (!LeagueMap.IsIncluded(map.LeagueOf(f[team], year))) continue;
            yield return new PlayRecord(year, f[bat], f[pit], f[bh], f[ph], Classify(f[s], f[d], f[t], f[hr], f[w], f[hbp], f[k]), f[bteam]);
        }
    }
}

/// <summary>PlayOutcome counts by platoon matchup per season, plus each player's same-hand exposure.</summary>
public sealed class PlatoonBuilder
{
    private readonly Dictionary<int, (Counts Same, Counts Opp)> _years = new();
    private readonly Dictionary<(string, int), (int Same, int Total)> _bat = new();
    private readonly Dictionary<(string, int), (int Same, int Total)> _pit = new();

    public void Add(PlayRecord p)
    {
        if (p.BatHand is not ("L" or "R" or "B") || p.PitHand is not ("L" or "R")) return;
        if (!_years.TryGetValue(p.Year, out var y)) _years[p.Year] = y = (new Counts(), new Counts());
        var same = PlayByPlay.IsSameHand(p.BatHand, p.PitHand);
        var c = same ? y.Same : y.Opp;
        c.Add(1, p.PlayOutcome == PlayOutcome.K ? 1 : 0, p.PlayOutcome == PlayOutcome.Bb ? 1 : 0, 0, p.PlayOutcome == PlayOutcome.Hbp ? 1 : 0,
            p.PlayOutcome is PlayOutcome.Single or PlayOutcome.Double or PlayOutcome.Triple or PlayOutcome.Hr ? 1 : 0,
            p.PlayOutcome == PlayOutcome.Double ? 1 : 0, p.PlayOutcome == PlayOutcome.Triple ? 1 : 0, p.PlayOutcome == PlayOutcome.Hr ? 1 : 0);
        Bump(_bat, p.Batter, p.Year, same);
        Bump(_pit, p.Pitcher, p.Year, same);
    }

    private static void Bump(Dictionary<(string, int), (int Same, int Total)> d, string id, int year, bool same)
    {
        var v = d.GetValueOrDefault((id, year));
        d[(id, year)] = (v.Same + (same ? 1 : 0), v.Total + 1);
    }

    public Counts Same(int year) => _years.TryGetValue(year, out var y) ? y.Same : new Counts();
    public Counts Opposite(int year) => _years.TryGetValue(year, out var y) ? y.Opp : new Counts();
    public (int Same, int Total) BatterExposure(string id, int year) => _bat.GetValueOrDefault((id, year));
    public (int Same, int Total) PitcherExposure(string id, int year) => _pit.GetValueOrDefault((id, year));

    public void WriteYears(string path)
    {
        var sb = new StringBuilder("year,matchup,pa,k,bb,hbp,single,double,triple,hr,oip\n");
        foreach (var (year, (same, opp)) in _years.OrderBy(kv => kv.Key))
            foreach (var (name, c) in new[] { ("same", same), ("opposite", opp) })
                sb.Append($"{year},{name},{c.Pa},{c.K},{c.Bb},{c.Hbp},{c.Single},{c.Double},{c.Triple},{c.Hr},{c.Oip}\n");
        File.WriteAllText(path, sb.ToString());
    }

    public void WriteExposure(string path)
    {
        var sb = new StringBuilder("role,id,year,pa_same_hand,pa_with_hand_known\n");
        foreach (var ((id, y), v) in _bat.OrderBy(k => k.Key.Item2).ThenBy(k => k.Key.Item1)) sb.Append($"bat,{id},{y},{v.Same},{v.Total}\n");
        foreach (var ((id, y), v) in _pit.OrderBy(k => k.Key.Item2).ThenBy(k => k.Key.Item1)) sb.Append($"pit,{id},{y},{v.Same},{v.Total}\n");
        File.WriteAllText(path, sb.ToString());
    }
}
