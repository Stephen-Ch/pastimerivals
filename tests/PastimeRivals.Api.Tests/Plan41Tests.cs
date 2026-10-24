using Microsoft.Extensions.Configuration;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;
using Xunit;
using Xunit.Abstractions;

namespace PastimeRivals.Api.Tests;

/// <summary>
/// Plan 41 (Negro Leagues 1933-1948). Runs when PR_DATA points at the MLB-only output and PR_NGL_DATA at the same output
/// merged with the Negro Leagues (pipeline "ngl" command). The main check: every major-league answer is unchanged.
/// </summary>
public class Plan41Tests(ITestOutputHelper output)
{
    private static readonly string? Mlb = Environment.GetEnvironmentVariable("PR_DATA");
    private static readonly string? NglDir = Environment.GetEnvironmentVariable("PR_NGL_DATA");
    private static PlayService? _old, _new;
    private static PlayService Make(string dir) => new(new CsvStatsSource(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Stats:CsvDir"] = dir }).Build()));
    private static PlayService Old() => _old ??= Make(Mlb!);
    private static PlayService New() => _new ??= Make(NglDir!);
    private static bool Ready => Mlb is not null && NglDir is not null;

    private static readonly (string B, int By, string P, int Py)[] Pairs =
    {
        ("ruthb101", 1927, "martp001", 1999), ("willt103", 1941, "fellb101", 1946), ("bondb001", 2001, "gibsb101", 1968),
        ("dimaj101", 1937, "grovl101", 1931), ("aaroh101", 1957, "koufs101", 1965), ("cobbt101", 1911, "johnw102", 1913),
    };

    [Fact]
    public async Task Major_league_odds_are_identical_with_the_negro_leagues_loaded()
    {
        if (!Ready) return;
        foreach (var (b, by, p, py) in Pairs)
        {
            var a = await Old().MatchupAsync(b, by, p, py);
            var n = await New().MatchupAsync(b, by, p, py);
            Assert.NotNull(a); Assert.NotNull(n);
            Assert.Equal(a!.Value.Probabilities.Values, n!.Value.Probabilities.Values);
        }
    }

    [Fact]
    public async Task Major_league_pools_rankings_backups_and_pitcher_batting_are_identical()
    {
        if (!Ready) return;
        var o = await Old().OracleAsync();
        var n = await New().OracleAsync();
        foreach (var pit in new[] { true, false })
        {
            Assert.Equal(o.Top50(pit), n.Top50(pit));
            for (var level = 1; level <= 4; level++)
            {
                var a = o.RandomPool(pit, level);
                var b = n.RandomPool(pit, level);
                for (var e = 0; e < a.Length; e++)
                {
                    var mlbOnly = b[e].Where(x => !IsNgl(x, pit)).ToList();
                    Assert.Equal(a[e], mlbOnly);
                }
            }
        }
        foreach (var (id, y, pit) in new[] { ("ruthb101", 1927, false), ("willt103", 1941, false), ("fellb101", 1946, true), ("paigs101", 1952, true) })
            Assert.Equal(await Old().SimilarAsync(id, y, pit, 3), await New().SimilarAsync(id, y, pit, 3));
        // Pitchers batting (no DH) use the decade table, which must not include Negro Leagues seasons.
        var pa = o.PitcherAtBat(new PickRef("fellb101", 1946), new PickRef("newhh101", 1946));
        var pb = n.PitcherAtBat(new PickRef("fellb101", 1946), new PickRef("newhh101", 1946));
        Assert.Equal(pa!.Values, pb!.Values);
    }

    private static readonly HashSet<string> NglIds = new();
    private static bool IsNgl(PickRef r, bool pit)
    {
        if (NglIds.Count == 0)
            foreach (var f in new[] { "batters.csv", "pitchers.csv" })
                foreach (var l in File.ReadLines(Path.Combine(NglDir!, f)).Skip(1))
                {
                    var c = l.Split(',');
                    if (c[6] != "0" || c[7] != "0") NglIds.Add($"{c[0]}:{c[1]}");
                }
        return NglIds.Contains($"{r.Id}:{r.Year}");
    }

    [Fact]
    public async Task Negro_leagues_stars_are_in_the_game_and_rank_at_the_top()
    {
        if (!Ready) return;
        var o = await New().OracleAsync();
        var legends = o.RandomPool(false, 4)[1];   // era 1920-1945
        output.WriteLine("Level 4 NGL batters 1920-45: " + string.Join(", ", legends.Where(x => IsNgl(x, false)).Select(x => $"{x.Id} {x.Year}")));
        Assert.Contains(legends, x => x.Id == "gibsj101");
        Assert.Equal("NN2", o.LeagueOf(new PickRef("gibsj101", 1936), pitcher: false));
        // Caps: Negro Leagues seasons are at most 20% of any era pool.
        foreach (var pit in new[] { true, false })
            for (var level = 1; level <= 4; level++)
                foreach (var era in o.RandomPool(pit, level))
                    Assert.True(era.Count(x => IsNgl(x, pit)) <= 0.2 * era.Count + 1e-9, $"level {level} cap");
    }

    [Fact]
    public async Task Cards_name_the_league_hide_batter_strikeouts_and_say_the_stats_are_incomplete()
    {
        if (!Ready) return;
        var r = await New().ReportAsync("gibsj101", 1936, "bat");
        Assert.NotNull(r);
        output.WriteLine($"{r!.Line} | {string.Join("; ", r.Places)} | {r.Bio}");
        Assert.DoesNotContain(" K ", r.Line + " ");
        Assert.DoesNotContain(r.Ratios, x => x.Label == "Strikeouts");
        Assert.Contains(r.Places, p => p.Contains("Negro National League"));
        Assert.Equal(PlayService.NglNote, r.Note);
        Assert.Contains("(NNL)", r.Bio);
        var mlb = await New().ReportAsync("ruthb101", 1927, "bat");
        Assert.Null(mlb!.Note);
        Assert.Contains(mlb.Ratios, x => x.Label == "Strikeouts");
        var seasons = await New().SeasonsAsync("gibsj101", "bat");
        Assert.All(seasons!, s => Assert.Contains(s.Teams, new[] { "NNL", "NAL", "NNL/NAL" }));
    }

    [Fact]
    public async Task Gibson_and_Leonard_look_like_stars_and_a_journeyman_does_not()
    {
        if (!Ready) return;
        var o = await New().OracleAsync();
        var p = new PickRef("grovl101", 1931);
        double Hr(PickRef b) => o.Odds(b, p)![Outcome.Hr];
        double Bb(PickRef b) => o.Odds(b, p)![Outcome.Bb];
        var gib36 = Hr(new PickRef("gibsj101", 1936));
        var ruth = Hr(new PickRef("ruthb101", 1927));
        output.WriteLine($"HR per PA vs Grove 1931: Gibson 1936 {gib36:P2}, Ruth 1927 {ruth:P2}, Leonard 1941 BB {Bb(new PickRef("leonb101", 1941)):P2}");
        Assert.InRange(gib36, ruth * 0.5, ruth * 1.5);
        var snow = await New().MatchupAsync("willc106", 1933, "grovl101", 1931);
        if (snow is not null) Assert.True(snow.Value.Probabilities[Outcome.Hr] < gib36 / 2);
    }
}
