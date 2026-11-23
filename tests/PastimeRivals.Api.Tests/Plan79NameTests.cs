using System.Text.Json;
using PastimeRivals.Api.Challenges;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 79 A (server-made team names) and A1 (typed names: cleaning, bad words, MLB nicknames). Pure rules, no server.</summary>
public class Plan79NameTests
{
    private static IReadOnlyList<string> FixtureNouns()
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "real-club-nouns.json")));
        return doc.RootElement.GetProperty("nouns").EnumerateArray().Select(e => e.GetString()!).ToList();
    }

    private static string Fold(string s)
    {
        var t = new string(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        return t.EndsWith('s') ? t[..^1] : t;
    }

    // ---- Part A: the two word lists ----

    [Fact]
    public void Lists_have_22_cities_and_22_nouns_and_484_names()
    {
        Assert.Equal(22, TeamNames.Cities.Count);
        Assert.Equal(22, TeamNames.Nouns.Count);
        Assert.Equal(484, TeamNames.All().Distinct().Count());
        Assert.Contains("Toledo Night Owls", TeamNames.All());
    }

    [Fact]
    public void No_list_noun_is_a_real_club_noun()
    {
        var real = FixtureNouns().Select(Fold).ToHashSet();
        Assert.True(real.Count > 300);
        Assert.Empty(TeamNames.Nouns.Where(n => real.Contains(Fold(n))));
    }

    [Fact]
    public void Every_list_name_fits_24_characters_and_its_short_name_is_the_noun_never_a_city_word()
    {
        foreach (var name in TeamNames.All())
        {
            Assert.True(name.Length <= 24, name);
            var shortName = TeamNames.Short(name, typed: false);
            Assert.Contains(shortName, TeamNames.Nouns);
            Assert.DoesNotContain(TeamNames.Cities, c => shortName.Split(' ').Contains(c));
        }
    }

    [Fact]
    public void IsListName_accepts_only_names_the_lists_can_make()
    {
        Assert.True(TeamNames.IsListName("Toledo Night Owls"));
        Assert.True(TeamNames.IsListName("Erie Kingfishers"));
        Assert.False(TeamNames.IsListName("toledo night owls"));
        Assert.False(TeamNames.IsListName("Toledo Barnstormers"));
        Assert.False(TeamNames.IsListName("Night Owls"));
        Assert.False(TeamNames.IsListName(null));
    }

    [Fact]
    public void Suggestions_are_distinct_list_names_and_skip_a_city()
    {
        for (var i = 0; i < 200; i++)
        {
            var s = TeamNames.Suggest(4, avoid: "Toledo Night Owls");
            Assert.Equal(4, s.Distinct().Count());
            Assert.All(s, n => Assert.True(TeamNames.IsListName(n)));
            Assert.DoesNotContain(s, n => TeamNames.CityOf(n) == "Toledo");
        }
    }

    [Fact]
    public void Typed_short_name_rule()
    {
        Assert.Equal("Riveters", TeamNames.Short("Toledo Riveters", typed: false));
        Assert.Equal("Jake's Nine", TeamNames.Short("Jake's Nine", typed: true));
        Assert.Equal("Riveters", TeamNames.Short("Mighty Toledo Riveters", typed: true));
        Assert.Equal("Mighty Abcd…", TeamNames.Short("Mighty Abcdefghijklmn", typed: true));
    }

    // ---- A1: cleaning and allowed text ----

    [Theory]
    [InlineData("  The   Savannah  Lamplighters ", "Savannah Lamplighters")]
    [InlineData("Ｔａｃｏｍａ Titans", "Tacoma Titans")]
    [InlineData("the Erie Comets", "Erie Comets")]
    [InlineData("A&B's Riveters", "A&B's Riveters")]
    [InlineData("Colt .45s", "Colt .45s")]
    public void Clean_stores_the_cleaned_name(string raw, string stored)
    {
        Assert.Equal(NameRule.Ok, NameRules.Check(raw, out var clean));
        Assert.Equal(stored, clean);
    }

    [Theory]
    [InlineData("ab", NameRule.Length)]
    [InlineData("Abcdefghij Klmnopqrst Uvwxyz", NameRule.Length)]
    [InlineData("Tacoma ​Titans", NameRule.Chars)]
    [InlineData("Токио Titans", NameRule.Chars)]
    [InlineData("Tacoma × Titans", NameRule.Chars)]
    [InlineData("Tacoma Titans!", NameRule.Chars)]
    [InlineData("12 34", NameRule.Letters)]
    [InlineData("Ab 123", NameRule.Digits)]
    [InlineData("Supercalifragilistic", NameRule.LongWord)]
    [InlineData("Go to evil.com", NameRule.Link)]
    [InlineData("F4g", NameRule.Letters)]
    public void Each_text_rule_refuses(string raw, NameRule rule) => Assert.Equal(rule, NameRules.Check(raw, out _));

    // ---- A1: bad words (the approved lists in NameWords) ----

    [Theory]
    [InlineData("Tacoma F4g")]
    [InlineData("Tacoma s h 1 t")]
    [InlineData("f - u - c - k Raiders")]
    [InlineData("Cøck Kings")]
    [InlineData("KKK Raiders")]
    [InlineData("Ni gg er Tacoma")]
    [InlineData("Tacoma Fuckers")]
    [InlineData("Dumbass Dingos")]
    [InlineData("Shithead Sharks")]
    [InlineData("Kiss My Ass")]
    [InlineData("Tacoma Sh1t")]
    [InlineData("Spic Kings")]
    [InlineData("Tacoma Rahowa")]
    [InlineData("Heil Hawks")]
    [InlineData("Motherfuckers")]
    [InlineData("Tacoma Beavers")]
    [InlineData("Erie Hate")]
    public void Bad_words_refuse_by_the_bad_word_rule(string raw) => Assert.Equal(NameRule.BadWord, NameRules.Check(raw, out _));

    [Theory]
    [InlineData("Tacoma Yankees")]
    [InlineData("Erie Red Sox")]
    [InlineData("Blue Jays")]
    [InlineData("Black Yankees")]
    [InlineData("Duluth D-backs")]
    public void Distinct_mlb_nicknames_refuse(string raw) => Assert.Equal(NameRule.Mlb, NameRules.Check(raw, out _));

    [Theory]
    [InlineData("Colt .45s")]
    [InlineData("Tacoma National")]
    [InlineData("Guardian Angels")]
    [InlineData("Black Crackers")]
    [InlineData("Scunthorpe Shipwrights")]
    [InlineData("Essex Starlings")]
    [InlineData("Tacoma Giants")]
    [InlineData("Tacoma Comets")]
    [InlineData("Gamecocks")]
    [InlineData("Raccoons")]
    [InlineData("Drapers")]
    [InlineData("Hancock Hawks")]
    [InlineData("Penistone Peregrines")]
    [InlineData("Blue Tits")]
    [InlineData("Moby Dicks")]
    [InlineData("Coon Hounds")]
    [InlineData("Kane County Cougars")]
    [InlineData("Metropolitans")]
    [InlineData("St. Louis Browns")]
    public void Ordinary_names_pass(string raw) => Assert.Equal(NameRule.Ok, NameRules.Check(raw, out _));

    [Fact]
    public void Must_pass_sweep_every_server_name_and_every_fixture_noun_with_every_city_that_fits()
    {
        var bad = new List<string>();
        foreach (var n in TeamNames.All().Concat(TeamNames.All().Select(n => "The " + n)))
            if (NameRules.Check(n, out _) != NameRule.Ok) bad.Add(n);
        foreach (var noun in FixtureNouns())
        {
            if (NameRules.MlbHit(noun)) continue;   // refused on purpose (Yankees, Black Yankees, ...)
            foreach (var city in TeamNames.Cities.Append(""))
            {
                var name = (city + " " + noun).Trim();
                if (name.Length > 24) continue;
                if (NameRules.Check(name, out _) != NameRule.Ok) bad.Add(name);
            }
        }
        Assert.Empty(bad);
    }

    [Theory]
    [InlineData("Fuuuck Fliers")]
    [InlineData("Phuck Fliers")]
    [InlineData("Kiss My A55")]
    [InlineData("Jake Smells")]
    public void Known_holes_still_pass_so_nobody_thinks_they_are_covered(string raw) => Assert.Equal(NameRule.Ok, NameRules.Check(raw, out _));

    [Fact]
    public void Check_form_matches_reported_copies()
    {
        Assert.Equal(NameRules.CheckForm("Jake Smells"), NameRules.CheckForm("Jáke  Smells."));
    }

    [Fact]
    public void A_name_check_takes_under_a_millisecond()
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (var i = 0; i < 2000; i++) NameRules.Check("The Savannah Lamplighters", out _);
        Assert.True(sw.Elapsed.TotalMilliseconds / 2000 < 1.0);
    }
}
