namespace Resonance.Tests.Core;

using global::resonance;
using Soulseek;

// The monitor forces a reconnect when the client sits in a transitional state with no watchdog
// running. Which states count is the whole safety question: Disconnected is where a client that
// is *meant* to be offline rests (a user disconnect, a rejected login, a genuine duplicate-login
// kick all deliberately leave the watchdog stopped), so treating it as stuck would reconnect
// against the user's intent. The transitional states have nothing driving them forward.
public class ServerConnectionMonitorTests
{
    [Fact]
    public void Disconnected_Is_Not_A_Transition()
    {
        Assert.Null(ServerConnectionMonitor.DescribeTransition(SoulseekClientStates.Disconnected));
    }

    [Fact]
    public void Fully_Online_Is_Not_A_Transition()
    {
        var online = SoulseekClientStates.Connected | SoulseekClientStates.LoggedIn;

        Assert.Null(ServerConnectionMonitor.DescribeTransition(online));
    }

    [Theory]
    [InlineData(SoulseekClientStates.Disconnecting, "Disconnecting")]
    [InlineData(SoulseekClientStates.Connecting, "Connecting")]
    [InlineData(SoulseekClientStates.LoggingIn, "LoggingIn")]
    public void Transitional_States_Are_Named(SoulseekClientStates state, string expected)
    {
        Assert.Equal(expected, ServerConnectionMonitor.DescribeTransition(state));
    }

    // The 2026-09-17 outage: the client reported Connected and LoggedIn *and* Disconnecting at
    // once while the teardown stalled. The disconnecting half is what matters — the connection
    // was already unusable, and every request that needed it failed for 11.5 minutes.
    [Fact]
    public void Disconnecting_Wins_Over_A_Stale_Connected_Flag()
    {
        var tearingDown = SoulseekClientStates.Connected
            | SoulseekClientStates.LoggedIn
            | SoulseekClientStates.Disconnecting;

        Assert.Equal("Disconnecting", ServerConnectionMonitor.DescribeTransition(tearingDown));
    }
}
