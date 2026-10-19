using PastimeRivals.Api.Challenges;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Tests;

/// <summary>Odds that make every at-bat a single (1 point) unless the batter id ends in "k" (always a strikeout).</summary>
public sealed class FixedOracle : IMatchupOracle
{
    public List<PickRef> TopPit { get; } = Enumerable.Range(0, 50).Select(i => new PickRef($"tp{i:00}", 2000)).ToList();
    public List<PickRef> TopBat { get; } = Enumerable.Range(0, 50).Select(i => new PickRef($"tb{i:00}", 2000)).ToList();

    public Rates? Odds(PickRef batter, PickRef pitcher)
    {
        var v = new double[Rates.Count];
        v[(int)(batter.Id.EndsWith('k') ? Outcome.K : Outcome.Single)] = 1;
        return Rates.Normalize(v);
    }

    public IReadOnlyList<PickRef> Top50(bool pitchers) => pitchers ? TopPit : TopBat;

    /// <summary>Plan 26: every level is the top-50 list in the last era.</summary>
    public IReadOnlyList<PickRef>[] RandomPool(bool pitchers, int level) =>
        new IReadOnlyList<PickRef>[] { new List<PickRef>(), new List<PickRef>(), new List<PickRef>(), new List<PickRef>(), Top50(pitchers) };
}

public class ChallengeRulesTests
{
    private static List<SlotPick> Side(string p, string b1, string b2, string b3, params (int Slot, string Id)[] backups)
    {
        var slots = new List<SlotPick>();
        var firsts = new[] { p, b1, b2, b3 };
        for (var k = 0; k < 4; k++)
        {
            var choices = new List<PickRef> { new(firsts[k], 1990) };
            choices.AddRange(backups.Where(b => b.Slot == k).Select(b => new PickRef(b.Id, 1990)));
            slots.Add(new SlotPick(k, choices));
        }
        return slots;
    }

    [Theory]
    [InlineData(Outcome.K, 0)] [InlineData(Outcome.Oip, 0)] [InlineData(Outcome.Bb, 1)] [InlineData(Outcome.Hbp, 1)]
    [InlineData(Outcome.Single, 1)] [InlineData(Outcome.Double, 2)] [InlineData(Outcome.Triple, 3)] [InlineData(Outcome.Hr, 4)]
    public void Points_follow_D17(Outcome o, int pts) => Assert.Equal(pts, Rules.Points(o));

    [Fact]
    public void Validate_rejects_bad_shapes()
    {
        Assert.Null(Rules.Validate(Side("p1", "a", "b", "c")));
        Assert.NotNull(Rules.Validate(Side("p1", "a", "b", "c").Take(3).ToList()));
        Assert.NotNull(Rules.Validate(Side("p1", "a", "a", "c")));
        Assert.NotNull(Rules.Validate(Side("p1", "a", "b", "c", (1, "a"))));
        Assert.NotNull(Rules.Validate(Side("p1", "a", "b", "c", (1, "x"), (1, "y"), (1, "z"))));
    }

    [Fact]
    public void Same_picks_and_seed_give_the_same_game()
    {
        var o = new FixedOracle();
        var a = Rules.Play(new[] { Side("p1", "a", "b", "c"), Side("p2", "d", "e", "f") }, 42, o);
        var b = Rules.Play(new[] { Side("p1", "a", "b", "c"), Side("p2", "d", "e", "f") }, 42, o);
        Assert.Equal(a.AtBats.Select(x => (x.Seed, x.Outcome)), b.AtBats.Select(x => (x.Seed, x.Outcome)));
    }

    [Fact]
    public void Friend_bats_first_then_creator_and_higher_total_wins()
    {
        var g = Rules.Play(new[] { Side("p1", "a", "b", "c"), Side("p2", "dk", "ek", "f") }, 7, new FixedOracle());
        Assert.Equal(6, g.AtBats.Count);
        Assert.All(g.AtBats.Take(3), x => Assert.Equal(1, x.BattingSide));
        Assert.All(g.AtBats.Skip(3), x => Assert.Equal(0, x.BattingSide));
        Assert.Equal(new[] { 3, 1 }, g.Totals);
        Assert.Equal(0, g.Winner);
        Assert.Equal("p1", g.AtBats[0].Pitcher.Id);
    }

    [Fact]
    public void Tie_goes_to_extra_rounds_with_first_batters_then_draw()
    {
        var g = Rules.Play(new[] { Side("p1", "a", "b", "c"), Side("p2", "d", "e", "f") }, 7, new FixedOracle());
        Assert.Equal(6 + 2 * Rules.MaxExtraRounds, g.AtBats.Count);
        Assert.All(g.AtBats.Where(x => x.Round > 0), x => Assert.Contains(x.Batter.Id, new[] { "a", "d" }));
        Assert.Equal(-1, g.Winner);
    }

    [Fact]
    public void Duplicate_moves_one_side_to_its_backup_and_lineups_end_distinct()
    {
        var sides = new[] { Side("p1", "a", "b", "c", (1, "x")), Side("p2", "a", "e", "f", (1, "y")) };
        var (lineups, notes) = Rules.ResolveDuplicates(sides, 99, new FixedOracle());
        var ids = lineups.SelectMany(l => l).Select(p => p.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Equal("a", lineups[0][1].Id);   // creator submitted first and keeps him
        Assert.Equal("y", lineups[1][1].Id);   // friend's backup steps in
        Assert.Single(notes);
    }

    [Fact]
    public void Same_player_in_another_role_counts_as_duplicate()
    {
        var sides = new[] { Side("ruth", "a", "b", "c"), Side("p2", "ruth", "e", "f") };
        var (lineups, _) = Rules.ResolveDuplicates(sides, 5, new FixedOracle());
        Assert.Single(lineups.SelectMany(l => l), p => p.Id == "ruth");
        Assert.Equal("ruth", lineups[0][0].Id);
    }

    [Fact]
    public void Out_of_backups_falls_back_to_top_50_for_that_position()
    {
        var o = new FixedOracle();
        var sides = new[] { Side("p1", "a", "b", "c"), Side("p1", "d", "e", "f") };
        var (lineups, _) = Rules.ResolveDuplicates(sides, 3, o);
        Assert.Equal("p1", lineups[0][0].Id);
        Assert.Contains(lineups[1][0], o.TopPit);
    }

    [Fact]
    public void A_tie_that_stays_tied_is_a_draw_after_five_extra_rounds()
    {
        // Every batter strikes out: 0-0 after 6, then 5 extra rounds of 0-0.
        var g = Rules.Play(new[] { Side("p1", "ak", "bk", "ck"), Side("p2", "dk", "ek", "fk") }, 11, new FixedOracle());
        Assert.Equal(new[] { 0, 0 }, g.Totals);
        Assert.Equal(-1, g.Winner);
        Assert.Equal(Rules.MaxExtraRounds, g.AtBats.Max(a => a.Round));
    }

    [Fact]
    public void Per_at_bat_seeds_differ_and_are_stable()
    {
        Assert.NotEqual(Rules.SeedFor(1, 0), Rules.SeedFor(1, 1));
        Assert.Equal(Rules.SeedFor(123, 4), Rules.SeedFor(123, 4));
    }
}
