using System.Globalization;
using System.Text;

namespace PastimeRivals.Api.Challenges;

/// <summary>Which rule refused a typed name. The API only ever says "Try another name." (no hint which rule).</summary>
public enum NameRule { Ok, Length, Chars, Letters, Digits, LongWord, Link, BadWord, Mlb }

/// <summary>
/// Plan 79-A1: typed team names. Keep the filter dumb and honest: exact bad words only (NameWords), so normal names always
/// pass; removal is fast instead (report-name). Server only.
/// </summary>
public static class NameRules
{
    /// <summary>NFKC, curly apostrophe to straight, trim, collapse spaces, drop a leading "The " (any case).</summary>
    public static string Clean(string raw)
    {
        var s = raw.Normalize(NormalizationForm.FormKC).Replace('’', '\'');
        s = string.Join(' ', s.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (s.StartsWith("the ", StringComparison.OrdinalIgnoreCase)) s = s[4..].TrimStart();
        return s;
    }

    private static bool AllowedChar(char c) =>
        c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or >= '0' and <= '9' or ' ' or '\'' or '-' or '.' or '&'
        || (c >= 'À' && c <= 'ÿ' && c != '×' && c != '÷');

    /// <summary>Ok with the cleaned name to store, or the first rule that refused it.</summary>
    public static NameRule Check(string? raw, out string clean)
    {
        clean = Clean(raw ?? "");
        var s = clean;
        if (s.Length is < 3 or > TeamNames.MaxLength) return NameRule.Length;
        if (!s.All(AllowedChar)) return NameRule.Chars;
        if (s.Count(char.IsLetter) < 3) return NameRule.Letters;
        var run = 0;
        foreach (var c in s) { run = char.IsDigit(c) ? run + 1 : 0; if (run > 2) return NameRule.Digits; }
        if (s.Split(' ').Any(w => w.Length > 14)) return NameRule.LongWord;
        for (var i = 0; i + 1 < s.Length; i++) if (s[i] == '.' && char.IsLetter(s[i + 1])) return NameRule.Link;
        if (BadWordHits(s).Count > 0) return NameRule.BadWord;
        if (MlbHit(s)) return NameRule.Mlb;
        return NameRule.Ok;
    }

    private static string Fold(string s)
    {
        var sb = new StringBuilder();
        foreach (var ch in s.ToLowerInvariant())
            sb.Append(ch switch { 'ø' => "o", 'æ' => "ae", 'œ' => "oe", 'ð' => "d", 'þ' => "th", 'ß' => "ss", _ => ch.ToString() });
        var d = sb.ToString().Normalize(NormalizationForm.FormD);
        return new string(d.Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
    }

    /// <summary>Check-form tokens: accents stripped, lowercase, punctuation-only tokens dropped, ' . &amp; - removed,
    /// then every run of 1- or 2-character tokens joined into one word ("f u c k", "Ni gg er").</summary>
    public static List<string> Tokens(string name)
    {
        var raw = Fold(name).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(t => new string(t.Where(c => c is not ('\'' or '.' or '&' or '-')).ToArray()))
            .Where(t => t.Length > 0).ToList();
        var outp = new List<string>();
        var shortRun = new StringBuilder();
        foreach (var t in raw)
        {
            if (t.Length <= 2) { shortRun.Append(t); continue; }
            if (shortRun.Length > 0) { outp.Add(shortRun.ToString()); shortRun.Clear(); }
            outp.Add(t);
        }
        if (shortRun.Length > 0) outp.Add(shortRun.ToString());
        return outp;
    }

    /// <summary>The form names are compared in for the 30-day refused list ("Jake Smells." = "Jáke Smells").</summary>
    public static string CheckForm(string name) => string.Join(' ', Tokens(Clean(name)));

    /// <summary>0 1 3 4 5 7 to letters, only in tokens with at least as many letters as digits ("sh1t" maps, "45s" does not).</summary>
    private static string MapDigits(string t)
    {
        int letters = t.Count(char.IsLetter), digits = t.Count(char.IsDigit);
        if (digits == 0 || letters < digits) return t;
        return new string(t.Select(c => c switch { '0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', _ => c }).ToArray());
    }

    private static readonly string[][] AllowedTokens = NameWords.Allowed.Select(a => a.Split(' ')).ToArray();

    /// <summary>Block-list words found, checked before and after the digit mapping, with allowed phrases blanked first.</summary>
    public static List<string> BadWordHits(string name)
    {
        var raw = Tokens(name);
        var hits = new List<string>();
        foreach (var toks in new[] { raw, raw.Select(MapDigits).ToList() })
        {
            var keep = Enumerable.Repeat(true, toks.Count).ToArray();
            foreach (var a in AllowedTokens)
                for (var i = 0; i + a.Length <= toks.Count; i++)
                    if (toks.Skip(i).Take(a.Length).SequenceEqual(a))
                        for (var j = i; j < i + a.Length; j++) keep[j] = false;
            for (var i = 0; i < toks.Count; i++) if (keep[i] && NameWords.Block.Contains(toks[i])) hits.Add(toks[i]);
        }
        return hits;
    }

    /// <summary>True when any run of neighbouring words, joined, exactly equals a distinctive MLB nickname.</summary>
    public static bool MlbHit(string name)
    {
        var t = Tokens(name);
        for (var i = 0; i < t.Count; i++)
        {
            var sb = new StringBuilder();
            for (var j = i; j < t.Count && sb.Length < 20; j++)
            {
                sb.Append(t[j]);
                if (NameWords.Mlb.Contains(sb.ToString())) return true;
            }
        }
        return false;
    }
}
