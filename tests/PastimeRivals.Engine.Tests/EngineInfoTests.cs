using PastimeRivals.Engine;

namespace PastimeRivals.Engine.Tests;

public class EngineInfoTests
{
    [Fact]
    public void Version_is_semantic_version()
    {
        Assert.Matches(@"^\d+\.\d+\.\d+$", EngineInfo.Version);
    }
}
