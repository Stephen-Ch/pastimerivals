using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace PastimeRivals.Api.Challenges;

/// <summary>Guest cookie, private-link keys, codes and generated nicknames (plan 24).</summary>
public static partial class Identity
{
    public const string GuestCookie = "pr_g";

    public static string NewToken(int bytes = 32) => Base64Url(RandomNumberGenerator.GetBytes(bytes));

    /// <summary>Challenge code: 16 random bytes (128 bits), 22 characters.</summary>
    public static string NewCode() => NewToken(16);

    public static string Hash(string s) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    public static string IpHash(HttpContext ctx, string salt) => Hash(salt + "|" + MissCounter.KeyFor(ctx));

    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    [GeneratedRegex("^[A-Za-z0-9_-]{22}$")]
    public static partial Regex CodePattern();

    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")]
    public static partial Regex KeyPattern();

    public static readonly string[] Words =
    {
        "Slugger", "Ace", "Southpaw", "Rookie", "Skipper", "Knuckler", "Heater", "Dinger", "Gapper", "Lefty",
        "Bleacher", "Fastball", "Curveball", "Clutch", "Hurler", "Shortstop", "Catcher", "Closer", "Leadoff", "Cleanup",
    };

    [GeneratedRegex("^([A-Za-z]+) ([0-9]{2,4})$")]
    private static partial Regex NickPattern();

    public static string NewNickname() => $"{Words[RandomNumberGenerator.GetInt32(Words.Length)]} {RandomNumberGenerator.GetInt32(10, 10000)}";

    public static IReadOnlyList<string> NicknameChoices(int n = 3)
    {
        var set = new HashSet<string>();
        while (set.Count < n) set.Add(NewNickname());
        return set.ToList();
    }

    /// <summary>Only generated nicknames for now; typed names need the age screen first (plan 24 v2 item 6).</summary>
    public static bool IsGeneratedNickname(string? s) =>
        s is not null && NickPattern().Match(s) is { Success: true } m && Words.Contains(m.Groups[1].Value);

    public static void SetGuestCookie(HttpContext ctx, string token) =>
        ctx.Response.Cookies.Append(GuestCookie, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = ctx.Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/api",
            MaxAge = TimeSpan.FromDays(365),
            IsEssential = true,
        });
}

/// <summary>Slows down guessing of challenge codes and private keys: too many misses per address get a 429.</summary>
public sealed class MissCounter
{
    private readonly ConcurrentDictionary<string, (int Count, DateTime Start)> _misses = new();
    public int Limit { get; init; } = 30;
    public TimeSpan Window { get; init; } = TimeSpan.FromMinutes(10);

    private int _calls;

    /// <summary>IPv6 visitors are counted by their /64 network, since one phone can rotate addresses inside it.</summary>
    public static string KeyFor(HttpContext ctx)
    {
        var ip = ctx.Connection.RemoteIpAddress;
        if (ip is null) return "unknown";
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6) return Convert.ToHexString(ip.GetAddressBytes(), 0, 8);
        return ip.ToString();
    }

    public bool Blocked(string key) => _misses.TryGetValue(key, out var v) && DateTime.UtcNow - v.Start < Window && v.Count >= Limit;

    public void Miss(string key)
    {
        _misses.AddOrUpdate(key, _ => (1, DateTime.UtcNow),
            (_, v) => DateTime.UtcNow - v.Start >= Window ? (1, DateTime.UtcNow) : (v.Count + 1, v.Start));
        // Forget old entries now and then so memory stays small.
        if (Interlocked.Increment(ref _calls) % 1000 == 0)
            foreach (var kv in _misses)
                if (DateTime.UtcNow - kv.Value.Start >= Window) _misses.TryRemove(kv.Key, out _);
    }
}

/// <summary>Cloudflare Turnstile check. With no secret configured (local, tests, before Stephen adds keys) it passes.</summary>
public sealed class Turnstile(IConfiguration cfg, IHttpClientFactory http, ILogger<Turnstile> log)
{
    public bool Enabled => !string.IsNullOrEmpty(cfg["Turnstile:Secret"]);

    public async Task<bool> PassesAsync(string? token, HttpContext ctx)
    {
        if (!Enabled) return true;
        if (string.IsNullOrEmpty(token) || token.Length > 2048) return false;
        try
        {
            var form = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = cfg["Turnstile:Secret"]!,
                ["response"] = token,
                ["remoteip"] = ctx.Connection.RemoteIpAddress?.ToString() ?? "",
            });
            using var res = await http.CreateClient("turnstile").PostAsync("https://challenges.cloudflare.com/turnstile/v0/siteverify", form);
            using var doc = System.Text.Json.JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement.TryGetProperty("success", out var ok) && ok.GetBoolean();
        }
        catch (Exception e)
        {
            log.LogWarning(e, "Turnstile check failed");
            return false;
        }
    }
}
