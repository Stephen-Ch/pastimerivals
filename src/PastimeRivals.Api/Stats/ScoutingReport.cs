using PastimeRivals.Engine;

namespace PastimeRivals.Api.Stats;

public sealed record Ratio(string Label, double TimesLeague);

/// <summary>Scouting report (plan 10): bio, places, position and how the player compared with his league.</summary>
public sealed record ScoutingReport(string Id, string Name, string Role, int Year, int? Age, string? Height, string? Weight,
    string Bats, string Throws, string Position, IReadOnlyList<string> Places, string Line, char Grade, string Era, bool Hof,
    IReadOnlyList<Ratio> Ratios, string Bio = "");

public static class Reports
{
    public static string EraOf(int year) => year switch
    {
        < 1920 => "1901-1919",
        < 1946 => "1920-1945",
        < 1970 => "1946-1969",
        < 1990 => "1970-1989",
        _ => "1990-2025",
    };

    /// <summary>Age on June 30 of the season (Baseball-Reference convention); null without a full birth date.</summary>
    public static int? AgeOn(int? birthDate, int year)
    {
        if (birthDate is not { } bd || bd < 10000101) return null;
        int y = bd / 10000, m = bd / 100 % 100, d = bd % 100;
        if (m is < 1 or > 12 || d is < 1 or > 31) return null;
        var age = year - y;
        if (m > 6) age--;  // birthday after June 30
        return age;
    }

    public static string? Height(int? inches) => inches is > 0 ? $"{inches / 12}' {inches % 12}\"" : null;
    public static string? Weight(int? lb) => lb is > 0 ? $"{lb} lb" : null;

    public static IReadOnlyList<Ratio> Ratios(SeasonCounts c, Rates league, string role)
    {
        double R(Outcome o) => league[o] > 0 && c.Denominator(o) > 0 ? c.Rate(o) / league[o] : 0;
        var hits = new[] { Outcome.Single, Outcome.Double, Outcome.Triple, Outcome.Hr };
        var hitRate = c.Pa > 0 ? hits.Sum(o => c.Rate(o)) : 0;
        var lgHit = hits.Sum(o => league[o]);
        return role == "pit"
            ? new[] { new Ratio("Strikeouts", R(Outcome.K)), new Ratio("Walks allowed", R(Outcome.Bb)),
                      new Ratio("Hits allowed", lgHit > 0 ? hitRate / lgHit : 0), new Ratio("Home runs allowed", R(Outcome.Hr)) }
            : new[] { new Ratio("Hits", lgHit > 0 ? hitRate / lgHit : 0), new Ratio("Home runs", R(Outcome.Hr)),
                      new Ratio("Walks", R(Outcome.Bb)), new Ratio("Strikeouts", R(Outcome.K)) };
    }
}
