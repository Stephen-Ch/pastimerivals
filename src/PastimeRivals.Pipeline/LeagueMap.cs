namespace PastimeRivals.Pipeline;

/// <summary>Maps a Retrosheet team code and season to its league, from Retrosheet's TEAMABR.TXT.</summary>
public sealed class LeagueMap
{
    // TEAMABR.TXT lists 2021 as the last year for clubs that still exist; treat those as active to the present.
    private const int StaleActiveYear = 2021;
    private readonly List<(string Team, string League, int First, int Last)> _rows = new();

    public static LeagueMap FromTeamAbr(IEnumerable<string> lines)
    {
        var map = new LeagueMap();
        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var f = Csv.ParseLine(line.Trim());
            if (f.Length < 6 || !int.TryParse(f[4], out var first) || !int.TryParse(f[5], out var last)) continue;
            if (last >= StaleActiveYear) last = 9999;
            map._rows.Add((f[0], f[1], first, last));
        }
        return map;
    }

    public string? LeagueOf(string team, int year)
    {
        foreach (var r in _rows)
            if (r.Team == team && year >= r.First && year <= r.Last) return r.League;
        return null;
    }

    /// <summary>The product covers the American, National and Federal Leagues (D7: Negro Leagues later).</summary>
    public static bool IsIncluded(string? league) => league is "AL" or "NL" or "FL";
}
