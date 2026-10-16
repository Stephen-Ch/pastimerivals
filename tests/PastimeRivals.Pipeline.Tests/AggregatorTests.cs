using PastimeRivals.Pipeline;

namespace PastimeRivals.Pipeline.Tests;

public class AggregatorTests
{
    private static readonly LeagueMap Map = LeagueMap.FromTeamAbr(new[]
    {
        "\"AAA\",\"AL\",\"A\",\"A\",\"1900\",\"2021\"",
        "\"BBB\",\"AL\",\"B\",\"B\",\"1900\",\"2021\"",
        "\"NNN\",\"NL\",\"N\",\"N\",\"1900\",\"2021\"",
        "\"NEG\",\"NN\",\"X\",\"X\",\"1920\",\"1930\"",
    });

    private static BattingLine Bat(string gid, string id, string team, int pa, int h = 0, int d = 0, int t = 0, int hr = 0,
        int bb = 0, int hbp = 0, int? k = 0, string pbp = "y") =>
        new(gid, id, team, 1950, pa, H: h, D: d, T: t, Hr: hr, Bb: bb, Ibb: 0, Hbp: hbp, K: k, Pbp: pbp);

    private static PitchingLine Pit(string gid, string id, string team, int bf, int h = 0, int hr = 0, int bb = 0, int? k = 0, string pbp = "y") =>
        new(gid, id, team, 1950, bf, H: h, D: 0, T: 0, Hr: hr, Bb: bb, Ibb: 0, Hbp: 0, K: k, IpOuts: bf - h - bb, Pbp: pbp);

    [Fact]
    public void Sums_a_batters_games_into_one_season_with_singles_and_outs_in_play()
    {
        var r = Aggregator.Build(new[]
        {
            Bat("g1", "ruthb", "AAA", 5, h: 2, d: 1, hr: 1, bb: 1, k: 1),
            Bat("g2", "ruthb", "AAA", 4, h: 1, bb: 0, k: 2),
        }, Array.Empty<PitchingLine>(), Map);

        var s = Assert.Single(r.Batters);
        Assert.Equal(9, s.Counts.Pa);
        Assert.Equal(1, s.Counts.Single); // 3 hits - 1 double - 1 HR
        Assert.Equal(1, s.Counts.Double);
        Assert.Equal(1, s.Counts.Hr);
        Assert.Equal(3, s.Counts.K);
        Assert.Equal(1, s.Counts.Bb);
        Assert.Equal(9 - 3 - 1 - 3, s.Counts.Oip); // PA - K - BB - H
        Assert.Equal(2, s.Games);
    }

    [Fact]
    public void League_batting_norms_exclude_pitchers_batting_but_pitcher_season_keeps_his_bats()
    {
        var r = Aggregator.Build(new[]
        {
            Bat("g1", "hitter", "AAA", 4, h: 2),
            Bat("g1", "pitchr", "AAA", 3, h: 0, k: 3),
        }, new[] { Pit("g1", "pitchr", "AAA", 30, h: 5, k: 6) }, Map);

        var lg = Assert.Single(r.Leagues);
        Assert.Equal(4, lg.Batting.Pa);          // pitcher's 3 PA left out of hitter norms
        Assert.Equal(30, lg.Pitching.Pa);        // pitching norms use every batter faced
        Assert.Equal(3, r.Batters.Single(b => b.Id == "pitchr").Counts.Pa);
    }

    [Fact]
    public void Traded_player_is_one_season_with_plate_appearances_split_by_league()
    {
        var r = Aggregator.Build(new[]
        {
            Bat("g1", "mover", "AAA", 10, h: 3),
            Bat("g2", "mover", "NNN", 30, h: 9),
        }, Array.Empty<PitchingLine>(), Map);

        var s = Assert.Single(r.Batters);
        Assert.Equal(40, s.Counts.Pa);
        Assert.Equal(10, s.PaByLeague["AL"]);
        Assert.Equal(30, s.PaByLeague["NL"]);
        Assert.Equal("AAA/NNN", s.Teams);
    }

