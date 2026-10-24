using System.Text;

namespace PastimeRivals.Pipeline;

/// <summary>
/// Plan 41: Negro Leagues (1933-1948) from Retrosheet's Negro Leagues CSVs, merged into an existing MLB output folder.
/// MLB rows are copied unchanged (two zero columns pa_nn2, pa_nal are added); NGL rows, leagues, teams and people are appended.
/// Group code in code and data: NGL (never "NL", which is the National League). Leagues: NN2 (second Negro National League), NAL.
/// </summary>
public static class Ngl
{
    public const int FirstYear = 1933, LastYear = 1948, MinTeamPa = 300;
    public static readonly string[] Leagues = { "NN2", "NAL" };

    public sealed record Member(int Season, string Team, string League, int Games, string Name);

    public static List<Member> LoadMembership(string path) => Rows(path)
        .Select(r => new Member(int.Parse(r["season"]), r["team"], r["league"], int.Parse(r["games"]), r["name"])).ToList();

    /// <summary>One cleaned batting or pitching line. D/T may be fractional (expected values when the source left them
    /// blank, or for every pitching line); they are rounded only on season totals so rare triples are not rounded away. K null = unknown.</summary>
    public sealed record Line(string Gid, string Id, string Team, int Year, string League, int Pa, int H, double D, double T, int Hr,
        int Bb, int Ibb, int Hbp, int? K, int IpOuts, bool Estimated, bool HbpMissing);

    public sealed class Result
    {
        public List<PlayerSeason> Batters { get; } = new();
        public List<PlayerSeason> Pitchers { get; } = new();
        public List<LeagueSeason> Leagues { get; } = new();
        public List<string> Log { get; } = new();
        public List<string> Red { get; } = new();
        public List<(string Id, int Year)> Overlap { get; } = new();
    }

