using System.IO.Compression;

namespace PastimeRivals.Pipeline;

/// <summary>Reads regular-season, stattype=value lines from Retrosheet's yearly CSV zips (zips/{year}csvs.zip).</summary>
public sealed class RetrosheetSource(string rawDir)
{
    public string ZipPath(int year) => Path.Combine(rawDir, "zips", $"{year}csvs.zip");

    public IEnumerable<BattingLine> Batting(int year) =>
        Rows(year, "batting").Select(r => new BattingLine(r["gid"], r["id"], r["team"], year,
            I(r["b_pa"]), I(r["b_h"]), I(r["b_d"]), I(r["b_t"]), I(r["b_hr"]), I(r["b_w"]), I(r["b_iw"]),
            I(r["b_hbp"]), N(r["b_k"]), r["pbp"]));

    public IEnumerable<PitchingLine> Pitching(int year) =>
        Rows(year, "pitching").Select(r => new PitchingLine(r["gid"], r["id"], r["team"], year,
            N(r["p_bfp"]), I(r["p_h"]), I(r["p_d"]), I(r["p_t"]), I(r["p_hr"]), I(r["p_w"]), I(r["p_iw"]),
            I(r["p_hbp"]), N(r["p_k"]), I(r["p_ipouts"]), r["pbp"]));

    private IEnumerable<Dictionary<string, string>> Rows(int year, string kind)
    {
        using var zip = ZipFile.OpenRead(ZipPath(year));
        var entry = zip.GetEntry($"{year}{kind}.csv") ?? throw new FileNotFoundException($"{year}{kind}.csv missing in zip");
        using var reader = new StreamReader(entry.Open());
        var header = Csv.ParseLine(reader.ReadLine() ?? "");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = Csv.ParseLine(line);
            var row = new Dictionary<string, string>(header.Length);
            for (var i = 0; i < header.Length; i++) row[header[i]] = i < f.Length ? f[i] : "";
            if (row["gametype"] != "regular" || row["stattype"] != "value") continue;
            yield return row;
        }
    }

    private static int I(string s) => int.TryParse(s, out var v) ? v : 0;
    private static int? N(string s) => int.TryParse(s, out var v) ? v : null;
}
