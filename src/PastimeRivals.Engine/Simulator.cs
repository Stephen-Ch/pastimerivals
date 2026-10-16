namespace PastimeRivals.Engine;

/// <summary>
/// Deterministic generator (SplitMix64). Written out here, not System.Random, so a stored seed replays
/// the same outcome on every .NET version and server.
/// </summary>
public sealed class SeededRandom(ulong seed)
{
    private ulong _state = seed;

    public double NextDouble()
    {
        var z = _state += 0x9E3779B97F4A7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        z ^= z >> 31;
        return (z >> 11) * (1.0 / (1UL << 53));
    }
}

public static class Simulator
{
    /// <summary>Picks one outcome by walking the cumulative probabilities.</summary>
    public static Outcome Draw(Rates p, SeededRandom rng)
    {
        var u = rng.NextDouble();
        var cum = 0.0;
        for (var i = 0; i < Rates.Count; i++)
        {
            cum += p.Values[i];
            if (u < cum) return (Outcome)i;
        }
        return Outcome.Oip;
    }
}
