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

    [Theory]
    [InlineData("pastimerivals.com", "Disallow: /api/")]
    [InlineData("www.pastimerivals.com", "Disallow: /api/")]
    [InlineData("staging.example.net", "Disallow: /\n")]
    public async Task Robots_txt_opens_only_the_live_domain(string host, string expected)
    {
        var client = _factory.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Get, "/robots.txt");
        req.Headers.Host = host;
        var response = await client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/plain", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(expected, body);
        Assert.DoesNotContain("/c/", body);   // challenge links stay open for link-preview bots
        if (expected.Contains("api")) Assert.Contains("Sitemap: https://pastimerivals.com/sitemap.xml", body);
    }
}
