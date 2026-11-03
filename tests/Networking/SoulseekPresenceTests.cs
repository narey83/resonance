namespace Resonance.Tests.Networking;

using resonance.Core;
using Soulseek;

public class SoulseekPresenceTests
{
    [Theory]
    [InlineData(false, 899, UserPresence.Online)]
    [InlineData(false, 900, UserPresence.Away)]
    [InlineData(true, 0, UserPresence.Away)]
    public void PresenceFollowsIdleTimeoutUnlessManuallyAway(bool manuallyAway, int idleSeconds, UserPresence expected)
    {
        Assert.Equal(expected, SoulseekPresenceService.DesiredPresence(manuallyAway, TimeSpan.FromSeconds(idleSeconds)));
    }
}
