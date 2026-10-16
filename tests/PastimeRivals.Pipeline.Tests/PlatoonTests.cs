using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class PlatoonTests
{
    [Theory]
    [InlineData("R", "R", true)]
    [InlineData("L", "L", true)]
    [InlineData("L", "R", false)]
    [InlineData("B", "R", false)] // switch hitters bat from the opposite side
    [InlineData("B", "L", false)]
    public void Same_hand_means_batter_and_pitcher_match(string bat, string pit, bool same) =>
        Assert.Equal(same, PlayByPlay.IsSameHand(bat, pit));

    [Fact]
    public void Unknown_hand_is_skipped()
    {
        var b = new PlatoonBuilder();
        b.Add(new PlayRecord(1950, "x", "y", "?", "R", PlayOutcome.Single));
        Assert.Equal(0, b.Same(1950).Pa + b.Opposite(1950).Pa);
    }

    [Fact]
    public void Counts_outcomes_by_matchup_and_tracks_each_players_exposure()
    {
        var b = new PlatoonBuilder();
        b.Add(new PlayRecord(1950, "bat1", "pit1", "R", "R", PlayOutcome.K));
        b.Add(new PlayRecord(1950, "bat1", "pit2", "R", "L", PlayOutcome.Hr));
        b.Add(new PlayRecord(1950, "bat1", "pit2", "R", "L", PlayOutcome.Oip));

        Assert.Equal(1, b.Same(1950).Pa);
        Assert.Equal(1, b.Same(1950).K);
        Assert.Equal(2, b.Opposite(1950).Pa);
        Assert.Equal(1, b.Opposite(1950).Hr);
        Assert.Equal(1, b.Opposite(1950).Oip);
        Assert.Equal((1, 3), b.BatterExposure("bat1", 1950));
        Assert.Equal((0, 2), b.PitcherExposure("pit2", 1950));
    }

    [Theory]
    [InlineData("1", "0", "0", "0", "0", "0", "0", PlayOutcome.Single)]
    [InlineData("0", "1", "0", "0", "0", "0", "0", PlayOutcome.Double)]
    [InlineData("0", "0", "0", "1", "0", "0", "0", PlayOutcome.Hr)]
    [InlineData("0", "0", "0", "0", "1", "0", "0", PlayOutcome.Bb)]
    [InlineData("0", "0", "0", "0", "0", "1", "0", PlayOutcome.Hbp)]
    [InlineData("0", "0", "0", "0", "0", "0", "1", PlayOutcome.K)]
    [InlineData("0", "0", "0", "0", "0", "0", "0", PlayOutcome.Oip)]
    public void Classifies_a_plate_appearance(string single, string dbl, string triple, string hr, string walk, string hbp, string k, PlayOutcome expected) =>
        Assert.Equal(expected, PlayByPlay.Classify(single, dbl, triple, hr, walk, hbp, k));
}
