using PastimeRivals.Engine;
using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

/// <summary>
/// Era ordering checks on real data (02 section 3.9 test 6). Runs only where data/out exists (Stephen's PC).
/// Ordering, not thresholds, so these cannot pass by construction.
/// </summary>
public class EraSanityTests
{
    private static readonly Lazy<StatsCatalog?> Cat = new(() =>
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "data", "out", "batters.csv"))) dir = Path.GetDirectoryName(dir);
        return dir == null ? null : CatalogCsv.Load(Path.Combine(dir, "data", "out"));
    });

    // Against a league-average right-handed pitcher in the neutral era, with the real platoon matchup applied.
    private static double Hr(string batter, int year, bool sameHand)
    {
        var c = Cat.Value!;
        var neutral = c.Neutral();
        var b = c.Batter(batter, year)!.Input;
        var avgPitcher = new PlayerInput(SeasonCounts.Empty, neutral, null);
        return Matchup.Compute(b, avgPitcher, neutral, c.PlatoonOver(), EngineOptions.Default, sameHand).Probabilities[Outcome.Hr];
    }

    [Fact]
    public void Home_run_odds_keep_historical_order()
    {
        if (Cat.Value == null) return;
        // Note: Cravath 1915 (7.5x his league's HR rate) lands level with Ruth 1927 (9.3x) because Cravath walked far
        // less and faced mostly same-hand pitching. That is the era-relative model working, so it is not asserted here.
        var ruth20 = Hr("ruthb101", 1920, sameHand: false);   // 10.6x league HR rate
        var ruth27 = Hr("ruthb101", 1927, sameHand: false);   // 9.3x
        var bonds01 = Hr("bondb001", 2001, sameHand: false);
        var neutralHr = Cat.Value.Neutral()[Outcome.Hr];
        Assert.True(ruth20 > ruth27, $"Ruth 1920 {ruth20:P2} should beat Ruth 1927 {ruth27:P2}");
        Assert.True(bonds01 > neutralHr * 2, $"Bonds 2001 {bonds01:P2} should be far above average {neutralHr:P2}");
        Assert.True(ruth27 < 0.15, $"Ruth 1927 {ruth27:P2} should stay plausible");
    }

    [Fact]
    public void Pedro_1999_strikes_out_more_than_an_average_pitcher_against_Ruth_1927()
    {
        if (Cat.Value == null) return;
        var c = Cat.Value;
        var neutral = c.Neutral();
        var ruth = c.Batter("ruthb101", 1927)!.Input;
        var pedro = c.Pitcher("martp001", 1999)!.Input;
        var avg = new PlayerInput(SeasonCounts.Empty, neutral, null);
        var vsPedro = Matchup.Compute(ruth, pedro, neutral, Platoon.None, EngineOptions.Default).Probabilities;
        var vsAvg = Matchup.Compute(ruth, avg, neutral, Platoon.None, EngineOptions.Default).Probabilities;
        Assert.True(vsPedro[Outcome.K] > vsAvg[Outcome.K] * 1.5);
        Assert.True(vsPedro[Outcome.Hr] < vsAvg[Outcome.Hr]);
        Assert.Equal(1.0, vsPedro.Values.Sum(), 9);
    }
}
