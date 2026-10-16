using PastimeRivals.Pipeline;

// Usage: dotnet run --project src/PastimeRivals.Pipeline -- build|platoon <rawDir> <outDir> [firstYear] [lastYear]
if (args.Length < 3 || args[0] is not ("build" or "platoon" or "backtest"))
{
    Console.WriteLine("Usage: build|platoon <rawDir> <outDir> [firstYear=1901] [lastYear=2025]");
    return 1;
}

var raw = args[1];
var outDir = args[2];
var first = args.Length > 3 ? int.Parse(args[3]) : 1901;
var last = args.Length > 4 ? int.Parse(args[4]) : 2025;
Directory.CreateDirectory(outDir);

if (args[0] == "backtest")
{
    // backtest <raw> <outDir> first last gap
    var gap = args.Length > 5 ? int.Parse(args[5]) : 1;
    var bmap = LeagueMap.FromTeamAbr(File.ReadLines(Path.Combine(raw, "TEAMABR.TXT")));
    var report = Backtest.Run(CatalogCsv.Load(outDir), raw, bmap, first, last, gap);
    Console.WriteLine(report);
    File.WriteAllText(Path.Combine(outDir, $"backtest_{first}_{last}_gap{gap}.md"), report);
    return 0;
}

if (args[0] == "platoon")
{
    var pmap = LeagueMap.FromTeamAbr(File.ReadLines(Path.Combine(raw, "TEAMABR.TXT")));
    var builder = new PlatoonBuilder();
    for (var y = first; y <= last; y++)
    {
        var n = 0;
        foreach (var play in PlayByPlay.ReadPlays(Path.Combine(raw, "zips", $"{y}csvs.zip"), y, pmap)) { builder.Add(play); n++; }
        Console.WriteLine($"{y}: {n} plate appearances with play-by-play");
    }
    builder.WriteYears(Path.Combine(outDir, $"platoon_{first}_{last}.csv"));
    builder.WriteExposure(Path.Combine(outDir, $"exposure_{first}_{last}.csv"));
    return 0;
}

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
var peopleIds = new HashSet<string>(File.ReadLines(Path.Combine(outDir, "people.csv")).Skip(1).Select(l => l.Split(',')[0]));
var validation = Validator.Run(batters, pitchers, peopleIds);
File.WriteAllText(Path.Combine(outDir, "validation.md"), validation.ToMarkdown());
Console.WriteLine($"Done: {batters.Count} batter-seasons, {pitchers.Count} pitcher-seasons, {ids.Count} people");
Console.WriteLine($"Validation: {validation.Red.Count} red, {validation.Amber.Count} amber (see validation.md)");
return validation.Red.Count == 0 ? 0 : 2;
