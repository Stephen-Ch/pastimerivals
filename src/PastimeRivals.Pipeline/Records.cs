namespace PastimeRivals.Pipeline;

/// <summary>One batter's line in one game (Retrosheet batting.csv, stattype=value, regular season).</summary>
public sealed record BattingLine(string Gid, string Id, string Team, int Year, int Pa,
    int H, int D, int T, int Hr, int Bb, int Ibb, int Hbp, int? K, string Pbp);

/// <summary>One pitcher's line in one game (Retrosheet pitching.csv).</summary>
public sealed record PitchingLine(string Gid, string Id, string Team, int Year, int? Bfp,
    int H, int D, int T, int Hr, int Bb, int Ibb, int Hbp, int? K, int IpOuts, string Pbp);

/// <summary>Counts for the eight plate-appearance outcomes. Oip (out in play) is everything else.</summary>
public sealed class Counts
{
    public int Pa { get; set; }
    public int K { get; set; }
    public int KKnownPa { get; set; }
    public int Bb { get; set; }
    public int Ibb { get; set; }
    public int Hbp { get; set; }
    public int H { get; set; }
    public int Double { get; set; }
    public int Triple { get; set; }
    public int Hr { get; set; }
    public int Single => H - Double - Triple - Hr;
    public int Oip => Pa - K - Bb - Hbp - H;

    public void Add(int pa, int? k, int bb, int ibb, int hbp, int h, int d, int t, int hr)
    {
        Pa += pa; Bb += bb; Ibb += ibb; Hbp += hbp; H += h; Double += d; Triple += t; Hr += hr;
        if (k.HasValue) { K += k.Value; KKnownPa += pa; }
    }
}

public sealed class PlayerSeason
{
    public required string Id { get; init; }
    public required int Year { get; init; }
    public Counts Counts { get; } = new();
    public Dictionary<string, int> PaByLeague { get; } = new();
    public SortedSet<string> TeamSet { get; } = new(StringComparer.Ordinal);
    public string Teams => string.Join("/", TeamSet);
    public int Games { get; set; }
    public int PbpGames { get; set; }
    public int IpOuts { get; set; }
    /// <summary>Games where batters faced was not recorded and was estimated (outs + H + BB + HBP).</summary>
    public int EstimatedGames { get; set; }

    /// <summary>A: play-by-play for at least 90% of games. B: box scores only. C: some strikeouts unknown or batters faced estimated.</summary>
    public char Grade => Counts.KKnownPa < Counts.Pa || EstimatedGames > 0 ? 'C' : Games > 0 && PbpGames >= 0.9 * Games ? 'A' : 'B';
}

public sealed class LeagueSeason
{
    public required int Year { get; init; }
    public required string League { get; init; }
    /// <summary>Batting by non-pitchers: the environment a hitter is compared against.</summary>
    public Counts Batting { get; } = new();
    /// <summary>Every batter faced: the environment a pitcher is compared against.</summary>
    public Counts Pitching { get; } = new();
}

public sealed record BuildResult(List<PlayerSeason> Batters, List<PlayerSeason> Pitchers, List<LeagueSeason> Leagues);
