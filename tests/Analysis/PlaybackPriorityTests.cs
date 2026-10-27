namespace Resonance.Tests.Analysis;

using Microsoft.AspNetCore.Authorization;
using resonance;
using resonance.MusicLibrary.Workspace;
using resonance.MusicLibrary.API;

public class PlaybackPriorityTests
{
    [Fact]
    public void ContinuousPlaybackAllowsOnlyOnePreparationJobEveryTwoMinutes()
    {
        var gate = new PlaybackPreparationGate();
        Assert.True(gate.ShouldWait(true, 1000));
        Assert.True(gate.ShouldWait(true, 120999));
        Assert.False(gate.ShouldWait(true, 121000));
        Assert.True(gate.ShouldWait(true, 121001));
        Assert.False(gate.ShouldWait(true, 241000));
    }

    [Fact]
    public void IdlePlaybackResumesImmediatelyAndNextSessionGetsPriority()
    {
        var gate = new PlaybackPreparationGate();
        Assert.True(gate.ShouldWait(true, 1000));
        Assert.False(gate.ShouldWait(false, 2000));
        Assert.True(gate.ShouldWait(true, 500000));
    }

    [Fact]
    public void ActivityEndpointCannotUseAnonymousSignedMediaAccess()
    {
        var method = typeof(MusicLibraryController).GetMethod(nameof(MusicLibraryController.PlaybackActivity))!;
        Assert.Empty(method.GetCustomAttributes(typeof(AllowAnonymousAttribute), true));
        var auth = Assert.Single(method.GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>());
        Assert.Equal(AuthPolicy.Any, auth.Policy);
    }
}
