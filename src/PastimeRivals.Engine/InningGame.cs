namespace PastimeRivals.Engine;

/// <summary>Plan 38: era rules for a game, fixed when the game is created from the HOME side's first-choice picks.</summary>
public sealed record EraRules(bool DesignatedHitter, bool RunnerOnSecondInExtras, int Season)
{
    /// <summary>
    /// Newest season among the home side's first choices decides (research 37). DH on if (AL and season >= 1973) or
    /// season 2020 or season >= 2022. Same-season AL/NL tie or a player traded between leagues: the AL player decides.
    /// Federal League, Negro Leagues and other leagues: no DH. Extra-inning runner on second from 2020.
    /// </summary>
    public static EraRules From(IEnumerable<(int Season, string League)> homeFirstChoices)
    {
        var list = homeFirstChoices.ToList();
        if (list.Count == 0) throw new ArgumentException("No picks");
        var s = list.Max(p => p.Season);
        var al = list.Any(p => p.Season == s && string.Equals(p.League, "AL", StringComparison.OrdinalIgnoreCase));
        var dh = (al && s >= 1973) || s == 2020 || s >= 2022;
        return new EraRules(dh, s >= 2020, s);
    }

    /// <summary>Batting spots a side picks: 9 with the DH, 8 plus the pitcher batting 9th without it.</summary>
    public int PickedBatters => DesignatedHitter ? 9 : 8;
}

/// <summary>One plate appearance in an inning game.</summary>
public sealed record InningPlay(int Index, int Inning, int BattingSide, int Spot, string Batter, ulong Seed, PlayResult Play, int Runs);

public sealed record InningGameResult(IReadOnlyList<InningPlay> Plays, int[][] LineScore, int[] Totals, int Winner, int Innings);

/// <summary>
/// Plan 38: the inning game. Side 1 (visitors) bats first, side 0 (home) second. Each half until 3 outs; the order
/// carries over. Tied after the 1st: up to 3 extra innings, then a tie (Winner -1). Walk-off: the bottom half ends
/// the moment home leads (runs up to the winning run count; all runs on a home run). Pure: same inputs, same game.
/// </summary>
public static class InningGame
{
    public const int Version = 1;
    public const int MaxExtraInnings = 3;
    public const int LineupLength = 9;

    /// <param name="rates">rates(battingSide, spot) for the batter in that spot against the other side's pitcher.</param>
    /// <param name="ids">ids(battingSide, spot): player id in that spot (the pitcher's id in spot 8 without the DH).</param>
    /// <param name="seedFor">seed for plate appearance number n of the game.</param>
    /// <param name="reachOnError">reach-on-error share per batting side (from the fielding side's season).</param>
    /// <param name="maxPaPerHalf">safety cap on plate appearances in one half (the server uses 30 so a game fits its storage).</param>
    public static InningGameResult Play(Func<int, int, Rates> rates, Func<int, int, string> ids, EraRules era, Func<int, ulong> seedFor, Func<int, double> reachOnError,
        int maxPaPerHalf = 60)
    {
        var plays = new List<InningPlay>();
        var totals = new int[2];
        var line = new List<int>[] { new(), new() };
        var next = new int[2];
        var inning = 0;
        for (inning = 1; inning <= 1 + MaxExtraInnings; inning++)
        {
            foreach (var side in new[] { 1, 0 })
            {
                var extra = inning > 1;
                // Runner on second in extras: the player who batted just before this half's leadoff hitter.
                string? runner = extra && era.RunnerOnSecondInExtras ? ids(side, (next[side] + LineupLength - 1) % LineupLength) : null;
                var limit = side == 0 && totals[0] <= totals[1] ? totals[1] - totals[0] + 1 : int.MaxValue;   // walk-off
                var start = plays.Count;
                var half = HalfInning.Play(s => rates(side, s), s => ids(side, s), LineupLength, next[side],
                    n => seedFor(start + n), runner, limit, maxPaPerHalf, reachOnError(side));
                var spot = next[side];
                for (var i = 0; i < half.Plays.Count; i++)
                {
                    var p = half.Plays[i];
                    plays.Add(new InningPlay(plays.Count, inning, side, spot, ids(side, spot), seedFor(start + i), p, p.Scored.Count));
                    spot = (spot + 1) % LineupLength;
                }
                next[side] = half.NextSpot;
                totals[side] += half.Runs;
                line[side].Add(half.Runs);
            }
            if (totals[0] != totals[1]) break;
        }
        var innings = Math.Min(inning, 1 + MaxExtraInnings);
        var winner = totals[0] == totals[1] ? -1 : totals[0] > totals[1] ? 0 : 1;
        return new InningGameResult(plays, new[] { line[0].ToArray(), line[1].ToArray() }, totals, winner, innings);
    }
}