    /// <summary>Builds NGL player and league seasons. mlbIds: (id, year) pairs that already have an MLB row (batters and pitchers).</summary>
    public static Result Build(string nglDir, List<Member> members, ISet<(string, int)> mlbBat, ISet<(string, int)> mlbPit,
        IReadOnlyDictionary<string, string>? positions = null)
    {
        var res = new Result();
        var member = members.ToDictionary(m => (m.Season, m.Team), m => m);
        // Games: regular season, 1933-1948, both teams members (of either league) that season.
        var games = new Dictionary<string, (int Year, string Vis, string Home)>();
        foreach (var r in Rows(Path.Combine(nglDir, "gameinfo.csv")))
        {
            if (r["gametype"] != "regular" || !int.TryParse(r["season"], out var y) || y < FirstYear || y > LastYear) continue;
            if (!member.ContainsKey((y, r["visteam"])) || !member.ContainsKey((y, r["hometeam"]))) continue;
            games[r["gid"]] = (y, r["visteam"], r["hometeam"]);
        }
        string LeagueOf(int y, string team) => member[(y, team)].League;

        // ---- Batting: keep lines with PA, H, HR, BB; blank 2B/3B split by the team-season mix of complete lines; blank HBP = 0.
        var rawBat = new List<Dictionary<string, string>>();
        foreach (var r in Rows(Path.Combine(nglDir, "batting.csv")))
        {
            if (r["stattype"] != "value" || !games.TryGetValue(r["gid"], out var g)) continue;
            if (!member.ContainsKey((g.Year, r["team"]))) continue;
            if (N(r["b_pa"]) is null || N(r["b_h"]) is null || N(r["b_hr"]) is null || N(r["b_w"]) is null) continue;
            rawBat.Add(r);
        }
        var mix = new Dictionary<(int, string), (double D, double T)>();      // team-season share of non-HR hits that are 2B / 3B
        var lgMix = new Dictionary<(int, string), (double D, double T)>();    // league-season, for pitching lines
        foreach (var grp in rawBat.Where(Complete).GroupBy(r => (games[r["gid"]].Year, r["team"])))
        {
            var (d, t, h) = Sum(grp);
            mix[grp.Key] = h > 0 ? (d / (double)h, t / (double)h) : (0, 0);
        }
        foreach (var grp in rawBat.Where(Complete).GroupBy(r => (games[r["gid"]].Year, LeagueOf(games[r["gid"]].Year, r["team"]))))
        {
            var (d, t, h) = Sum(grp);
            lgMix[grp.Key] = h > 0 ? (d / (double)h, t / (double)h) : (0, 0);
        }
        var batting = new List<Line>();
        foreach (var r in rawBat)
        {
            var y = games[r["gid"]].Year; var lg = LeagueOf(y, r["team"]);
            int h = N(r["b_h"])!.Value, hr = N(r["b_hr"])!.Value;
            var (d, t) = Split(N(r["b_d"]), N(r["b_t"]), h - hr, mix.GetValueOrDefault((y, r["team"]), lgMix.GetValueOrDefault((y, lg))));
            batting.Add(new Line(r["gid"], r["id"], r["team"], y, lg, N(r["b_pa"])!.Value, h, d, t, hr, N(r["b_w"])!.Value,
                N(r["b_iw"]) ?? 0, N(r["b_hbp"]) ?? 0, null, 0, false, false));   // batter K always unknown (box scores undercount it)
        }

        // ---- Pitching: keep lines with H, HR, BB; non-HR hits split by the league mix; HBP blank filled at season level later.
        var rawPit = new List<Dictionary<string, string>>();
        foreach (var r in Rows(Path.Combine(nglDir, "pitching.csv")))
        {
            if (r["stattype"] != "value" || !games.TryGetValue(r["gid"], out var g)) continue;
            if (!member.ContainsKey((g.Year, r["team"]))) continue;
            if (N(r["p_h"]) is null || N(r["p_hr"]) is null || N(r["p_w"]) is null) continue;
            rawPit.Add(r);
        }
        // K is known only when present and the team's pitchers recorded at least one K in that game.
        var teamGameK = rawPit.Where(r => N(r["p_k"]) is not null).GroupBy(r => (r["gid"], r["team"])).ToDictionary(g => g.Key, g => g.Sum(r => N(r["p_k"])!.Value));
        var pitching = new List<Line>();
        foreach (var r in rawPit)
        {
            var y = games[r["gid"]].Year; var lg = LeagueOf(y, r["team"]);
            int h = N(r["p_h"])!.Value, hr = N(r["p_hr"])!.Value, bb = N(r["p_w"])!.Value, outs = N(r["p_ipouts"]) ?? 0;
            var hbp = N(r["p_hbp"]);
            var (d, t) = Split(null, null, h - hr, lgMix.GetValueOrDefault((y, lg)));
            int? k = N(r["p_k"]) is { } kv && teamGameK.GetValueOrDefault((r["gid"], r["team"])) > 0 ? kv : null;
            var bfp = N(r["p_bfp"]);
            var bf = bfp ?? outs + h + bb + (hbp ?? 0);
            pitching.Add(new Line(r["gid"], r["id"], r["team"], y, lg, bf, h, d, t, hr, bb, N(r["p_iw"]) ?? 0, hbp ?? 0, k, outs, bfp is null, hbp is null));
        }

        // ---- League environments (team-weighted, games from the season pages).
        var pitchedInGame = new HashSet<(string, string)>(pitching.Select(p => (p.Gid, p.Id)));
        var hbpRate = new Dictionary<(int, string), double>();
        foreach (var y in Enumerable.Range(FirstYear, LastYear - FirstYear + 1))
            foreach (var lg in Leagues)
            {
                var teams = members.Where(m => m.Season == y && m.League == lg).ToList();
                if (teams.Count == 0) continue;
                var bat = Weighted(teams, t => Counts(batting.Where(b => b.Year == y && b.Team == t && !pitchedInGame.Contains((b.Gid, b.Id)))));
                var pitAll = pitching.Where(p => p.Year == y && p.League == lg).ToList();
                var pit = Weighted(teams, t => Counts(pitching.Where(p => p.Year == y && p.Team == t && !p.HbpMissing)));
                var kTeams = Weighted(teams, t => Counts(pitching.Where(p => p.Year == y && p.Team == t && p.K is not null)), kOnly: true);
                if (bat is null || pit is null || kTeams is null) { res.Red.Add($"{y} {lg}: not enough data for a league row"); continue; }
                var kRate = kTeams.Value.K;
                var kKnownBf = pitAll.Where(p => p.K is not null).Sum(p => p.Pa);
                var bfAll = pitAll.Sum(p => p.Pa);
                var share = bfAll > 0 ? kKnownBf / (double)bfAll : 0;
                if (share < 0.30) res.Red.Add($"{y} {lg}: only {share:P0} of batters faced have strikeouts known");
                var batPa = batting.Where(b => b.Year == y && b.League == lg && !pitchedInGame.Contains((b.Gid, b.Id))).Sum(b => b.Pa);
                var ls = new LeagueSeason { Year = y, League = lg };
                Fill(ls.Batting, bat.Value, kRate, batPa);
                Fill(ls.Pitching, pit.Value, kRate, bfAll);
                hbpRate[(y, lg)] = pit.Value.Hbp;
                res.Leagues.Add(ls);
                res.Log.Add($"{y} {lg}: {teams.Count} teams, bat PA {batPa}, BF {bfAll}, K known {share:P0}, K {kRate:P1}, HR/PA {bat.Value.Hr:P2}");
            }

        // ---- Player seasons (seasons that also have an MLB row are left out; their lines still count in the league rows).
        var xbBat = new Dictionary<(string, int), (double D, double T)>();
        var xbPit = new Dictionary<(string, int), (double D, double T)>();
        static void Acc(Dictionary<(string, int), (double D, double T)> acc, (string, int) key, double d, double t)
        { var x = acc.GetValueOrDefault(key); acc[key] = (x.D + d, x.T + t); }
        var bats = new Dictionary<(string, int), PlayerSeason>();
        foreach (var b in batting)
        {
            if (mlbBat.Contains((b.Id, b.Year)) || mlbPit.Contains((b.Id, b.Year))) { AddOverlap(res, b.Id, b.Year); continue; }
            var s = Get(bats, b.Id, b.Year);
            s.Counts.Add(b.Pa, null, b.Bb, b.Ibb, b.Hbp, b.H, 0, 0, b.Hr);
            Acc(xbBat, (b.Id, b.Year), b.D, b.T);
            s.PaByLeague[b.League] = s.PaByLeague.GetValueOrDefault(b.League) + b.Pa;
            s.TeamSet.Add(b.Team); s.Games++;
        }
        var pits = new Dictionary<(string, int), PlayerSeason>();
        var missingHbpBf = new Dictionary<(string, int), (double Bf, string League)>();
        foreach (var p in pitching)
        {
            if (mlbBat.Contains((p.Id, p.Year)) || mlbPit.Contains((p.Id, p.Year))) { AddOverlap(res, p.Id, p.Year); continue; }
            var s = Get(pits, p.Id, p.Year);
            s.Counts.Add(p.Pa, p.K, p.Bb, p.Ibb, p.Hbp, p.H, 0, 0, p.Hr);
            Acc(xbPit, (p.Id, p.Year), p.D, p.T);
            s.PaByLeague[p.League] = s.PaByLeague.GetValueOrDefault(p.League) + p.Pa;
            s.TeamSet.Add(p.Team); s.Games++; s.IpOuts += p.IpOuts;
            if (p.Estimated) s.EstimatedGames++;
            if (p.HbpMissing) { var m = missingHbpBf.GetValueOrDefault((p.Id, p.Year)); missingHbpBf[(p.Id, p.Year)] = (m.Bf + p.Pa, p.League); }
        }
        foreach (var ((id, y), (bf, lg)) in missingHbpBf)
        {
            var add = (int)Math.Round(bf * hbpRate.GetValueOrDefault((y, lg)));
            if (add > 0) pits[(id, y)].Counts.Add(0, null, 0, 0, add, 0, 0, 0, 0);
        }
        // Season totals of doubles and triples, rounded once (never more than the non-HR hits).
        static void SetXb(PlayerSeason s, (double D, double T) x)
        {
            var nonHr = s.Counts.H - s.Counts.Hr;
            var d = Math.Min(nonHr, (int)Math.Round(x.D));
            var t = Math.Min(nonHr - d, (int)Math.Round(x.T));
            s.Counts.Double = d; s.Counts.Triple = Math.Max(0, t);
        }
        foreach (var (k, x) in xbBat) if (bats.TryGetValue(k, out var bs)) SetXb(bs, x);
        foreach (var (k, x) in xbPit) if (pits.TryGetValue(k, out var ps)) SetXb(ps, x);
        // Batters faced estimated from partial box scores can fall short of the recorded outcomes; never fewer than them.
        foreach (var ps2 in bats.Values.Concat(pits.Values))
        {
            var c = ps2.Counts;
            var min = c.Bb + c.Hbp + c.H + c.K;
            if (c.Pa < min) { var allKnown = c.KKnownPa == c.Pa; c.Pa = min; if (allKnown) c.KKnownPa = min; }
        }
        foreach (var s in bats.Values) s.Position = positions?.GetValueOrDefault($"{s.Id}:{s.Year}") ?? "PH";
        foreach (var s in pits.Values) s.Position = "P";
        res.Batters.AddRange(bats.Values.OrderBy(s => s.Year).ThenBy(s => s.Id, StringComparer.Ordinal));
        res.Pitchers.AddRange(pits.Values.OrderBy(s => s.Year).ThenBy(s => s.Id, StringComparer.Ordinal));
        foreach (var x in res.Batters.Concat(res.Pitchers))
            if (x.Counts.Oip < 0 || x.Counts.Single < 0 || x.Counts.KKnownPa > x.Counts.Pa) res.Red.Add($"{x.Id} {x.Year}: negative or impossible counts");
        foreach (var l in res.Leagues)
        {
            if (l.Batting.KKnownPa == 0 || l.Pitching.KKnownPa == 0) res.Red.Add($"{l.Year} {l.League}: league row without known strikeouts");
            double Tr(Counts c) => c.Pa > 0 ? c.Triple / (double)c.Pa : 0;
            if (Tr(l.Batting) > 0 && Math.Abs(Tr(l.Pitching) / Tr(l.Batting) - 1) > 0.30) res.Red.Add($"{l.Year} {l.League}: pitching triple rate {Tr(l.Pitching):P2} vs batting {Tr(l.Batting):P2}");
            var kr = l.Pitching.K / (double)l.Pitching.KKnownPa;
            if (kr is < 0.06 or > 0.16) res.Red.Add($"{l.Year} {l.League}: league strikeout rate {kr:P1} out of range");
        }
        return res;

        static bool Complete(Dictionary<string, string> r) => N(r["b_d"]) is not null && N(r["b_t"]) is not null;
        static (int D, int T, int H) Sum(IEnumerable<Dictionary<string, string>> rows)
        {
            int d = 0, t = 0, h = 0;
            foreach (var r in rows) { d += N(r["b_d"])!.Value; t += N(r["b_t"])!.Value; h += N(r["b_h"])!.Value - N(r["b_hr"])!.Value; }
            return (d, t, h);
        }
    }

