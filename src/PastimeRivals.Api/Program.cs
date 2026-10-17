using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using PastimeRivals.Api;
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

// Single-page app: unknown non-API paths serve index.html.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program { }
