namespace PastimeRivals.Engine;

/// <summary>The eight mutually exclusive ways a plate appearance can end.</summary>
public enum Outcome { K, Bb, Hbp, Single, Double, Triple, Hr, Oip }

/// <summary>Probabilities for the eight outcomes. Always non-negative and summing to 1.</summary>
public sealed class Rates
{
    public const int Count = 8;
    public double[] Values { get; }
    public double this[Outcome o] => Values[(int)o];

    private Rates(double[] v) => Values = v;

    /// <summary>Builds rates from the seven named outcomes; out in play is the remainder.</summary>
    public static Rates From(double k, double bb, double hbp, double single, double dbl, double triple, double hr)
    {
        var oip = 1 - (k + bb + hbp + single + dbl + triple + hr);
        return Normalize(new[] { k, bb, hbp, single, dbl, triple, hr, oip });
    }

    /// <summary>Clamps negatives to zero and rescales so the values sum to 1.</summary>
    public static Rates Normalize(double[] raw)
    {
        if (raw.Length != Count) throw new ArgumentException("Need 8 outcome values");
        var v = raw.Select(x => double.IsFinite(x) && x > 0 ? x : 0).ToArray();
        var sum = v.Sum();
        if (sum <= 0) throw new ArgumentException("All outcome values are zero");
        return new Rates(v.Select(x => x / sum).ToArray());
    }
}

/// <summary>Raw counts for one player-season (or a league). K uses its own denominator because early strikeouts are sometimes missing.</summary>
public sealed record SeasonCounts(int Pa, int KKnownPa, int K, int Bb, int Hbp, int Single, int Double, int Triple, int Hr)
{
    public static readonly SeasonCounts Empty = new(0, 0, 0, 0, 0, 0, 0, 0, 0);

    public int Oip => Pa - Bb - Hbp - Single - Double - Triple - Hr - (KKnownPa == Pa ? K : (int)Math.Round(KRate * Pa));
    public double KRate => KKnownPa > 0 ? K / (double)KKnownPa : 0;

    /// <summary>Test helper: counts that reproduce the given rates over pa plate appearances.</summary>
    public static SeasonCounts FromRates(int pa, Rates r)
    {
        int C(Outcome o) => (int)Math.Round(r[o] * pa);
        return new SeasonCounts(pa, pa, C(Outcome.K), C(Outcome.Bb), C(Outcome.Hbp), C(Outcome.Single),
            C(Outcome.Double), C(Outcome.Triple), C(Outcome.Hr));
    }

    /// <summary>Observed rate for one outcome (NaN when there is no sample).</summary>
    public double Rate(Outcome o) => o switch
    {
        Outcome.K => KKnownPa > 0 ? K / (double)KKnownPa : double.NaN,
        _ when Pa == 0 => double.NaN,
        Outcome.Bb => Bb / (double)Pa,
        Outcome.Hbp => Hbp / (double)Pa,
        Outcome.Single => Single / (double)Pa,
        Outcome.Double => Double / (double)Pa,
        Outcome.Triple => Triple / (double)Pa,
        Outcome.Hr => Hr / (double)Pa,
        _ => double.NaN, // out in play is derived as the remainder
    };

    /// <summary>Sample size behind one outcome's rate.</summary>
    public int Denominator(Outcome o) => o == Outcome.K ? KKnownPa : Pa;
}
