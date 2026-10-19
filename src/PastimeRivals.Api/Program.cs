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

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", engineVersion = EngineInfo.Version }));
app.MapImport();
app.MapPlay();
app.MapChallenges();

// Plan 24: link previews for challenge links say only that a game is waiting (never picks or score).
app.MapGet("/c/{code}", async (string code, IChallengeStore store, IWebHostEnvironment env) =>
{
    var file = env.WebRootFileProvider.GetFileInfo("index.html");
    if (!file.Exists) return Results.NotFound();
    using var reader = new StreamReader(file.CreateReadStream());
    var html = await reader.ReadToEndAsync();
    ChallengeStatus? status = null;
    if (Identity.CodePattern().IsMatch(code)) { try { status = (await store.GetAsync(code))?.Status; } catch { /* preview text only */ } }
    var title = status == ChallengeStatus.Resolved ? "Your game is ready" : "You've been challenged on Pastime Rivals";
    var desc = status == ChallengeStatus.Resolved ? "Watch the game on Pastime Rivals." : "Pick a pitcher and three batters from all of baseball history. Can you beat my team?";
    var meta = $"<meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{desc}\">"
        + "<meta property=\"og:image\" content=\"https://pastimerivals.com/icons/icon-512.png\"><meta property=\"og:type\" content=\"website\">"
        + "<meta name=\"twitter:card\" content=\"summary\"><meta name=\"robots\" content=\"noindex\">";
    html = html.Replace("<title>Pastime Rivals</title>", $"<title>{title}</title>{meta}")
        .Replace("<link rel=\"canonical\" href=\"https://pastimerivals.com/\">", "");   // game pages are noindex, not copies of home
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

// Single-page app: unknown non-API paths serve index.html.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program { }
