using PastimeRivals.Engine;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok", engineVersion = EngineInfo.Version }));

app.Run();

public partial class Program { }
