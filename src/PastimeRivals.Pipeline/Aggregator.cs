namespace PastimeRivals.Pipeline;

public static class Aggregator
{
    public static BuildResult Build(IEnumerable<BattingLine> batting, IEnumerable<PitchingLine> pitching, LeagueMap map)
    {
        var pitchingList = pitching.ToList();
        var pitchedInGame = new HashSet<(string, string)>(pitchingList.Select(p => (p.Gid, p.Id)));

        var batters = new Dictionary<(string, int), PlayerSeason>();
        var pitchers = new Dictionary<(string, int), PlayerSeason>();
        var leagues = new Dictionary<(int, string), LeagueSeason>();

        LeagueSeason League(int year, string lg) =>
            leagues.TryGetValue((year, lg), out var l) ? l : leagues[(year, lg)] = new LeagueSeason { Year = year, League = lg };

        foreach (var b in batting)
        {
            var lg = map.LeagueOf(b.Team, b.Year);
            if (!LeagueMap.IsIncluded(lg)) continue;
            var s = Get(batters, b.Id, b.Year);
            s.Counts.Add(b.Pa, b.K, b.Bb, b.Ibb, b.Hbp, b.H, b.D, b.T, b.Hr);
            s.PaByLeague[lg!] = s.PaByLeague.GetValueOrDefault(lg!) + b.Pa;
            s.TeamSet.Add(b.Team);
            s.Games++;
            if (b.Pbp is "y") s.PbpGames++;
            if (!pitchedInGame.Contains((b.Gid, b.Id)))
                League(b.Year, lg!).Batting.Add(b.Pa, b.K, b.Bb, b.Ibb, b.Hbp, b.H, b.D, b.T, b.Hr);
        }

        foreach (var p in pitchingList)
        {
            var lg = map.LeagueOf(p.Team, p.Year);
            if (!LeagueMap.IsIncluded(lg)) continue;
            var s = Get(pitchers, p.Id, p.Year);
            s.Counts.Add(p.Bfp, p.K, p.Bb, p.Ibb, p.Hbp, p.H, p.D, p.T, p.Hr);
            s.PaByLeague[lg!] = s.PaByLeague.GetValueOrDefault(lg!) + p.Bfp;
            s.TeamSet.Add(p.Team);
            s.Games++;
            s.IpOuts += p.IpOuts;
            if (p.Pbp is "y") s.PbpGames++;
            League(p.Year, lg!).Pitching.Add(p.Bfp, p.K, p.Bb, p.Ibb, p.Hbp, p.H, p.D, p.T, p.Hr);
        }

        return new BuildResult(
            batters.Values.OrderBy(s => s.Year).ThenBy(s => s.Id).ToList(),
            pitchers.Values.OrderBy(s => s.Year).ThenBy(s => s.Id).ToList(),
            leagues.Values.OrderBy(l => l.Year).ThenBy(l => l.League).ToList());
    }

    private static PlayerSeason Get(Dictionary<(string, int), PlayerSeason> d, string id, int year) =>
        d.TryGetValue((id, year), out var s) ? s : d[(id, year)] = new PlayerSeason { Id = id, Year = year };
}
