using PastimeRivals.Pipeline;
using Xunit;

namespace PastimeRivals.Pipeline.Tests;

/// <summary>Plan 41. The data tests run when PR_NGL_RAW points at the unzipped Retrosheet Negro Leagues files and PR_DATA at the MLB output.</summary>
public class NglTests
{
    private static readonly string? Raw = Environment.GetEnvironmentVariable("PR_NGL_RAW");
    private static readonly string? Mlb = Environment.GetEnvironmentVariable("PR_DATA");
    private static string Repo([System.Runtime.CompilerServices.CallerFilePath] string f = "") => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(f)!, "..", ".."));
    private static List<Ngl.Member> Members() => Ngl.LoadMembership(Path.Combine(Repo(), "data", "ngl", "membership.csv"));

    [Fact]
    public void Membership_matches_the_retrosheet_season_pages()
    {
        var m = Members();
        Assert.Equal(new[] { "ATN", "BIR", "CAG", "IN7", "JAX", "KCM", "MEM" }, m.Where(x => x.Season == 1938 && x.League == "NAL").Select(x => x.Team).OrderBy(x => x));
        Assert.Equal(new[] { "BFA", "BLG", "HOM", "NW2", "NY5", "PH5", "PTC", "WBS" }, m.Where(x => x.Season == 1938 && x.League == "NN2").Select(x => x.Team).OrderBy(x => x));
        for (var y = 1933; y <= 1948; y++)
        {
            Assert.True(m.Count(x => x.Season == y && x.League == "NN2") >= 4, $"{y} NN2");
            if (y >= 1937) Assert.True(m.Count(x => x.Season == y && x.League == "NAL") >= 4, $"{y} NAL");
            else Assert.DoesNotContain(m, x => x.Season == y && x.League == "NAL");
        }
        Assert.DoesNotContain(m, x => x.Season is < 1933 or > 1948);
    }

    [Fact]
    public void Missing_doubles_and_triples_are_split_from_the_hits_and_never_exceed_them()
    {
        Assert.Equal((2.0, 1.0), Ngl.Split(2, 1, 5, (0.5, 0.5)));
        var (d, t) = Ngl.Split(null, null, 10, (0.2, 0.04));
        Assert.Equal(2.0, d, 6); Assert.Equal(0.4, t, 6);                 // expected values; rounded only on season totals
        (d, t) = Ngl.Split(null, null, 1, (0.6, 0.6));
        Assert.Equal(0.6, d, 6); Assert.Equal(0.4, t, 6);                 // never more than the hits
        Assert.Equal((0.0, 0.0), Ngl.Split(null, null, 0, (0.3, 0.1)));
    }

    private static Ngl.Result? _built;
    private static Ngl.Result Built()
    {
        if (_built is not null) return _built;
        var bat = new HashSet<(string, int)>(Ngl.Rows(Path.Combine(Mlb!, "batters.csv")).Select(r => (r["id"], int.Parse(r["year"]))));
        var pit = new HashSet<(string, int)>(Ngl.Rows(Path.Combine(Mlb!, "pitchers.csv")).Select(r => (r["id"], int.Parse(r["year"]))));
        return _built = Ngl.Build(Raw!, Members(), bat, pit, Ngl.Positions(Path.Combine(Raw!, "allplayers.csv")));
    }

    [Fact]
    public void Real_data_builds_with_known_lines_and_no_red_checks()
    {
        if (Raw is null || Mlb is null) return;
        var r = Built();
        Assert.Empty(r.Red);
        var gibson = r.Batters.Single(b => b.Id == "gibsj101" && b.Year == 1936);
        Assert.Equal(202, gibson.Counts.Pa);
        Assert.Equal(20, gibson.Counts.Hr);
        Assert.Equal("C", gibson.Position);
        Assert.All(r.Batters, b => Assert.Equal(0, b.Counts.KKnownPa));
        Assert.All(r.Batters.Concat(r.Pitchers), x => { Assert.True(x.Counts.Oip >= 0, $"{x.Id} {x.Year}"); Assert.True(x.Counts.Single >= 0); });          // batter strikeouts are never trusted
        Assert.All(r.Leagues, l => { Assert.True(l.Batting.KKnownPa > 0); Assert.True(l.Pitching.KKnownPa > 0); });
        Assert.Contains(("dobyl101", 1947), r.Overlap);
        Assert.DoesNotContain(r.Batters, b => b.Id == "dobyl101" && b.Year == 1947);
        Assert.DoesNotContain(r.Batters, b => b.Year is < 1933 or > 1948);
        Assert.Equal(16 + 12, r.Leagues.Count);                                 // NN2 1933-48, NAL 1937-48
        Assert.All(r.Leagues, l => Assert.True(l.Pitching.Triple > 0, $"{l.Year} {l.League} pitchers allow triples"));
    }

    [Fact]
    public void Merge_keeps_every_major_league_row_and_adds_two_zero_columns()
    {
        if (Raw is null || Mlb is null) return;
        var outDir = Path.Combine(Path.GetTempPath(), "ngl-merge-test");
        Ngl.Merge(Mlb, outDir, Built(), Members(), Path.Combine(Raw, "biofiles", "teams.csv"), Path.Combine(Raw, "biofiles", "biofile0.csv"));
        foreach (var f in new[] { "batters.csv", "pitchers.csv" })
        {
            var old = File.ReadAllLines(Path.Combine(Mlb, f));
            var merged = File.ReadAllLines(Path.Combine(outDir, f));
            for (var i = 0; i < old.Length; i++)
            {
                var c = merged[i].Split(',').ToList();
                Assert.Equal(i == 0 ? "pa_nn2" : "0", c[6]); Assert.Equal(i == 0 ? "pa_nal" : "0", c[7]);
                c.RemoveRange(6, 2);
                Assert.Equal(old[i], string.Join(",", c));
            }
            Assert.True(merged.Length > old.Length);
        }
        foreach (var f in new[] { "leagues.csv", "teams.csv", "people.csv" })
        {
            var old = File.ReadAllLines(Path.Combine(Mlb, f)).Where(l => l.Length > 0).ToArray();
            Assert.Equal(old, File.ReadAllLines(Path.Combine(outDir, f)).Take(old.Length));
        }
        Assert.Contains(File.ReadAllLines(Path.Combine(outDir, "teams.csv")), l => l.StartsWith("CAG,NAL,Chicago,1937,"));
        Assert.Contains(File.ReadAllLines(Path.Combine(outDir, "people.csv")), l => l.StartsWith("gibsj101,Josh,Gibson,"));
    }
}
