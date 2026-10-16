using PastimeRivals.Pipeline;

// Usage: dotnet run --project src/PastimeRivals.Pipeline -- build <rawDir> <outDir> [firstYear] [lastYear]
if (args.Length < 3 || args[0] != "build")
{
    Console.WriteLine("Usage: build <rawDir> <outDir> [firstYear=1901] [lastYear=2025]");
    return 1;
}

var raw = args[1];
var outDir = args[2];
var first = args.Length > 3 ? int.Parse(args[3]) : 1901;
var last = args.Length > 4 ? int.Parse(args[4]) : 2025;
Directory.CreateDirectory(outDir);

var map = LeagueMap.FromTeamAbr(File.ReadLines(Path.Combine(raw, "TEAMABR.TXT")));
var source = new RetrosheetSource(raw);
var batters = new List<PlayerSeason>();
var pitchers = new List<PlayerSeason>();
var leagues = new List<LeagueSeason>();

for (var year = first; year <= last; year++)
{
    var r = Aggregator.Build(source.Batting(year), source.Pitching(year), map);
    batters.AddRange(r.Batters);
    pitchers.AddRange(r.Pitchers);
    leagues.AddRange(r.Leagues);
    Console.WriteLine($"{year}: {r.Batters.Count} batters, {r.Pitchers.Count} pitchers, {r.Leagues.Count} leagues");
}

OutputWriter.WritePlayers(Path.Combine(outDir, "batters.csv"), batters);
OutputWriter.WritePlayers(Path.Combine(outDir, "pitchers.csv"), pitchers);
OutputWriter.WriteLeagues(Path.Combine(outDir, "leagues.csv"), leagues);
var ids = new HashSet<string>(batters.Select(b => b.Id).Concat(pitchers.Select(p => p.Id)));
OutputWriter.WritePeople(Path.Combine(outDir, "people.csv"), Path.Combine(raw, "bio", "biofile0.csv"), ids);
Console.WriteLine($"Done: {batters.Count} batter-seasons, {pitchers.Count} pitcher-seasons, {ids.Count} people");
return 0;
