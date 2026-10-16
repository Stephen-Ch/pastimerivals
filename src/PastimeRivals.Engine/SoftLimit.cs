namespace PastimeRivals.Engine;

/// <summary>
/// Compresses extreme player-to-league ratios on a log scale so dead-ball and 1920s outliers stay plausible
/// while keeping their order (Ruth 1927 still beats Cravath 1915). Ratios between 1/T and T are untouched.
/// </summary>
public static class SoftLimit
{
    public static double Apply(double ratio, EngineOptions o)
    {
        if (!(ratio > 0)) return 0;
        var t = o.SoftLimitThreshold;
        if (ratio > t) return t * Math.Pow(ratio / t, o.SoftLimitPower);
        if (ratio < 1 / t) return (1 / t) * Math.Pow(ratio * t, o.SoftLimitPower);
        return ratio;
    }
}

public sealed record EngineOptions(double SoftLimitThreshold, double SoftLimitPower)
{
    public static readonly EngineOptions Default = new(2.5, 0.5);
}