    [Fact]
    public void Games_outside_AL_NL_FL_are_ignored()
    {
        var r = Aggregator.Build(new[] { Bat("g1", "x", "NEG", 4, h: 1) }, Array.Empty<PitchingLine>(), Map);
        Assert.Empty(r.Batters);
        Assert.Empty(r.Leagues);
    }

    [Fact]
    public void Unknown_strikeouts_are_tracked_so_K_rate_uses_only_known_games()
    {
        var r = Aggregator.Build(new[]
        {
            Bat("g1", "old", "AAA", 4, k: null),
            Bat("g2", "old", "AAA", 4, k: 2),
        }, Array.Empty<PitchingLine>(), Map);

        var s = Assert.Single(r.Batters);
        Assert.Equal(8, s.Counts.Pa);
        Assert.Equal(4, s.Counts.KKnownPa);
        Assert.Equal(2, s.Counts.K);
    }

    [Fact]
    public void Quality_grade_A_when_play_by_play_covers_most_games_C_when_strikeouts_missing()
    {
        var full = Aggregator.Build(new[] { Bat("g1", "a", "AAA", 4), Bat("g2", "a", "AAA", 4) }, Array.Empty<PitchingLine>(), Map);
        Assert.Equal('A', full.Batters.Single().Grade);

        var boxOnly = Aggregator.Build(new[] { Bat("g1", "a", "AAA", 4, pbp: ""), Bat("g2", "a", "AAA", 4, pbp: "") }, Array.Empty<PitchingLine>(), Map);
        Assert.Equal('B', boxOnly.Batters.Single().Grade);

        var noK = Aggregator.Build(new[] { Bat("g1", "a", "AAA", 4, k: null), Bat("g2", "a", "AAA", 4) }, Array.Empty<PitchingLine>(), Map);
        Assert.Equal('C', noK.Batters.Single().Grade);
    }

    [Fact]
    public void Sums_pitcher_lines_into_a_season()
    {
        var r = Aggregator.Build(Array.Empty<BattingLine>(), new[]
        {
            Pit("g1", "pedro", "BBB", 30, h: 4, hr: 1, bb: 2, k: 12),
            Pit("g2", "pedro", "BBB", 28, h: 5, hr: 0, bb: 1, k: 10),
        }, Map);

        var p = Assert.Single(r.Pitchers);
        Assert.Equal(58, p.Counts.Pa);
        Assert.Equal(22, p.Counts.K);
        Assert.Equal(1, p.Counts.Hr);
        Assert.Equal(8, p.Counts.Single);
        Assert.Equal(58 - 22 - 3 - 9, p.Counts.Oip);
    }

    [Fact]
    public void Pitcher_grade_uses_play_by_play_coverage()
    {
        var r = Aggregator.Build(Array.Empty<BattingLine>(), new[] { Pit("g1", "p", "BBB", 30), Pit("g2", "p", "BBB", 30) }, Map);
        Assert.Equal('A', r.Pitchers.Single().Grade);
    }

    [Fact]
    public void Missing_batters_faced_is_estimated_from_outs_hits_walks_and_hit_batters_and_graded_C()
    {
        var line = new PitchingLine("g1", "old", "BBB", 1902, Bfp: null, H: 8, D: 1, T: 0, Hr: 0, Bb: 3, Ibb: 0, Hbp: 1, K: 4, IpOuts: 27, Pbp: "");
        var r = Aggregator.Build(Array.Empty<BattingLine>(), new[] { line }, Map);
        var p = r.Pitchers.Single();
        Assert.Equal(27 + 8 + 3 + 1, p.Counts.Pa);
        Assert.Equal(1, p.EstimatedGames);
        Assert.Equal('C', p.Grade);
        Assert.Equal(39, r.Leagues.Single().Pitching.Pa);
    }
}
