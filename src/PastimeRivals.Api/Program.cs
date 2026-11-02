using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using PastimeRivals.Api;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Import;
using PastimeRivals.Api.Stats;
using PastimeRivals.Engine;

var builder = WebApplication.CreateBuilder(args);

if (!string.IsNullOrEmpty(builder.Configuration["Stats:CsvDir"]))
    builder.Services.AddSingleton<IStatsSource, CsvStatsSource>();   // local development
else
    builder.Services.AddSingleton<IStatsSource, SqlStatsSource>();
builder.Services.AddSingleton<IEventSink, SqlEventSink>();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddSingleton<PlayService>();

// Plan 24: challenges. Signing keys live in SQL so restarts keep tokens valid.
builder.Services.AddSingleton<IChallengeStore, SqlChallengeStore>();
builder.Services.AddSingleton<MissCounter>();
builder.Services.AddSingleton<Turnstile>();
builder.Services.AddHttpClient("turnstile", c => c.Timeout = TimeSpan.FromSeconds(5));
if (builder.Environment.IsProduction() && string.IsNullOrEmpty(builder.Configuration["Challenges:IpSalt"]))
    throw new InvalidOperationException("Challenges:IpSalt is missing; run tools/make-server-config.py.");
var dp = builder.Services.AddDataProtection().SetApplicationName("PastimeRivals");
if (builder.Configuration.GetConnectionString("Stats") is { Length: > 0 } dpCs)
    builder.Services.Configure<Microsoft.AspNetCore.DataProtection.KeyManagement.KeyManagementOptions>(o => o.XmlRepository = new SqlKeyRepository(dpCs));
builder.Services.AddAntiforgery(o =>
{
    o.HeaderName = "X-XSRF-TOKEN";
    o.Cookie.Name = "pr_af";
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
});

// Per-address limit on the game API. In memory, so it resets when the server restarts (accepted on shared hosting).
var perMinute = builder.Configuration.GetValue("RateLimit:PerMinute", 240);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("per-ip", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = perMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

var app = builder.Build();

// Plan 24 v2 item 9: browsers remember to use https on the live domain (the http redirect itself is in web.config).
var hstsHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "pastimerivals.com", "www.pastimerivals.com" };
app.Use(async (ctx, next) =>
{
    if (ctx.Request.IsHttps && hstsHosts.Contains(ctx.Request.Host.Host))
        ctx.Response.Headers["Strict-Transport-Security"] = "max-age=31536000";
    await next();
});

// Plan SEO-1: page visits on www go to the main address. API calls, files (anything with a dot), other methods
// and certificate checks pass through, so a www tab left open keeps working until it is reloaded.
app.Use(async (ctx, next) =>
{
    var req = ctx.Request;
    var path = req.Path.Value ?? "/";
    var page = (HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method))
        && !path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)
        && !path.StartsWith("/.well-known/", StringComparison.OrdinalIgnoreCase)
        && !path.Contains('.');
    if (page && string.Equals(req.Host.Host, "www.pastimerivals.com", StringComparison.OrdinalIgnoreCase))
    {
        ctx.Response.StatusCode = StatusCodes.Status301MovedPermanently;
        ctx.Response.Headers.Location = "https://pastimerivals.com" + req.Path.ToUriComponent() + req.QueryString.ToUriComponent();
        return;
    }
    await next();
});

// Plan odds-page-1: the odds page lives at one clean address; its file name redirects there (covers www + .html too).
app.Use(async (ctx, next) =>
{
    if (string.Equals(ctx.Request.Path.Value, "/about/methodology.html", StringComparison.OrdinalIgnoreCase))
    {
        ctx.Response.StatusCode = StatusCodes.Status301MovedPermanently;
        ctx.Response.Headers.Location = "https://pastimerivals.com/about/methodology";
        return;
    }
    await next();
});

// Plan matchup-pages-1: the three matchup pages (plain HTML in wwwroot/matchups). Their file names redirect to the clean address.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    if (path.StartsWith("/matchups/", StringComparison.OrdinalIgnoreCase) && path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
        && MatchupPages.Find(path["/matchups/".Length..^".html".Length]) is { } slug)
    {
        ctx.Response.StatusCode = StatusCodes.Status301MovedPermanently;
        ctx.Response.Headers.Location = "https://pastimerivals.com/matchups/" + slug;
        return;
    }
    await next();
});