    /// <summary>Doubles and triples for a line: as recorded, else the non-HR hits split by the given mix (expected values, not
    /// rounded; never more than the hits).</summary>
    public static (double D, double T) Split(int? d, int? t, int nonHrHits, (double D, double T) mix)
    {
        if (d is not null && t is not null) return (d.Value, t.Value);
        double dd = d ?? nonHrHits * mix.D;
        double tt = t ?? nonHrHits * mix.T;
        if (dd > nonHrHits) dd = nonHrHits;
        if (dd + tt > nonHrHits) tt = Math.Max(0, nonHrHits - dd);
        return (dd, tt);
    }

    /// <summary>Per-PA rates of a set of lines (K over K-known PA).</summary>
    public readonly record struct RatesPa(double Pa, double K, double Bb, double Ibb, double Hbp, double H, double D, double T, double Hr);

    private static RatesPa? Counts(IEnumerable<Line> lines)
    {
        int pa = 0, kpa = 0, k = 0, bb = 0, ibb = 0, hbp = 0, h = 0, hr = 0; double d = 0, t = 0;
        foreach (var l in lines)
        {
            pa += l.Pa; bb += l.Bb; ibb += l.Ibb; hbp += l.Hbp; h += l.H; d += l.D; t += l.T; hr += l.Hr;
            if (l.K is { } kv) { k += kv; kpa += l.Pa; }
        }
        if (pa == 0) return null;
        return new RatesPa(pa, kpa > 0 ? k / (double)kpa : double.NaN, bb / (double)pa, ibb / (double)pa, hbp / (double)pa, h / (double)pa, d / (double)pa, t / (double)pa, hr / (double)pa);
    }

