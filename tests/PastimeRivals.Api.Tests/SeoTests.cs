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

    // T10 (amendment A1): visitors with scripts off are told why the game is not showing, high enough to be seen
    // (the page cannot scroll), on the home page and on shared game links.
    [Theory]
    [InlineData("/")] [InlineData("/c/abc")]
    public async Task No_script_visitors_are_told_to_turn_on_javascript(string path)
    {
        var inner = AppRoot(await Client().GetStringAsync(path));
        var m = Regex.Match(inner, "</h1>\\s*<noscript>(.*?)</noscript>\\s*<p>", RegexOptions.Singleline);
        Assert.True(m.Success, "no <noscript> right after the H1");
        Assert.Contains("needs JavaScript", m.Groups[1].Value);
        Assert.True(inner.IndexOf("<noscript>") < inner.IndexOf("<h2>"));
    }

    // ---- Plan odds-page-1 (PLAN-2026-11-02-odds-page-v2) ----
    private const string OddsCanonical = "<link rel=\"canonical\" href=\"https://pastimerivals.com/about/methodology\">";

    [Theory]
    [InlineData("/about/methodology")] [InlineData("/About/Methodology")]
    public async Task Odds_page_serves_real_text(string path)
    {
        var r = await Client().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("text/html", r.Content.Headers.ContentType?.MediaType);
        Assert.True(r.Headers.CacheControl?.NoCache == true);
        var html = await r.Content.ReadAsStringAsync();
        Assert.Contains("<h1>How the odds work</h1>", html);
        Assert.Contains("obtained free of charge from and is copyrighted by Retrosheet", html);
        Assert.Contains("not affiliated with or endorsed by Major League Baseball", html);
        Assert.Contains(OddsCanonical, html);
        Assert.Contains("<meta property=\"og:url\" content=\"https://pastimerivals.com/about/methodology\">", html);
        Assert.DoesNotContain("<script", html);
    }

    [Fact]
    public async Task Odds_page_head_is_200()
    {
        var r = await Send(Client(), "HEAD", "/about/methodology");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("text/html", r.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Odds_page_repeat_visit_is_not_modified()
    {
        var r = await Client().GetAsync("/about/methodology");
        Assert.NotNull(r.Headers.ETag);
        Assert.NotNull(r.Content.Headers.LastModified);
        var again = new HttpRequestMessage(HttpMethod.Get, "/about/methodology");
        again.Headers.IfNoneMatch.Add(r.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await Client().SendAsync(again)).StatusCode);
    }

    [Theory]
    [InlineData(Apex, "/about/methodology/", "/about/methodology")]
    [InlineData(Apex, "/about/methodology.html", "https://pastimerivals.com/about/methodology")]
    [InlineData(Apex, "/About/Methodology.HTML", "https://pastimerivals.com/about/methodology")]
    [InlineData(Www, "/about/methodology.html", "https://pastimerivals.com/about/methodology")]
    [InlineData(Www, "/about/methodology", "https://pastimerivals.com/about/methodology")]
    public async Task Odds_page_other_addresses_redirect(string host, string path, string location)
    {
        var r = await Client(host).GetAsync(path);
        Assert.Equal(HttpStatusCode.MovedPermanently, r.StatusCode);
        Assert.Equal(location, r.Headers.Location?.OriginalString);
    }

    [Theory]
    [InlineData("/about/")] [InlineData("/about")] [InlineData("/about/other")] [InlineData("/about/methodology/x")]
    public async Task Odds_page_neighbours_are_404(string path)
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client().GetAsync(path)).StatusCode);
    }

    [Theory]
    [InlineData("POST")] [InlineData("PUT")] [InlineData("DELETE")]
    public async Task Odds_page_other_methods_are_not_500(string method)
    {
        var r = await Send(Client(), method, "/about/methodology");
        Assert.Contains(r.StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Fact]
    public async Task Sitemap_and_home_link_the_odds_page()
    {
        Assert.Contains("<loc>https://pastimerivals.com/about/methodology</loc>", await Client().GetStringAsync("/sitemap.xml"));
        Assert.Contains("<a href=\"/about/methodology\">How the odds work</a>", AppRoot(await Client().GetStringAsync("/")));
    }
}