app.UseDefaultFiles();
// Plan 39: the app page and the few unversioned files are always checked for a newer copy; versioned files (main-*.js, art) are not touched.
static bool AlwaysCheck(PathString p) => p.Equals("/index.html", StringComparison.OrdinalIgnoreCase) || p.Equals("/sw.js", StringComparison.OrdinalIgnoreCase)
    || p.Equals("/manifest.webmanifest", StringComparison.OrdinalIgnoreCase) || p.Equals("/art-manifest.json", StringComparison.OrdinalIgnoreCase)
    || p.Equals("/voice-manifest.json", StringComparison.OrdinalIgnoreCase);   // plan 50
// Plan 50: announcer clips carry a content hash in their name, so they never change.
static bool Immutable(PathString p) => p.StartsWithSegments("/audio", StringComparison.OrdinalIgnoreCase);
app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = c =>
{
    var path = c.Context.Request.Path;
    if (AlwaysCheck(path)) c.Context.Response.Headers.CacheControl = "no-cache";
    else if (Immutable(path)) c.Context.Response.Headers.CacheControl = "public, max-age=31536000, immutable";
} });
app.UseRateLimiter();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", engineVersion = EngineInfo.Version }));
app.MapImport();
app.MapPlay();
app.MapChallenges();

// Plan 24: link previews for challenge links say only that a game is waiting (never picks or score).
app.MapGet("/c/{code}", async (string code, HttpContext ctx, IChallengeStore store, IWebHostEnvironment env) =>
{
    ctx.Response.Headers.CacheControl = "no-cache";   // plan 39
    var file = env.WebRootFileProvider.GetFileInfo("index.html");
    if (!file.Exists) return Results.NotFound();
    using var reader = new StreamReader(file.CreateReadStream());
    var html = await reader.ReadToEndAsync();
    ChallengeStatus? status = null;
    if (Identity.CodePattern().IsMatch(code)) { try { status = (await store.GetAsync(code))?.Status; } catch { /* preview text only */ } }
    var title = status == ChallengeStatus.Resolved ? "Your game is ready" : "You've been challenged on Pastime Rivals";
    var desc = status == ChallengeStatus.Resolved ? "Watch the game on Pastime Rivals." : "Pick a pitcher and a batting order from all of baseball history. Can you beat my team?";
    var meta = $"<meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{desc}\">"
        + "<meta property=\"og:image\" content=\"https://pastimerivals.com/og/pr-share-v1.png\"><meta property=\"og:image:width\" content=\"1200\">"
        + "<meta property=\"og:image:height\" content=\"630\"><meta property=\"og:type\" content=\"website\">"
        + "<meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"robots\" content=\"noindex\">";
    html = html.Replace("<title>Pastime Rivals</title>", $"<title>{title}</title>")
        .Replace("<link rel=\"canonical\" href=\"https://pastimerivals.com/\">", "");   // game pages are noindex, not copies of home
    // Plan 29: swap the home page's preview block for the challenge's own, so the page carries exactly one set.
    var a = html.IndexOf("<!--og-->", StringComparison.Ordinal);
    var b = html.IndexOf("<!--/og-->", StringComparison.Ordinal);
    html = a >= 0 && b > a ? html[..a] + meta + html[(b + "<!--/og-->".Length)..] : html.Replace("</head>", meta + "</head>");
    return Results.Content(html, "text/html; charset=utf-8");
}).RequireRateLimiting("per-ip");

// Plan 28: crawl rules. Only the live domain is crawlable; game links (/c/) stay open for link-preview bots and send noindex.
app.MapGet("/robots.txt", (HttpContext ctx) =>
{
    var host = ctx.Request.Host.Host.ToLowerInvariant();
    var live = host is "pastimerivals.com" or "www.pastimerivals.com";
    var body = live
        ? "User-agent: *\nDisallow: /api/\nSitemap: https://pastimerivals.com/sitemap.xml\n"
        : "User-agent: *\nDisallow: /\n";
    return Results.Text(body, "text/plain; charset=utf-8");
});

