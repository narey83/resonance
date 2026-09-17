namespace Resonance.Tests.Transfers;

using System;
using PeerBackpressure = global::resonance.Transfers.Downloads.PeerBackpressure;

/// <summary>
///     Covers the per-peer response to a queue-level refusal ("too many files", "queue full").
/// </summary>
/// <remarks>
///     The behaviour that matters is that one refusal holds the whole peer rather than one file, that a
///     peer refusing everything is eventually left alone instead of retried forever, and that a peer
///     which then completes a transfer — or is asked for files deliberately — starts clean again.
/// </remarks>
public class PeerBackpressureTests
{
    private static readonly DateTime Now = new(2026, 9, 17, 12, 0, 0, DateTimeKind.Utc);

    private static PeerBackpressure Subject(int giveUpAfter = 5) =>
        new(giveUpAfter, TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(5));

    [Fact]
    public void An_Unknown_Peer_Is_Not_Held()
    {
        var peers = Subject();

        Assert.False(peers.IsHeld("alice", Now, out _));
        Assert.False(peers.HasGivenUp("alice"));
        Assert.Equal(0, peers.RefusalCount("alice"));
    }

    [Fact]
    public void A_Refusal_Holds_The_Peer_For_The_Base_Delay()
    {
        var peers = Subject();

        Assert.True(peers.Refused("alice", Now, out var until));
        Assert.Equal(Now.AddSeconds(30), until);
        Assert.True(peers.IsHeld("alice", Now, out _));
    }

    [Fact]
    public void The_Hold_Doubles_With_Each_Consecutive_Refusal()
    {
        var peers = Subject(giveUpAfter: 10);

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", Now, out var second);
        peers.Refused("alice", Now, out var third);

        Assert.Equal(Now.AddSeconds(30), first);
        Assert.Equal(Now.AddSeconds(60), second);
        Assert.Equal(Now.AddSeconds(120), third);
    }

    [Fact]
    public void The_Hold_Is_Capped()
    {
        var peers = Subject(giveUpAfter: 100);

        DateTime until = default;
        for (var i = 0; i < 20; i++)
        {
            peers.Refused("alice", Now, out until);
        }

        Assert.Equal(Now.AddMinutes(5), until);
    }

    [Fact]
    public void The_Hold_Expires()
    {
        var peers = Subject();
        peers.Refused("alice", Now, out var until);

        Assert.True(peers.IsHeld("alice", until.AddSeconds(-1), out _));
        Assert.False(peers.IsHeld("alice", until.AddSeconds(1), out _));
    }

    [Fact]
    public void A_Peer_That_Keeps_Refusing_Is_Given_Up_On()
    {
        var peers = Subject(giveUpAfter: 3);

        Assert.True(peers.Refused("alice", Now, out _));
        Assert.True(peers.Refused("alice", Now, out _));

        // the third refusal reaches the limit
        Assert.False(peers.Refused("alice", Now, out _));
        Assert.True(peers.HasGivenUp("alice"));
    }

    [Fact]
    public void A_Peer_Given_Up_On_Stays_Held_So_Nothing_Is_Activated_For_It()
    {
        var peers = Subject(giveUpAfter: 2);

        peers.Refused("alice", Now, out _);
        peers.Refused("alice", Now, out _);

        // far in the future: a plain expiry must not let the queue start draining again
        Assert.True(peers.IsHeld("alice", Now.AddDays(1), out _));
    }

    [Fact]
    public void A_Success_Clears_The_Backpressure()
    {
        var peers = Subject(giveUpAfter: 3);

        peers.Refused("alice", Now, out _);
        peers.Refused("alice", Now, out _);
        peers.Succeeded("alice");

        Assert.False(peers.IsHeld("alice", Now, out _));
        Assert.Equal(0, peers.RefusalCount("alice"));

        // and the count restarts, rather than resuming where it left off
        Assert.True(peers.Refused("alice", Now, out var until));
        Assert.Equal(Now.AddSeconds(30), until);
    }

    [Fact]
    public void Clearing_Revives_A_Peer_That_Was_Given_Up_On()
    {
        var peers = Subject(giveUpAfter: 2);

        peers.Refused("alice", Now, out _);
        peers.Refused("alice", Now, out _);
        Assert.True(peers.HasGivenUp("alice"));

        peers.Clear("alice");

        Assert.False(peers.HasGivenUp("alice"));
        Assert.False(peers.IsHeld("alice", Now, out _));
    }

    [Fact]
    public void Peers_Are_Tracked_Independently()
    {
        var peers = Subject(giveUpAfter: 2);

        peers.Refused("alice", Now, out _);
        peers.Refused("alice", Now, out _);

        Assert.True(peers.HasGivenUp("alice"));
        Assert.False(peers.IsHeld("bob", Now, out _));
    }
}
