using Microsoft.Extensions.Configuration;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 26: full-random draws, computer levels and the one-line bio.</summary>
public class Plan26Tests
{
    // ---- DrawRandom (pure) ----
    private static IReadOnlyList<PickRef>[] Eras(params int[] sizes) =>
        sizes.Select((n, e) => (IReadOnlyList<PickRef>)Enumerable.Range(0, n).Select(i => new PickRef($"e{e}p{i}", 1900 + e * 25)).ToList()).ToArray();

    [Fact]
    public void Draw_gives_each_non_empty_era_an_equal_chance()
    {
        var eras = Eras(10, 0, 1000, 10, 10);
        var rng = new Random(7);
        var counts = new int[5];
        for (var i = 0; i < 4000; i++) counts[Rules.DrawRandom(eras, new HashSet<string>(), rng.Next)!.Year switch { 1900 => 0, 1925 => 1, 1950 => 2, 1975 => 3, _ => 4 }]++;
        Assert.Equal(0, counts[1]);
        Assert.All(new[] { 0, 2, 3, 4 }, e => Assert.InRange(counts[e], 850, 1150));   // about 1,000 each, though era 2 is 100 times larger
    }

    [Fact]
    public void Draw_never_returns_a_taken_player_and_falls_back_when_eras_are_used_up()
    {
        var eras = Eras(3, 1);
        var taken = new HashSet<string> { "e0p0", "e0p1", "e0p2" };
        for (var i = 0; i < 50; i++) Assert.Equal("e1p0", Rules.DrawRandom(eras, taken, new Random(i).Next)!.Id);
        taken.Add("e1p0");
        Assert.Null(Rules.DrawRandom(eras, taken, new Random(1).Next));
        Assert.Null(Rules.DrawRandom(Eras(0, 0), new HashSet<string>(), new Random(1).Next));
    }

    [Fact]
    public void Draw_at_level_steps_down_when_the_level_has_nothing_free()
    {
        var o = new LevelOracle();
        var p = Rules.DrawAtLevel(o, false, 9, new HashSet<string> { "L4" }, new Random(1).Next);
        Assert.Equal("L3", p!.Id);   // 9 clamps to 4; L4 is taken, so level 3
    }

    private sealed class LevelOracle : IMatchupOracle
    {
        public Rates? Odds(PickRef b, PickRef p) => null;
        public IReadOnlyList<PickRef> Top50(bool pitchers) => Array.Empty<PickRef>();
        public IReadOnlyList<PickRef>[] RandomPool(bool pitchers, int level) => new IReadOnlyList<PickRef>[] { new List<PickRef> { new($"L{level}", 2000) } };
    }

    // ---- Levels and bio on synthetic data ----
    private sealed class LevelStats : IStatsSource
    {
        private static SeasonCounts C(int pa, int hr, int single, int k = 50) => new(pa, pa, k, 40, 5, single, 20, 3, hr);

        public Task<StatsBundle> LoadAsync()
        {
            var leagues = new List<LeagueRow>();
            foreach (var y in new[] { 1910, 1930, 1950, 1980, 2000 })
            {
                leagues.Add(new LeagueRow(y, "AL", "bat", C(40000, 600, 7000)));
                leagues.Add(new LeagueRow(y, "AL", "pit", C(44000, 650, 7400)));
            }
            var bats = new List<PlayerRow>();
            var pits = new List<PlayerRow>();
            foreach (var y in new[] { 1910, 1930, 1950, 1980, 2000 })
                for (var i = 0; i < 40; i++)
                {
                    // b..i: higher i = more home runs = stronger. p..i: higher i = more allowed = weaker.
                    bats.Add(new PlayerRow($"b{y}x{i:00}", y, 500, 0, 0, C(500, i, 90), 'A', "NYA", "RF"));
                    pits.Add(new PlayerRow($"p{y}x{i:00}", y, i % 2 == 0 ? 700 : 450, 0, 0, C(i % 2 == 0 ? 700 : 450, i, 100 + i * 3), 'A', "BOS", "P"));
                }
            bats.Add(new PlayerRow("short01", 2000, 299, 0, 0, C(299, 60, 90), 'A', "NYA", "RF"));   // under the floor: never drawn
            // A career for the bio: Boston 1914-1919, New York 1920-1934, Boston NL 1935.
            foreach (var y in Enumerable.Range(1914, 22))
                bats.Add(new PlayerRow("ruthb101", y, 500, y == 1935 ? 0 : 500, 0, C(500, y == 1927 ? 60 : y == 1921 ? 60 : 30, 100), 'A', y < 1920 ? "BOS" : y < 1935 ? "NYA" : "BSN", "RF"));
            var cat = new StatsCatalog(leagues, Array.Empty<PlatoonRow>(), bats, pits, Array.Empty<ExposureRow>());
            var people = bats.Concat(pits).Select(b => b.Id).Distinct()
                .Select(id => new PersonRow(id, "F", id, "R", "R", 1890, id.EndsWith("x39") || id.EndsWith("x38") || id.EndsWith("x00") || id == "ruthb101" ? "HOF" : "")).ToList();
            var teams = new List<TeamRow> { new("BOS", "AL", "Boston", 1901, 2021), new("NYA", "AL", "New York", 1903, 2021), new("BSN", "NL", "Boston", 1876, 1952) };
            return Task.FromResult(new StatsBundle(cat, people, teams));
        }
    }

