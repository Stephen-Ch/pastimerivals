using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using PastimeRivals.Engine;

namespace PastimeRivals.Api.Tests;

public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public HealthEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    private record Health(string Status, string EngineVersion);

    [Fact]
    public async Task Health_returns_ok_and_engine_version()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<Health>();
        Assert.NotNull(body);
        Assert.Equal("ok", body!.Status);
        Assert.Equal(EngineInfo.Version, body.EngineVersion);
    }
}