// Single-page app: the home page and challenge links (/c/<one segment>) serve index.html for GET and HEAD.
// Plan SEO-1: every other unknown address is a real 404 (was the app page with 200, which Google treats as a soft 404).
var appPage = new System.Text.RegularExpressions.Regex("^/(c/[^/]+/?)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
const string NotFoundPage = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Page not found | Pastime Rivals</title>"
    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>"
    + "<body style=\"font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5\">"
    + "<h1>Page not found</h1><p>There is nothing at this address.</p><p><a href=\"/\">Play Pastime Rivals</a></p></body></html>";
// Plan odds-page-1: "How the odds work" (plain HTML in wwwroot/about/methodology.html). Routing treats a trailing slash
// as the same route, so the handler sends that form to the clean address itself.
app.MapMethods("/about/methodology", new[] { "GET", "HEAD" }, (HttpContext ctx, IWebHostEnvironment env) =>
{
    ctx.Response.Headers.CacheControl = "no-cache";
    if ((ctx.Request.Path.Value ?? "").EndsWith('/'))
    {
        ctx.Response.Headers.Location = "/about/methodology";
        return Results.StatusCode(StatusCodes.Status301MovedPermanently);
    }
    var file = env.WebRootFileProvider.GetFileInfo("about/methodology.html");
    if (!file.Exists) return Results.Content(NotFoundPage, "text/html; charset=utf-8", statusCode: StatusCodes.Status404NotFound);
    return Results.File(file.CreateReadStream(), "text/html; charset=utf-8", lastModified: file.LastModified,
        entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{(file.LastModified.UtcTicks ^ file.Length):x}\""), enableRangeProcessing: false);
});

// Plan matchup-pages-1: only the listed slugs exist; the file is always opened by its lowercase list name.
// A trailing slash or other letter case gets one 301 to the clean lowercase address.
app.MapMethods("/matchups/{slug}", new[] { "GET", "HEAD" }, (string slug, HttpContext ctx, IWebHostEnvironment env) =>
{
    ctx.Response.Headers.CacheControl = "no-cache";
    var raw = ctx.Request.Path.Value ?? "";
    if (MatchupPages.Find(slug) is not { } name)
        return Results.Content(NotFoundPage, "text/html; charset=utf-8", statusCode: StatusCodes.Status404NotFound);
    if (raw != "/matchups/" + name)
    {
        ctx.Response.Headers.Location = "/matchups/" + name;
        return Results.StatusCode(StatusCodes.Status301MovedPermanently);
    }
    var file = env.WebRootFileProvider.GetFileInfo("matchups/" + name + ".html");
    if (!file.Exists) return Results.Content(NotFoundPage, "text/html; charset=utf-8", statusCode: StatusCodes.Status404NotFound);
    return Results.File(file.CreateReadStream(), "text/html; charset=utf-8", lastModified: file.LastModified,
        entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{(file.LastModified.UtcTicks ^ file.Length):x}\""), enableRangeProcessing: false);
});

app.MapFallback((HttpContext ctx, IWebHostEnvironment env) =>
{
    ctx.Response.Headers.CacheControl = "no-cache";
    var req = ctx.Request;
    if ((HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method)) && appPage.IsMatch(req.Path.Value ?? "/"))
    {
        var file = env.WebRootFileProvider.GetFileInfo("index.html");
        if (file.Exists)   // same ETag / Last-Modified the static file handler gave "/" before, so repeat visits get a short "not modified"
            return Results.File(file.CreateReadStream(), "text/html; charset=utf-8", lastModified: file.LastModified,
                entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{(file.LastModified.UtcTicks ^ file.Length):x}\""), enableRangeProcessing: false);
    }
    return Results.Content(NotFoundPage, "text/html; charset=utf-8", statusCode: StatusCodes.Status404NotFound);
});

app.Run();

public partial class Program { }

/// <summary>Plan matchup-pages-1: the matchup pages that exist. Add a slug here and a file in wwwroot/matchups to publish one.</summary>
public static class MatchupPages
{
    public static readonly string[] Slugs =
    {
        "babe-ruth-vs-todays-pitchers",
        "barry-bonds-2001-vs-bob-gibson-1968",
        "ted-williams-1941-vs-sandy-koufax-1965",
    };
    public static string? Find(string slug) => Slugs.FirstOrDefault(s => string.Equals(s, slug, StringComparison.OrdinalIgnoreCase));
}
