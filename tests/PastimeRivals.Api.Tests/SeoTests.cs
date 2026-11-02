using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan SEO-1 (PLAN-2026-11-02-seo-fixes-v5): real text, structured data, real 404s, www to the main address.</summary>
public class SeoTests
{
    private const string Apex = "https://pastimerivals.com";
    private const string Www = "https://www.pastimerivals.com";

    // One shared test server for the class: a server per case runs out of file watchers on Linux.
    private static readonly WebApplicationFactory<Program> Shared =
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("RateLimit:PerMinute", "10000");
            b.ConfigureTestServices(s =>
            {
                s.AddSingleton<IStatsSource, InningStats>();
                s.AddSingleton<IEventSink, MemoryEvents>();
                s.AddSingleton<IChallengeStore>(new MemoryChallengeStore());
            });
        });

    private static HttpClient Client(string baseUrl = Apex) =>
        Shared.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri(baseUrl), AllowAutoRedirect = false });

    private static Task<HttpResponseMessage> Send(HttpClient c, string method, string path) =>
        c.SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

    private static string AppRoot(string html)
    {
        var m = Regex.Match(html, "<app-root>(.*?)</app-root>", RegexOptions.Singleline);
        Assert.True(m.Success, "no <app-root> element");
        return m.Groups[1].Value;
    }

    // T1
    [Fact]
    public async Task Home_page_source_has_real_text()
    {
        var inner = AppRoot(await Client().GetStringAsync("/"));
        Assert.Matches("<h1[^>]*>\\s*Pastime Rivals\\s*</h1>", inner);
        var words = Regex.Replace(inner, "<[^>]+>", " ").Split((char[])null!, StringSplitOptions.RemoveEmptyEntries);
        Assert.True(words.Length >= 40, $"only {words.Length} words inside app-root");
        Assert.Contains("Retrosheet", inner);
    }

    // T2
    [Fact]
    public async Task Home_has_valid_ld_json()
    {
        var html = await Client().GetStringAsync("/");
        var blocks = Regex.Matches(html, "<script type=\"application/ld\\+json\">(.*?)</script>", RegexOptions.Singleline);
        Assert.Single(blocks);
        var json = blocks[0].Groups[1].Value;
        using var doc = JsonDocument.Parse(json);
        var types = doc.RootElement.GetProperty("@graph").EnumerateArray().Select(e => e.GetProperty("@type").GetString()).ToList();
        Assert.Contains("Organization", types);
        Assert.Contains("WebSite", types);
        Assert.DoesNotContain("aggregateRating", json);
        Assert.DoesNotContain("\"review", json);
    }

    // T3
    [Theory]
    [InlineData("/made-up-page")] [InlineData("/x/y")] [InlineData("/c")] [InlineData("/c/a/b")]
    public async Task Unknown_paths_are_404(string path)
    {
        var r = await Client().GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.True(r.Headers.CacheControl?.NoCache == true, $"{path}: {r.Headers.CacheControl}");
        var body = await r.Content.ReadAsStringAsync();
        Assert.Contains("href=\"/\"", body);
        Assert.DoesNotContain("<app-root", body);
    }

    // T4 (characterize)
    [Theory]
    [InlineData("GET", "/")] [InlineData("GET", "/?b=ruthb101")] [InlineData("GET", "/c/new")] [InlineData("GET", "/c/abcdefghijklmnopqrstuv")]
    [InlineData("GET", "/c/abc/")] [InlineData("HEAD", "/c/abc")] [InlineData("HEAD", "/c/abcdefghijklmnopqrstuvwxyzabcdefghijklmno")] [InlineData("HEAD", "/")]
    public async Task App_paths_still_200(string method, string path)
    {
        var r = await Send(Client(), method, path);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    // T5
    [Theory]
    [InlineData("GET", "/c/new?vs=cpu")] [InlineData("HEAD", "/")] [InlineData("GET", "/")] [InlineData("GET", "/c/a%20b?x=%26")] [InlineData("GET", "/made-up-page")]
    public async Task Www_redirects_to_apex(string method, string pathAndQuery)
    {
        var r = await Send(Client(Www), method, pathAndQuery);
        Assert.Equal(HttpStatusCode.MovedPermanently, r.StatusCode);
        Assert.Equal(Apex + pathAndQuery, r.Headers.Location!.OriginalString);
        Assert.True(r.Headers.Contains("Strict-Transport-Security"));
    }

    // T5b (characterize)
    [Theory]
    [InlineData("POST", "/api/challenges/computer")] [InlineData("OPTIONS", "/")] [InlineData("GET", "/api/health")]
    [InlineData("GET", "/main-x.js")] [InlineData("GET", "/sw.js")] [InlineData("GET", "/art-manifest.json")]
    public async Task Www_non_page_requests_pass_through(string method, string path)
    {
        var r = await Send(Client(Www), method, path);
        Assert.NotEqual(HttpStatusCode.MovedPermanently, r.StatusCode);
        Assert.NotEqual(HttpStatusCode.PermanentRedirect, r.StatusCode);
        Assert.NotEqual(HttpStatusCode.Redirect, r.StatusCode);
    }

    // T6 (characterize)
    [Theory]
    [InlineData(Www, "/.well-known/acme-challenge/x")] [InlineData(Apex, "/")] [InlineData("https://lessonwriter-001-site12.ltempurl.com", "/")]
    public async Task Well_known_and_other_hosts_are_not_redirected(string host, string path)
    {
        var r = await Client(host).GetAsync(path);
        Assert.Null(r.Headers.Location);
    }

    // T7
    [Fact]
    public async Task Api_unknown_is_404()
    {
        var r = await Client().GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.DoesNotContain("<app-root", await r.Content.ReadAsStringAsync());
    }

    // T8
    [Theory]
    [InlineData("POST", "/c/abc")] [InlineData("PUT", "/c/abc")] [InlineData("OPTIONS", "/c/abc")]
    [InlineData("POST", "/made-up-page")] [InlineData("PUT", "/made-up-page")] [InlineData("OPTIONS", "/made-up-page")]
    [InlineData("POST", "/api/nope")] [InlineData("PUT", "/api/nope")] [InlineData("OPTIONS", "/api/nope")]
    public async Task Fallback_is_get_head_only(string method, string path)
    {
        var r = await Send(Client(), method, path);
        Assert.Contains(r.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
        Assert.DoesNotContain("<app-root", await r.Content.ReadAsStringAsync());
    }

    // T9 (characterize)
    [Theory]
    [InlineData("/c/abc")] [InlineData("/c/abc/")]
    public async Task Challenge_preview_unchanged(string path)
    {
        var html = await Client().GetStringAsync(path);
        Assert.Contains("You've been challenged on Pastime Rivals", html);
        Assert.Contains("<meta name=\"robots\" content=\"noindex\">", html);
        Assert.DoesNotContain("rel=\"canonical\"", html);
    }

    // Diff review: "/" keeps its revalidation headers, and challenge codes match in any letter case for HEAD as for GET.
    [Fact]
    public async Task Home_keeps_etag_and_last_modified()
    {
        var r = await Client().GetAsync("/");
        Assert.NotNull(r.Headers.ETag);
        Assert.NotNull(r.Content.Headers.LastModified);
        var again = new HttpRequestMessage(HttpMethod.Get, "/");
        again.Headers.IfNoneMatch.Add(r.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await Client().SendAsync(again)).StatusCode);
    }

    [Fact]
    public async Task Head_challenge_path_ignores_letter_case()
    {
        Assert.Equal(HttpStatusCode.OK, (await Send(Client(), "HEAD", "/C/abc")).StatusCode);
    }
}
