using System.Text;

namespace PastimeRivals.Pipeline;

public sealed record ValidationResult(List<string> Red, List<string> Amber, List<string> Info)
{
    public string ToMarkdown()
    {
        var sb = new StringBuilder("# Data validation report\n\n");
        sb.Append($"Red (build fails): {Red.Count}. Amber (documented gaps): {Amber.Count}.\n\n");
        void Section(string title, List<string> items)
        {
            sb.Append($"## {title}\n\n");
            if (items.Count == 0) sb.Append("None.\n\n");
            foreach (var i in items) sb.Append("- ").Append(i).Append('\n');
            sb.Append('\n');
        }
        Section("Red", Red); Section("Amber", Amber); Section("Info", Info);
        return sb.ToString();
    }
}

public static class Validator
{
    private const double RedPaGap = 0.005;
    private const double AmberPaGap = 0.001;
    private const double AmberUnknownK = 0.01;

    public static ValidationResult Run(List<PlayerSeason> batters, List<PlayerSeason> pitchers, ISet<string> people)
    {
        var red = new List<string>();
        var amber = new List<string>();
        var info = new List<string>();

        foreach (var (kind, list) in new[] { ("batter", batters), ("pitcher", pitchers) })
            foreach (var s in list)
            {
                var c = s.Counts;
                if (c.Single < 0 || c.Oip < 0 || c.KKnownPa > c.Pa || c.Pa < 0)
                    red.Add($"Impossible {kind} counts: {s.Id} {s.Year} (PA {c.Pa}, H {c.H}, singles {c.Single}, outs in play {c.Oip})");
                if (!people.Contains(s.Id)) red.Add($"No person record for {kind} {s.Id} {s.Year}");
            }

        var years = batters.Select(b => b.Year).Concat(pitchers.Select(p => p.Year)).Distinct().OrderBy(y => y);
        foreach (var y in years)
        {
            long batPa = batters.Where(b => b.Year == y).Sum(b => (long)b.Counts.Pa);
            long pitPa = pitchers.Where(p => p.Year == y).Sum(p => (long)p.Counts.Pa);
            var gap = Math.Abs(batPa - pitPa) / (double)Math.Max(1, Math.Max(batPa, pitPa));
            var estimated = pitchers.Any(p => p.Year == y && p.EstimatedGames > 0);
            var msg = $"{y}: batter PA {batPa:N0} vs batters faced {pitPa:N0} (gap {gap:P2})"
                      + (estimated ? "; batters faced partly estimated this year" : "");
            if (gap > RedPaGap && !estimated) red.Add(msg);
            else if (gap > RedPaGap) amber.Add(msg);
            else if (gap > AmberPaGap) amber.Add(msg);

            long kKnown = batters.Where(b => b.Year == y).Sum(b => (long)b.Counts.KKnownPa);
            var unknownShare = 1 - kKnown / (double)Math.Max(1, batPa);
            if (unknownShare > AmberUnknownK)
                amber.Add($"{y}: batter strikeouts unknown for {unknownShare:P1} of plate appearances (rates use known games only)");

            var grades = batters.Where(b => b.Year == y).GroupBy(b => b.Grade).OrderBy(g => g.Key)
                .Select(g => $"{g.Key}:{g.Count()}");
            info.Add($"{y}: {batters.Count(b => b.Year == y)} batter-seasons, {pitchers.Count(p => p.Year == y)} pitcher-seasons, grades {string.Join(" ", grades)}");
        }
        return new ValidationResult(red, amber, info);
    }
}
