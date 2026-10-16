using System.Globalization;
using System.Text;

namespace PastimeRivals.Pipeline;

public static class OutputWriter
{
    private const string CountHeader = "pa,k_known_pa,k,bb,ibb,hbp,single,double,triple,hr,oip";

    private static string C(Counts c) => string.Join(",", c.Pa, c.KKnownPa, c.K, c.Bb, c.Ibb, c.Hbp, c.Single, c.Double, c.Triple, c.Hr, c.Oip);

    public static void WritePlayers(string path, IEnumerable<PlayerSeason> seasons)
    {
        var sb = new StringBuilder($"id,year,teams,pa_al,pa_nl,pa_fl,{CountHeader},games,pbp_games,est_games,ip_outs,grade,pos\n");
        foreach (var s in seasons)
            sb.Append(string.Join(",", s.Id, s.Year, s.Teams, s.PaByLeague.GetValueOrDefault("AL"),
                s.PaByLeague.GetValueOrDefault("NL"), s.PaByLeague.GetValueOrDefault("FL"), C(s.Counts),
                s.Games, s.PbpGames, s.EstimatedGames, s.IpOuts, s.Grade, s.Position)).Append('\n');
        File.WriteAllText(path, sb.ToString());
    }

    public static void WriteLeagues(string path, IEnumerable<LeagueSeason> leagues)
    {
        var sb = new StringBuilder($"year,league,side,{CountHeader}\n");
        foreach (var l in leagues)
        {
            sb.Append($"{l.Year},{l.League},bat,{C(l.Batting)}\n");
            sb.Append($"{l.Year},{l.League},pit,{C(l.Pitching)}\n");
        }
        File.WriteAllText(path, sb.ToString());
    }

    /// <summary>Writes people seen in the output, from Retrosheet biofile0.csv.</summary>
    public static void WritePeople(string path, string biofile, ISet<string> ids)
    {
        using var reader = new StreamReader(biofile);
        var header = Csv.ParseLine(reader.ReadLine() ?? "");
        int Ix(string n) => Array.IndexOf(header, n);
        int id = Ix("id"), first = Ix("usename"), last = Ix("lastname"), bats = Ix("bats"), throws = Ix("throws"),
            birth = Ix("birthdate"), hof = Ix("HOF"), height = Ix("height"), weight = Ix("weight");
        var sb = new StringBuilder("id,first,last,bats,throws,birth_year,hof,birth_date,height,weight\n");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            var f = Csv.ParseLine(line);
            if (!ids.Contains(f[id])) continue;
            var by = f[birth].Length >= 4 ? f[birth][..4] : "";
            var bd = f[birth].Length == 8 && int.TryParse(f[birth], out _) ? f[birth] : "";
            sb.Append(string.Join(",", f[id], Q(f[first]), Q(f[last]), f[bats], f[throws], by, Q(f[hof]), bd, Num(f[height]), Num(f[weight]))).Append('\n');
        }
        File.WriteAllText(path, sb.ToString());
    }

    private static string Num(string s) => int.TryParse(s, out var v) && v > 0 ? v.ToString() : "";

    /// <summary>Writes team code, league, city and years from TEAMABR.TXT (city only; no club nicknames are shown in the app).</summary>
    public static void WriteTeams(string path, IEnumerable<string> teamAbrLines)
    {
        var sb = new StringBuilder("code,league,city,first_year,last_year\n");
        foreach (var line in teamAbrLines)
        {
            var f = Csv.ParseLine(line.Trim());
            if (f.Length < 6) continue;
            sb.Append(string.Join(",", f[0], f[1], Q(f[2]), f[4], f[5])).Append('\n');
        }
        File.WriteAllText(path, sb.ToString());
    }

    private static string Q(string s) => s.Contains(',') || s.Contains('"') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
}
