namespace PastimeRivals.Engine;

/// <summary>Plan 38: how an out in play happened (Error = the batter reached on an error). None for every other outcome.</summary>
public enum OutType { None, Ground, Fly, Line, Pop, Error }

/// <summary>One plate appearance played out on the bases. Bases hold player ids (index 0 = first base).</summary>
public sealed record PlayResult(
    Outcome Outcome, OutType OutType, int OutsBefore, string?[] BasesBefore,
    int OutsAfter, string?[] BasesAfter, IReadOnlyList<string> Scored, IReadOnlyList<string> RunnersOut, bool DoublePlay, bool SacFly);

/// <summary>
/// Plan 38 base running (research 37). Rates are modern MLB averages, one table for all eras. Marked rates are
/// calibration estimates (see the calibration tests). All draws come from the caller's seeded stream, in a fixed
/// order, so the same seed always gives the same play. Version 1 is frozen: a change adds a new version.
/// </summary>
public static class BaseRunning
{
    public const int Version = 1;

    // Research 37 section 2: out-in-play split (2004 batted-ball mix times out rates).
    public const double GroundShare = 0.49, FlyShare = 0.37, LineShare = 0.08;   // pop = the rest (0.06)

    // Section 1.
    public const double R2ScoresOnSingle = 0.60, R2ScoresOnSingleTwoOut = 0.80;   // two-out value: estimate
    public const double R1ToThirdOnSingle = 0.28;
    public const double R1ScoresOnDouble = 0.41, R1ScoresOnDoubleTwoOut = 0.60;   // two-out value: estimate
    public const double ThrownOutOnTry = 0.03;                                     // estimate
    public const double GroundDoublePlay = 0.45, GroundForceAtSecond = 0.25;      // rest: batter out, runners move (estimates)
    public const double GroundR2Advances = 0.55, GroundR3Scores = 0.50;          // estimates
    public const double FlyR3Scores = 0.78, FlyR3ThrownOut = 0.025, FlyR2Tags = 0.38;
    public const double LineDoubledOff = 0.03;                                     // estimate; line advances are half the fly rates

    /// <summary>
    /// Share of outs in play where the batter reaches on an error, by the pitching side's season (stand-in for that
    /// team's defense). Retrosheet (Sawyer, "The Changing Game Revisited"): about 5% in 1916-21, 3% in 1971, 2.5% in
    /// 2019; years before 1918 use the 1916 rate; straight-line steps between.
    /// </summary>
    public static double ReachOnErrorShare(int season)
    {
        if (season <= 1918) return 0.05;
        if (season <= 1971) return 0.05 + (0.03 - 0.05) * (season - 1918) / (1971.0 - 1918);
        if (season <= 2019) return 0.03 + (0.025 - 0.03) * (season - 1971) / (2019.0 - 1971);
        return 0.025;
    }

    public static OutType SplitOip(SeededRandom r, double reachOnError = 0)
    {
        if (r.NextDouble() < reachOnError) return OutType.Error;
        var x = r.NextDouble();
        return x < GroundShare ? OutType.Ground : x < GroundShare + FlyShare ? OutType.Fly : x < GroundShare + FlyShare + LineShare ? OutType.Line : OutType.Pop;
    }