    /// <summary>Weights each member team with MinTeamPa+ by its games; kOnly averages only the K rate (teams with K-known lines).</summary>
    private static RatesPa? Weighted(List<Member> teams, Func<string, RatesPa?> rates, bool kOnly = false)
    {
        double w = 0, k = 0, bb = 0, ibb = 0, hbp = 0, h = 0, d = 0, t = 0, hr = 0;
        foreach (var m in teams)
        {
            if (rates(m.Team) is not { } r || r.Pa < (kOnly ? 1 : MinTeamPa) || m.Games <= 0) continue;
            if (kOnly) { if (double.IsNaN(r.K)) continue; w += m.Games; k += m.Games * r.K; continue; }
            w += m.Games; bb += m.Games * r.Bb; ibb += m.Games * r.Ibb; hbp += m.Games * r.Hbp; h += m.Games * r.H; d += m.Games * r.D; t += m.Games * r.T; hr += m.Games * r.Hr;
        }
        if (w == 0) return null;
        return new RatesPa(1, k / w, bb / w, ibb / w, hbp / w, h / w, d / w, t / w, hr / w);
    }

    /// <summary>Turns weighted rates back into whole counts over the league's real total (K known on every PA).</summary>
    private static void Fill(Counts c, RatesPa r, double kRate, int pa)
    {
        int R(double x) => (int)Math.Round(x * pa);
        int hr = R(r.Hr), d = R(r.D), t = R(r.T), h = Math.Max(R(r.H), hr + d + t);
        c.Add(pa, R(kRate), R(r.Bb), R(r.Ibb), R(r.Hbp), h, d, t, hr);
    }

