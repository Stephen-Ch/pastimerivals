namespace PastimeRivals.Engine;

/// <summary>Everything the engine needs about one side of the matchup.</summary>
/// <summary>ShrinkK (plan 41): per-outcome shrinkage strengths for this row; null = the MLB values (Shrinkage.Batter / Pitcher).</summary>
public sealed record PlayerInput(SeasonCounts Counts, Rates League, Exposure? Exposure, Platoon? OwnEraPlatoon = null, double[]? ShrinkK = null);

/// <summary>Intermediate numbers for one outcome, kept so the app can explain the result.</summary>
public sealed record OutcomeStep(Outcome Outcome, double? BatterObserved, double BatterShrunk, double BatterLeague, double BatterRatio,
    double? PitcherObserved, double PitcherShrunk, double PitcherLeague, double PitcherRatio, double Neutral, double PlatoonFactor, double Final);

public sealed record MatchupResult(Rates Probabilities, IReadOnlyList<OutcomeStep> Steps, string EngineVersion);

/// <summary>
/// Rate-ratio matchup model (02-STATISTICAL-MODEL.md section 3.3):
/// raw_i = N_i * soft(b_i / Lb_i) * soft(p_i / Lp_i) * platoon_i, then rescaled to sum to 1.
/// b and p are shrunk toward their own league; each player's existing platoon mix is divided out first.
/// </summary>
public static class Matchup
{
    public static MatchupResult Compute(PlayerInput batter, PlayerInput pitcher, Rates neutral, Platoon neutralPlatoon,
        EngineOptions options, bool? sameHand = null)
    {
        var b = Shrinkage.Apply(batter.Counts, batter.League, batter.ShrinkK ?? Shrinkage.Batter);
        var p = Shrinkage.Apply(pitcher.Counts, pitcher.League, pitcher.ShrinkK ?? Shrinkage.Pitcher);
        var raw = new double[Rates.Count];
        var steps = new List<OutcomeStep>();
        foreach (var o in Enum.GetValues<Outcome>())
        {
            var bRatio = SoftLimit.Apply(b[o] / batter.League[o] / OwnPlatoon(batter, o), options);
            var pRatio = SoftLimit.Apply(p[o] / pitcher.League[o] / OwnPlatoon(pitcher, o), options);
            var platoon = sameHand switch
            {
                true => neutralPlatoon.Same[(int)o],
                false => neutralPlatoon.Opposite[(int)o],
                null => 1.0,
            };
            raw[(int)o] = neutral[o] * bRatio * pRatio * platoon;
            steps.Add(new OutcomeStep(o, Finite(batter.Counts.Rate(o)), b[o], batter.League[o], bRatio,
                Finite(pitcher.Counts.Rate(o)), p[o], pitcher.League[o], pRatio, neutral[o], platoon, 0));
        }
        var final = Rates.Normalize(raw);
        return new MatchupResult(final, steps.Select(s => s with { Final = final[s.Outcome] }).ToList(), EngineInfo.Version);
    }

    private static double? Finite(double x) => double.IsFinite(x) ? x : null;

    // Removes the platoon effect already baked into a player's season (his real mix of same- and opposite-hand opponents).
    private static double OwnPlatoon(PlayerInput x, Outcome o)
    {
        if (x.OwnEraPlatoon is null) return 1.0;
        var share = x.Exposure?.Share ?? x.OwnEraPlatoon.LeagueSameShare;
        return x.OwnEraPlatoon.Expected(o, share);
    }
}
