using PastimeRivals.Engine;

namespace PastimeRivals.Engine.Tests;

public class EngineCoreTests
{
    // A modern-ish league: K 20%, BB 8%, HBP 1%, 1B 14%, 2B 4.5%, 3B 0.5%, HR 3%, OIP the rest
    private static readonly Rates League = Rates.From(0.20, 0.08, 0.01, 0.14, 0.045, 0.005, 0.03);

    private static SeasonCounts Counts(int pa, Rates r) => SeasonCounts.FromRates(pa, r);

    [Fact]
    public void Rates_always_sum_to_one_and_out_in_play_is_the_remainder()
    {
        Assert.Equal(1.0, League.Values.Sum(), 9);
        Assert.Equal(1 - 0.20 - 0.08 - 0.01 - 0.14 - 0.045 - 0.005 - 0.03, League[Outcome.Oip], 9);
    }

    [Fact]
    public void Average_batter_vs_average_pitcher_gives_the_neutral_environment()
    {
        var neutral = Rates.From(0.18, 0.09, 0.008, 0.15, 0.045, 0.006, 0.028);
        var m = Matchup.Compute(
            new PlayerInput(Counts(600, League), League, Exposure: null),
            new PlayerInput(Counts(800, League), League, Exposure: null),
            neutral, Platoon.None, EngineOptions.Default);
        foreach (var o in Enum.GetValues<Outcome>()) Assert.Equal(neutral[o], m.Probabilities[o], 9);
    }

    [Fact]
    public void Probabilities_sum_to_one_for_extreme_inputs()
    {
        var slugger = Rates.From(0.10, 0.20, 0.01, 0.10, 0.05, 0.01, 0.12);
        var deadBall = Rates.From(0.10, 0.07, 0.01, 0.20, 0.04, 0.015, 0.003);
        var m = Matchup.Compute(new PlayerInput(Counts(650, slugger), deadBall, null),
            new PlayerInput(Counts(900, League), League, null), League, Platoon.None, EngineOptions.Default);
        Assert.Equal(1.0, m.Probabilities.Values.Sum(), 9);
        Assert.All(m.Probabilities.Values, p => Assert.InRange(p, 0, 1));
    }

    [Fact]
    public void A_player_with_no_plate_appearances_is_league_average()
    {
        var s = Shrinkage.Apply(SeasonCounts.Empty, League, Shrinkage.Batter);
        foreach (var o in Enum.GetValues<Outcome>()) Assert.Equal(League[o], s[o], 9);
    }

    [Fact]
    public void A_huge_sample_keeps_its_own_rates()
    {
        var own = Rates.From(0.30, 0.12, 0.01, 0.12, 0.05, 0.004, 0.06);
        var s = Shrinkage.Apply(Counts(1_000_000, own), League, Shrinkage.Batter);
        foreach (var o in Enum.GetValues<Outcome>()) Assert.Equal(own[o], s[o], 3);
    }

    [Fact]
    public void Shrunk_rates_sum_to_one()
    {
        var own = Rates.From(0.30, 0.12, 0.01, 0.12, 0.05, 0.004, 0.06);
        Assert.Equal(1.0, Shrinkage.Apply(Counts(150, own), League, Shrinkage.Pitcher).Values.Sum(), 9);
    }

    [Theory]
    [InlineData(1.0, 1.0)]
    [InlineData(2.0, 2.0)]
    public void Soft_limit_leaves_ordinary_ratios_alone(double r, double expected) =>
        Assert.Equal(expected, SoftLimit.Apply(r, EngineOptions.Default), 9);

    [Fact]
    public void Soft_limit_compresses_extreme_ratios_but_keeps_their_order()
    {
        var o = EngineOptions.Default;
        Assert.True(SoftLimit.Apply(8, o) < 8);
        Assert.True(SoftLimit.Apply(8, o) > SoftLimit.Apply(5, o));
        Assert.True(SoftLimit.Apply(0.05, o) > 0.05);
        Assert.True(SoftLimit.Apply(0.05, o) < SoftLimit.Apply(0.2, o));
    }

    [Fact]
    public void Platoon_same_hand_raises_strikeouts_for_otherwise_average_players()
    {
        var platoon = new Platoon(
            Same: new[] { 1.10, 0.90, 1.0, 0.97, 0.97, 0.97, 0.92, 1.0 },
            Opposite: new[] { 0.94, 1.06, 1.0, 1.02, 1.02, 1.02, 1.05, 1.0 },
            LeagueSameShare: 0.4);
        var avg = new PlayerInput(Counts(600, League), League, Exposure: null);
        var same = Matchup.Compute(avg, avg, League, platoon, EngineOptions.Default, sameHand: true);
        var opp = Matchup.Compute(avg, avg, League, platoon, EngineOptions.Default, sameHand: false);
        Assert.True(same.Probabilities[Outcome.K] > League[Outcome.K]);
        Assert.True(opp.Probabilities[Outcome.K] < League[Outcome.K]);
        Assert.Equal(1.0, same.Probabilities.Values.Sum(), 9);
    }
}

public class DrawTests
{
    [Fact]
    public void Same_seed_gives_same_sequence()
    {
        var a = new SeededRandom(42);
        var b = new SeededRandom(42);
        for (var i = 0; i < 100; i++) Assert.Equal(a.NextDouble(), b.NextDouble());
    }

    [Fact]
    public void Golden_vector_never_changes_between_builds()
    {
        // If this fails, the random generator changed and every stored challenge result would replay differently.
        var r = new SeededRandom(20261016);
        Assert.Equal(0.2475, Math.Round(r.NextDouble(), 4)); // cross-checked with an independent SplitMix64 in Python
    }

    [Fact]
    public void Draws_match_probabilities_over_many_trials()
    {
        var p = Rates.From(0.20, 0.08, 0.01, 0.14, 0.045, 0.005, 0.03);
        var rng = new SeededRandom(7);
        var counts = new int[8];
        const int n = 200_000;
        for (var i = 0; i < n; i++) counts[(int)Simulator.Draw(p, rng)]++;
        foreach (var o in Enum.GetValues<Outcome>())
            Assert.InRange(counts[(int)o] / (double)n, p[o] - 0.004, p[o] + 0.004);
    }
}

public class ExplanationTests
{
    [Fact]
    public void Steps_never_contain_non_numbers_even_for_an_empty_sample()
    {
        var lg = Rates.From(0.2, 0.08, 0.01, 0.14, 0.045, 0.005, 0.03);
        var m = Matchup.Compute(new PlayerInput(SeasonCounts.Empty, lg, null), new PlayerInput(SeasonCounts.Empty, lg, null),
            lg, Platoon.None, EngineOptions.Default);
        Assert.All(m.Steps, s => { Assert.Null(s.BatterObserved); Assert.True(double.IsFinite(s.Final)); });
    }
}