    private static void AddOverlap(Result res, string id, int year) { if (!res.Overlap.Contains((id, year))) res.Overlap.Add((id, year)); }

    private static PlayerSeason Get(Dictionary<(string, int), PlayerSeason> d, string id, int year) =>
        d.TryGetValue((id, year), out var s) ? s : d[(id, year)] = new PlayerSeason { Id = id, Year = year };

    private static int? N(string? s) => int.TryParse(s, out var v) ? v : null;

    /// <summary>Primary position per player-season from allplayers.csv (most games at a fielding position; "P" when pitching is most).</summary>
    public static Dictionary<string, string> Positions(string allplayersCsv)
    {
        var cols = new[] { ("g_p", "P"), ("g_c", "C"), ("g_1b", "1B"), ("g_2b", "2B"), ("g_3b", "3B"), ("g_ss", "SS"), ("g_lf", "LF"), ("g_cf", "CF"), ("g_rf", "RF"), ("g_dh", "DH") };
        var acc = new Dictionary<string, Dictionary<string, int>>();
        foreach (var r in Rows(allplayersCsv))
        {
            if (!int.TryParse(r["season"], out var y) || y < FirstYear || y > LastYear) continue;
            var key = $"{r["id"]}:{y}";
            var d = acc.TryGetValue(key, out var x) ? x : acc[key] = new();
            foreach (var (c, pos) in cols) d[pos] = d.GetValueOrDefault(pos) + (N(r.GetValueOrDefault(c)) ?? 0);
        }
        return acc.Where(kv => kv.Value.Values.Any(v => v > 0))
            .ToDictionary(kv => kv.Key, kv => kv.Value.OrderByDescending(p => p.Value).ThenBy(p => p.Key, StringComparer.Ordinal).First().Key);
    }

    // ---------------- Merge into an MLB output folder ----------------