    /// <summary>Plays one outcome. Call only with outsBefore &lt; 3. The out type must be given for Oip (from SplitOip).</summary>
    public static PlayResult Apply(Outcome o, OutType ot, int outsBefore, string?[] basesBefore, string batter, SeededRandom r)
    {
        if (outsBefore is < 0 or > 2) throw new ArgumentOutOfRangeException(nameof(outsBefore));
        var b = (string?[])basesBefore.Clone();
        var outs = outsBefore;
        var scored = new List<string>();
        var runnersOut = new List<string>();
        bool dp = false, sf = false;
        bool Roll(double p) => r.NextDouble() < p;

        void Score(int i) { scored.Add(b[i]!); b[i] = null; }
        void Out(int i) { runnersOut.Add(b[i]!); b[i] = null; outs++; }
        // Force: batter takes first, pushing forced runners one base each.
        void Force()
        {
            if (b[0] is not null)
            {
                if (b[1] is not null)
                {
                    if (b[2] is not null) Score(2);
                    b[2] = b[1];
                }
                b[1] = b[0];
            }
            b[0] = batter;
        }

        switch (o)
        {
            case Outcome.K:
                outs++;
                break;
            case Outcome.Bb:
            case Outcome.Hbp:
                Force();
                break;
            case Outcome.Single:
            {
                if (b[2] is not null) Score(2);
                if (b[1] is not null)
                {
                    if (Roll(outsBefore == 2 ? R2ScoresOnSingleTwoOut : R2ScoresOnSingle))
                    {
                        if (Roll(ThrownOutOnTry)) Out(1); else Score(1);
                    }
                    else { b[2] = b[1]; b[1] = null; }
                }
                if (b[0] is not null && outs < 3)
                {
                    if (b[2] is null && Roll(R1ToThirdOnSingle))
                    {
                        if (Roll(ThrownOutOnTry)) Out(0); else { b[2] = b[0]; b[0] = null; }
                    }
                    else { b[1] = b[0]; b[0] = null; }
                }
                else if (b[0] is not null) b[0] = null;   // inning already over: he simply is not on base
                if (outs < 3) b[0] = batter;
                break;
            }
            case Outcome.Double:
            {
                if (b[2] is not null) Score(2);
                if (b[1] is not null) Score(1);
                if (b[0] is not null)
                {
                    if (Roll(outsBefore == 2 ? R1ScoresOnDoubleTwoOut : R1ScoresOnDouble))
                    {
                        if (Roll(ThrownOutOnTry)) Out(0); else Score(0);
                    }
                    else { b[2] = b[0]; b[0] = null; }
                }
                if (outs < 3) b[1] = batter;
                break;
            }
            case Outcome.Triple:
                for (var i = 2; i >= 0; i--) if (b[i] is not null) Score(i);
                b[2] = batter;
                break;
            case Outcome.Hr:
                for (var i = 2; i >= 0; i--) if (b[i] is not null) Score(i);
                scored.Add(batter);
                break;
            case Outcome.Oip:
                switch (ot)
                {
                    case OutType.Error:   // batter safe on an error: every runner moves up one base
                        for (var i = 2; i >= 0; i--)
                            if (b[i] is not null) { if (i == 2) Score(2); else { b[i + 1] = b[i]; b[i] = null; } }
                        b[0] = batter;
                        break;
                    case OutType.Pop:
                        outs++;
                        break;
                    case OutType.Fly:
                    case OutType.Line:
                    {
                        var half = ot == OutType.Line ? 0.5 : 1.0;
                        outs++;
                        if (outs >= 3) break;
                        if (ot == OutType.Line && b.Any(x => x is not null) && Roll(LineDoubledOff))
                        {
                            var lead = b[2] is not null ? 2 : b[1] is not null ? 1 : 0;
                            Out(lead); dp = true;
                            if (outs >= 3) break;
                        }
                        if (b[2] is not null)
                        {
                            var x = r.NextDouble();
                            if (x < FlyR3Scores * half) { Score(2); sf = ot == OutType.Fly; }
                            else if (x < FlyR3Scores * half + FlyR3ThrownOut * half) { Out(2); if (outs >= 3) break; }
                        }
                        if (b[1] is not null && b[2] is null && Roll(FlyR2Tags * half)) { b[2] = b[1]; b[1] = null; }
                        break;
                    }
                    default:   // ground
                    {
                        if (b[0] is not null && outsBefore < 2)
                        {
                            var x = r.NextDouble();
                            if (x < GroundDoublePlay)
                            {
                                Out(0); outs++; dp = true;   // runner at second, batter at first
                                if (outs >= 3) break;
                                // 0 outs before: the others move up and the run from third scores (no force on the third out)
                                if (b[2] is not null) Score(2);
                                if (b[1] is not null) { b[2] = b[1]; b[1] = null; }
                                break;
                            }
                            if (x < GroundDoublePlay + GroundForceAtSecond)
                            {
                                // force at second: the runner from first is out; other forced runners move; batter safe at first
                                Out(0);
                                if (b[1] is not null) { if (b[2] is not null) Score(2); b[2] = b[1]; b[1] = null; }
                                else if (b[2] is not null && Roll(GroundR3Scores)) Score(2);
                                b[0] = batter;
                                break;
                            }
                            // batter out, runners move up one (forced ones always)
                            outs++;
                            if (b[1] is not null) { if (b[2] is not null) Score(2); b[2] = b[1]; b[1] = null; }
                            else if (b[2] is not null && Roll(GroundR3Scores)) Score(2);
                            b[1] = b[0]; b[0] = null;
                            break;
                        }
                        outs++;   // batter out at first
                        if (outs >= 3) break;
                        if (b[2] is not null && Roll(GroundR3Scores)) Score(2);
                        if (b[1] is not null && b[2] is null && Roll(GroundR2Advances)) { b[2] = b[1]; b[1] = null; }
                        break;
                    }
                }
                break;
        }

        if (outs > 3) outs = 3;
        // Third out by force or by the batter before first: runs on that play do not count (Rule 5.08 exception).
        var forcedThird = outs == 3 && o == Outcome.Oip && ot == OutType.Ground;
        if (forcedThird) scored.Clear();
        if (outs == 3) Array.Clear(b);
        return new PlayResult(o, o == Outcome.Oip ? ot : OutType.None, outsBefore, basesBefore, outs, b, scored, runnersOut, dp, sf);
    }
}

