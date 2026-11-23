using System.Security.Cryptography;

namespace PastimeRivals.Api.Challenges;

/// <summary>
/// Plan 79 A: server-made team names, "City Noun" from two approved lists (Project doc planning/79-STEP0-NAME-LISTS.md,
/// APPROVED 2026-11-23). Stored without "The"; pages say "The Toledo Night Owls". The board short name is the noun.
/// </summary>
public static class TeamNames
{
    public static readonly IReadOnlyList<string> Cities = new[]
    {
        "Toledo", "Tacoma", "Boise", "Duluth", "Savannah", "Wichita", "Spokane", "Albany", "Mobile", "Fresno", "Akron",
        "Tulsa", "Omaha", "Reno", "Peoria", "Dayton", "Eugene", "Erie", "Joliet", "Lansing", "Topeka", "Yakima",
    };

    public static readonly IReadOnlyList<string> Nouns = new[]
    {
        "Night Owls", "Lamplighters", "Harbor Seals", "Moonrakers", "Lightkeepers", "Blue Herons", "Ironclads", "Riveters",
        "Sandpipers", "Hummingbirds", "Barn Owls", "Starlings", "Kingfishers", "Pronghorns", "Wolfhounds", "Cloudbusters",
        "Night Herons", "Peregrines", "Tumbleweeds", "Lanterns", "Bluebills", "Shipwrights",
    };

    public const int MaxLength = 24;

    public static IEnumerable<string> All() => Cities.SelectMany(c => Nouns.Select(n => $"{c} {n}"));

    private static (string City, string Noun)? Split(string? name)
    {
        if (name is null) return null;
        foreach (var c in Cities)
            if (name.StartsWith(c + " ", StringComparison.Ordinal) && Nouns.Contains(name[(c.Length + 1)..])) return (c, name[(c.Length + 1)..]);
        return null;
    }

    /// <summary>True only for a name the current lists make, exactly (case included).</summary>
    public static bool IsListName(string? name) => Split(name) is not null;

    public static string? CityOf(string? name) => Split(name)?.City;

    /// <summary>n distinct list names; none shares the avoided name's city (or the name itself, for typed names).</summary>
    public static IReadOnlyList<string> Suggest(int n, string? avoid = null)
    {
        var city = CityOf(avoid);
        var set = new List<string>();
        while (set.Count < n)
        {
            var c = Cities[RandomNumberGenerator.GetInt32(Cities.Count)];
            if (c == city) continue;
            var name = $"{c} {Nouns[RandomNumberGenerator.GetInt32(Nouns.Count)]}";
            if (name != avoid && !set.Any(x => CityOf(x) == c)) set.Add(name);
        }
        return set;
    }

    /// <summary>Board short name: the noun for a list name; for a typed name the whole name if 12 or fewer characters,
    /// else its last word if 12 or fewer, else the first 11 and "…" (plan 79-A1 section 7).</summary>
    public static string Short(string name, bool typed)
    {
        if (!typed && Split(name) is { } s) return s.Noun;
        if (name.Length <= 12) return name;
        var last = name.Split(' ')[^1];
        return last.Length <= 12 ? last : name[..11].TrimEnd() + "…";
    }
}
