using System.Text;
using PastimeRivals.Engine;

namespace PastimeRivals.Pipeline;

/// <summary>
/// Predicts real plate appearances in a target season from each player's season `gap` years earlier and scores
/// the predictions by log loss (lower is better). Gap 1 = same-era test; gap 4 = era-shift test (02 section 3.9).
/// </summary>
public static class Backtest
{
    public sealed class Score
    {
        public double LogLoss; public long N;
        public void Add(Rates p, PlayOutcome actual) { LogLoss += -Math.Log(Math.Max(p.Values[(int)actual], 1e-9)); N++; }
        public double Mean => N == 0 ? double.NaN : LogLoss / N;
    }

    public static string Run(StatsCatalog cat, string raw, LeagueMap map, int first, int last, int gap, int minPa = 100)
    {
        var model = new Score(); var league = new Score(); var noEra = new Score();
        long skipped = 0;
        var cache = new Dictionary<(string, string, bool, int), (Rates M, Rates N)>();
        for (var y = first; y <= last; y++)
        {
            var neutralPlatoon = cat.PlatoonFor(y);
            foreach (var play in PlayByPlay.ReadPlays(Path.Combine(raw, "zips", $"{y}csvs.zip"), y, map))
            {
                if (play.BatHand is not ("L" or "R" or "B") || play.PitHand is not ("L" or "R")) { skipped++; continue; }
                var lg = map.LeagueOf(play.BatTeam, y);
                if (!LeagueMap.IsIncluded(lg)) { skipped++; continue; }
                var target = cat.LeagueRates(y, lg!, "bat");
                var same = PlayByPlay.IsSameHand(play.BatHand, play.PitHand);
                var lgPred = Rates.Normalize(Enumerable.Range(0, 8).Select(i => target.Values[i] *
                    (same ? neutralPlatoon.Same[i] : neutralPlatoon.Opposite[i])).ToArray());

                var b = cat.Batter(play.Batter, y - gap);
                var p = cat.Pitcher(play.Pitcher, y - gap);
                if (b == null || p == null || b.Row.Counts.Pa < minPa || p.Row.Counts.Pa < minPa) { skipped++; continue; }

                var key = (play.Batter, play.Pitcher, same, y);
                if (!cache.TryGetValue(key, out var preds))
                {
                    var m = Matchup.Compute(b.Input, p.Input, target, neutralPlatoon, EngineOptions.Default, same).Probabilities;
                    // No era adjustment: old rates treated as if earned in the target league.
                    var bNo = b.Input with { League = target, OwnEraPlatoon = null };
                    var pNo = p.Input with { League = target, OwnEraPlatoon = null };
                    var n = Matchup.Compute(bNo, pNo, target, neutralPlatoon, EngineOptions.Default, same).Probabilities;
                    cache[key] = preds = (m, n);
                }
                var actual = play.PlayOutcome;
                model.Add(preds.M, actual); noEra.Add(preds.N, actual); league.Add(lgPred, actual);
            }
            cache.Clear();
        }
        var sb = new StringBuilder();
        sb.Append($"Backtest {first}-{last}, predicting from {gap} season(s) earlier, players with {minPa}+ PA then.\n");
        sb.Append($"Plate appearances scored: {model.N:N0} (skipped {skipped:N0}).\n\n");
        sb.Append("| Method | Mean log loss | vs league-only |\n|---|---|---|\n");
        foreach (var (name, s) in new[] { ("League average + platoon", league), ("Model, no era adjustment", noEra), ("Model (rate-ratio, era-adjusted)", model) })
            sb.Append($"| {name} | {s.Mean:F5} | {s.Mean - league.Mean:+0.00000;-0.00000;0} |\n");
        return sb.ToString();
    }
}
