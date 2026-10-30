using resonance.Core;

public class SiteReadinessTests
{
    private static StartupServiceState Service(string id, string state) => new(id, id, state, "private diagnostic detail", DateTime.UtcNow, null);

    [Fact]
    public void EmptyOrPartiallyRegisteredStartupIsNotReady()
    {
        Assert.Equal(new SiteReadiness(false, "starting"), SiteReadiness.Evaluate([], false));
        Assert.False(SiteReadiness.Evaluate([Service("core", "ready")], false).Ready);
        Assert.False(SiteReadiness.Evaluate([Service("database-tracks", "ready")], false).Ready);
    }

    [Theory]
    [InlineData("core")]
    [InlineData("database-tracks")]
    public void RequiredServicesMustFinishAndCannotFail(string id)
    {
        var services = new[] { Service("core", "ready"), Service("database-tracks", "ready"), Service(id, "starting") };
        Assert.Equal("starting", SiteReadiness.Evaluate(services, false).State);
        Assert.Equal("unavailable", SiteReadiness.Evaluate(services.Append(Service(id, "failed")), false).State);
    }

    [Fact]
    public void BackgroundWorkDoesNotBlockTheSite()
    {
        var services = new[] { Service("core", "ready"), Service("database-tracks", "ready"), Service("shares", "starting"), Service("ffmpeg", "starting") };
        Assert.Equal(new SiteReadiness(true, "available"), SiteReadiness.Evaluate(services, false));
        Assert.Equal(new SiteReadiness(true, "degraded"), SiteReadiness.Evaluate(services.Append(Service("ytdlp", "failed")), false));
    }

    [Fact]
    public void ShutdownTakesPrecedenceOverPreviousReadiness()
    {
        Assert.Equal(new SiteReadiness(false, "restarting"), SiteReadiness.Evaluate([Service("core", "ready"), Service("database-tracks", "ready")], true));
    }
}