    /// <summary>Copies the MLB output with pa_nn2, pa_nal added (0) and appends the NGL rows, leagues, teams and people.</summary>
    public static void Merge(string mlbOut, string outDir, Result r, List<Member> members, string nglTeamsCsv, string nglBiofile0)
    {
        Directory.CreateDirectory(outDir);
        foreach (var f in new[] { "batters.csv", "pitchers.csv" })
        {
            var lines = File.ReadAllLines(Path.Combine(mlbOut, f));
            var sb = new StringBuilder();
            sb.Append(Insert(lines[0], "pa_nn2,pa_nal")).Append('\n');
            foreach (var l in lines.Skip(1)) if (l.Length > 0) sb.Append(Insert(l, "0,0")).Append('\n');
            foreach (var s in f == "batters.csv" ? r.Batters : r.Pitchers)
                sb.Append(string.Join(",", s.Id, s.Year, s.Teams, 0, 0, 0, s.PaByLeague.GetValueOrDefault("NN2"), s.PaByLeague.GetValueOrDefault("NAL"),
                    C(s.Counts), s.Games, s.PbpGames, s.EstimatedGames, s.IpOuts, 'C', s.Position)).Append('\n');
            File.WriteAllText(Path.Combine(outDir, f), sb.ToString());
        }
        var lg = new StringBuilder(File.ReadAllText(Path.Combine(mlbOut, "leagues.csv")));
        foreach (var l in r.Leagues)
        {
            lg.Append($"{l.Year},{l.League},bat,{C(l.Batting)}\n");
            lg.Append($"{l.Year},{l.League},pit,{C(l.Pitching)}\n");
        }
        File.WriteAllText(Path.Combine(outDir, "leagues.csv"), lg.ToString());

        // Teams: one row per team per unbroken stretch of membership in one league.
        var city = Rows(nglTeamsCsv).GroupBy(t => t["TEAM"]).ToDictionary(g => g.Key, g => g.First()["CITY"]);
        var tm = new StringBuilder(File.ReadAllText(Path.Combine(mlbOut, "teams.csv")));
        foreach (var g in members.GroupBy(m => (m.Team, m.League)))
        {
            var years = g.Select(m => m.Season).OrderBy(y => y).ToList();
            var start = years[0];
            for (var i = 1; i <= years.Count; i++)
                if (i == years.Count || years[i] != years[i - 1] + 1)
                {
                    tm.Append(string.Join(",", g.Key.Team, g.Key.League, Q(city.GetValueOrDefault(g.Key.Team, g.Key.Team)), start, years[i - 1])).Append('\n');
                    if (i < years.Count) start = years[i];
                }
        }
        File.WriteAllText(Path.Combine(outDir, "teams.csv"), tm.ToString());

        // People: MLB rows as they are; NGL ids missing from them added from the NGL biofile0.csv (same format).
        var people = File.ReadAllLines(Path.Combine(mlbOut, "people.csv")).Where(l => l.Length > 0).ToList();
        var have = new HashSet<string>(people.Skip(1).Select(l => l.Split(',')[0]));
        var need = new HashSet<string>(r.Batters.Select(b => b.Id).Concat(r.Pitchers.Select(p => p.Id)).Where(id => !have.Contains(id)));
        var tmp = Path.Combine(outDir, "people.ngl.tmp");
        OutputWriter.WritePeople(tmp, nglBiofile0, need);
        var added = File.ReadAllLines(tmp).Skip(1).Where(l => l.Length > 0).ToList();
        File.Delete(tmp);
        File.WriteAllText(Path.Combine(outDir, "people.csv"), string.Join("\n", people.Concat(added)) + "\n");

        foreach (var f in Directory.GetFiles(mlbOut, "*.csv"))
        {
            var name = Path.GetFileName(f);
            if (name is "batters.csv" or "pitchers.csv" or "leagues.csv" or "teams.csv" or "people.csv") continue;
            File.Copy(f, Path.Combine(outDir, name), overwrite: true);
        }
    }

    /// <summary>Inserts text after the 6th field (pa_fl). The first six fields never contain commas or quotes.</summary>
    private static string Insert(string line, string add)
    {
        var at = -1;
        for (var i = 0; i < 6; i++) { at = line.IndexOf(',', at + 1); if (at < 0) throw new FormatException("Short line: " + line); }
        return line[..at] + "," + add + line[at..];
    }

    private static string C(Counts c) => string.Join(",", c.Pa, c.KKnownPa, c.K, c.Bb, c.Ibb, c.Hbp, c.Single, c.Double, c.Triple, c.Hr, c.Oip);
    private static string Q(string s) => s.Contains(',') || s.Contains('"') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;

    public static IEnumerable<Dictionary<string, string>> Rows(string path)
    {
        using var reader = new StreamReader(path);
        var h = Csv.ParseLine(reader.ReadLine() ?? "");
        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            var f = Csv.ParseLine(line);
            var d = new Dictionary<string, string>(h.Length);
            for (var i = 0; i < h.Length; i++) d[h[i]] = i < f.Length ? f[i] : "";
            yield return d;
        }
    }
}