/// <summary>Plan 38: one half inning (or more, for extras) for calibration and the game loop.</summary>
public static class HalfInning
{
    /// <summary>
    /// Plays one half inning. ratesFor(spot) gives the odds for the lineup spot; the lineup continues from startSpot.
    /// seedFor(paIndex) gives each plate appearance's seed (outcome draw, out split and running draws use separate streams).
    /// stopWhenRunsReach: walk-off limit (runs needed to win in the bottom half), or int.MaxValue.
    /// </summary>
    public static (List<PlayResult> Plays, int Runs, int NextSpot) Play(
        Func<int, Rates> ratesFor, Func<int, string> idFor, int lineupLength, int startSpot, Func<int, ulong> seedFor,
        string? runnerOnSecond = null, int stopWhenRunsReach = int.MaxValue, int maxPa = 60, double reachOnError = 0)
    {
        var plays = new List<PlayResult>();
        var bases = new string?[3];
        if (runnerOnSecond is not null) bases[1] = runnerOnSecond;
        int outs = 0, runs = 0, spot = startSpot;
        for (var n = 0; outs < 3 && n < maxPa; n++)
        {
            var seed = seedFor(n);
            var outcome = Simulator.Draw(ratesFor(spot), new SeededRandom(seed));
            var run = new SeededRandom(seed ^ 0xBA5E0B5E0B5E0B5EUL);
            var ot = outcome == Outcome.Oip ? BaseRunning.SplitOip(run, reachOnError) : OutType.None;
            var p = BaseRunning.Apply(outcome, ot, outs, bases, idFor(spot), run);
            var scoredNow = p.Scored.Count;
            if (runs + scoredNow >= stopWhenRunsReach && outcome != Outcome.Hr)
            {
                // walk-off: runs count up to and including the winning run (all runs on a home run)
                var keep = stopWhenRunsReach - runs;
                p = p with { Scored = p.Scored.Take(keep).ToList() };
                scoredNow = keep;
            }
            if (runs + scoredNow >= stopWhenRunsReach) p = p with { BasesAfter = new string?[3] };   // game over: freeze the bases display
            plays.Add(p);
            runs += scoredNow;
            outs = p.OutsAfter;
            bases = p.BasesAfter;
            spot = (spot + 1) % lineupLength;
            if (runs >= stopWhenRunsReach) break;
        }
        return (plays, runs, spot);
    }
}
