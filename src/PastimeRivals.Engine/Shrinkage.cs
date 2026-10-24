namespace PastimeRivals.Engine;

/// <summary>
/// Pulls small samples toward league average: rate = (count + k * league) / (n + k), then rescales to sum to 1.
/// k is the sample size at which a stat is about 50% signal. Starting values come from published stabilization
/// points converted to per-plate-appearance, 50%-reliability units (see 02-STATISTICAL-MODEL.md section 3.4);
/// they are tunable by the backtest.
/// </summary>
public static class Shrinkage
{
    //                                        K    BB   HBP   1B    2B    3B    HR   (OIP is the remainder)
    public static readonly double[] Batter  = { 65,  86, 215,  215,  600, 1000,  130 };
    public static readonly double[] Pitcher = { 55, 130, 580, 1700, 2000, 3000,  550 };
    // Plan 41: Negro Leagues seasons (short, from surviving box scores). Set from split-half reliability on 1933-1948 data.
    public static readonly double[] NglBatter  = { 65, 130, 1000, 1000, 600, 1000, 130 };
    public static readonly double[] NglPitcher = { 140, 200, 580, 1700, 2000, 3000, 900 };

    public static Rates Apply(SeasonCounts c, Rates league, double[] k)
    {
        var v = new double[Rates.Count];
        for (var i = 0; i < 7; i++)
        {
            var o = (Outcome)i;
            var n = c.Denominator(o);
            var observed = n > 0 ? c.Rate(o) : league[o];
            v[i] = (observed * n + k[i] * league[o]) / (n + k[i]);
        }
        v[7] = Math.Max(0, 1 - v.Take(7).Sum());
        return Rates.Normalize(v);
    }
}