    private static async Task<IMatchupOracle> Oracle() => await new PlayService(new LevelStats()).OracleAsync();

    [Fact]
    public async Task Level_1_is_every_real_workload_season()
    {
        var o = await Oracle();
        var bats = o.RandomPool(false, 1);
        Assert.Equal(5, bats.Length);
        Assert.DoesNotContain(bats.SelectMany(x => x), p => p.Id == "short01");
        Assert.Equal(200 + 22, bats.Sum(x => x.Count));
    }

    [Fact]
    public async Task Level_2_takes_the_better_half_with_pitchers_lower_is_better()
    {
        var o = await Oracle();
        var era4 = o.RandomPool(false, 2)[4];
        Assert.Contains(era4, p => p.Id == "b2000x39");
        Assert.DoesNotContain(era4, p => p.Id == "b2000x00");
        var pit = o.RandomPool(true, 2)[4];
        Assert.Contains(pit, p => p.Id == "p2000x00");
        Assert.DoesNotContain(pit, p => p.Id == "p2000x39");
    }

    [Fact]
    public async Task Level_3_is_hall_of_famers_in_the_better_half_only()
    {
        var o = await Oracle();
        var era4 = o.RandomPool(false, 3)[4];
        Assert.Contains(era4, p => p.Id == "b2000x39");
        Assert.DoesNotContain(era4, p => p.Id == "b2000x00");   // a Hall of Famer, but a weak season
        Assert.DoesNotContain(era4, p => p.Id == "b2000x37");   // strong, not a Hall of Famer
    }

    [Fact]
    public async Task Level_4_is_the_best_five_percent_and_pitchers_need_600_batters_faced()
    {
        var o = await Oracle();
        Assert.Equal(new[] { "b2000x38", "b2000x39" }, o.RandomPool(false, 4)[4].Select(p => p.Id).OrderBy(x => x));
        var pit = o.RandomPool(true, 4)[4];
        Assert.NotEmpty(pit);
        Assert.All(pit, p => Assert.Equal(0, int.Parse(p.Id[^2..]) % 2));   // even ids are the 700-batter seasons
    }

    [Fact]
    public async Task Bio_shows_years_places_in_order_hall_of_fame_and_best_season_earliest_on_ties()
    {
        var play = new PlayService(new LevelStats());
        Assert.Equal("1914-1935 · Boston AL, New York AL +1 · Hall of Fame · Best: 60 HR (1921)", await play.BioAsync("ruthb101", "bat"));
        Assert.Equal("2000 · New York AL · Best: 114 H (2000)", await play.BioAsync("b2000x01", "bat"));
        Assert.Equal("2000 · Boston AL · Best: 50 K (2000)", await play.BioAsync("p2000x01", "pit"));
        Assert.Equal("", await play.BioAsync("nobody", "bat"));
    }

    // ---- Real data (only where data/out exists: Stephen's PC) ----
    private static readonly Lazy<PlayService?> Real = new(() =>
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null && !File.Exists(Path.Combine(dir, "data", "out", "batters.csv"))) dir = Path.GetDirectoryName(dir);
        if (dir == null) return null;
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Stats:CsvDir"] = Path.Combine(dir, "data", "out") }).Build();
        return new PlayService(new CsvStatsSource(cfg));
    });

    [Fact]
    public async Task Real_data_bios_and_levels()
    {
        if (Real.Value is not { } play) return;
        Assert.Equal("1914-1935 · Boston AL, New York AL +1 · Hall of Fame · Best: 60 HR (1927)", await play.BioAsync("ruthb101", "bat"));
        Assert.EndsWith("+12", (await play.BioAsync("jacke001", "bat")).Split(" · ")[1]);
        var o = await play.OracleAsync();
        for (var level = 1; level <= 4; level++)
            foreach (var pit in new[] { true, false })
                Assert.All(o.RandomPool(pit, level), era => Assert.NotEmpty(era));
        Assert.True(o.RandomPool(true, 3).All(e => e.Select(p => p.Id).Distinct().Count() >= 4));
    }
}
