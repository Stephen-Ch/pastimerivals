using Microsoft.AspNetCore.Mvc.Testing;

namespace PastimeRivals.Api.Tests;

public class HttpsTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public HttpsTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task Live_domain_over_https_gets_hsts()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://pastimerivals.com") });
        var r = await client.GetAsync("/api/health");
        Assert.True(r.Headers.TryGetValues("Strict-Transport-Security", out var v));
        Assert.Equal("max-age=31536000", v!.Single());
    }

    [Fact]
    public async Task Other_hosts_get_no_hsts()
    {
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://lessonwriter-001-site12.ltempurl.com") });
        var r = await client.GetAsync("/api/health");
        Assert.False(r.Headers.Contains("Strict-Transport-Security"));
    }
}
