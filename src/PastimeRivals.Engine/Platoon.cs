namespace PastimeRivals.Engine;

/// <summary>
/// League-wide outcome multipliers for same-hand and opposite-hand matchups (rate in that matchup / overall rate),
/// and how often plate appearances were same-hand. Built from Retrosheet play-by-play.
/// </summary>
public sealed record Platoon(double[] Same, double[] Opposite, double LeagueSameShare)
{
    public static readonly Platoon None = new(Enumerable.Repeat(1.0, 8).ToArray(), Enumerable.Repeat(1.0, 8).ToArray(), 0.5);

    /// <summary>The platoon effect a player already carries in his season line, given his share of same-hand PA.</summary>
    public double Expected(Outcome o, double sameShare) => sameShare * Same[(int)o] + (1 - sameShare) * Opposite[(int)o];
}

/// <summary>Share of a player's plate appearances against same-hand opponents (null when unknown).</summary>
public sealed record Exposure(int SameHandPa, int KnownPa)
{
    public double? Share => KnownPa > 0 ? SameHandPa / (double)KnownPa : null;
}
