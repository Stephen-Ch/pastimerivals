using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PastimeRivals.Api.Challenges;
using PastimeRivals.Api.Stats;
using Xunit;

namespace PastimeRivals.Api.Tests;

/// <summary>Plan 50: announcer clips are immutable, the voice manifest is always re-checked, missing clips are 404 (never the app page).</summary>
public class Plan50Tests
{
    private static WebApplicationFactory<Program> Factory() =>
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

    [Fact]
    public async Task Audio_is_immutable_mp3_and_missing_audio_is_404()
    {
        var f = Factory();
        var root = f.Services.GetRequiredService<IWebHostEnvironment>().WebRootPath;
        var dir = Path.Combine(root, "audio", "_test");
        Directory.CreateDirectory(dir);
        var file = Path.Combine(dir, "t.0000abcd.mp3");
        await File.WriteAllBytesAsync(file, new byte[] { 0xFF, 0xF3, 0x44, 0xC4 });
        try
        {
            var c = f.CreateClient();
            var r = await c.GetAsync("/audio/_test/t.0000abcd.mp3");
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
            Assert.Equal("audio/mpeg", r.Content.Headers.ContentType?.MediaType);
            Assert.True(r.Headers.CacheControl?.Public == true && r.Headers.CacheControl?.MaxAge == TimeSpan.FromDays(365), $"{r.Headers.CacheControl}");
            Assert.Contains("immutable", r.Headers.CacheControl!.ToString());
            var miss = await c.GetAsync("/audio/_test/missing.0000abcd.mp3");
            Assert.Equal(HttpStatusCode.NotFound, miss.StatusCode);
        }
        finally { File.Delete(file); Directory.Delete(dir); }
    }

    [Fact]
    public async Task Voice_manifest_is_always_rechecked()
    {
        var r = await Factory().CreateClient().GetAsync("/voice-manifest.json");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.True(r.Headers.CacheControl?.NoCache == true, $"{r.Headers.CacheControl}");
        Assert.Equal("application/json", r.Content.Headers.ContentType?.MediaType);
    }
}
