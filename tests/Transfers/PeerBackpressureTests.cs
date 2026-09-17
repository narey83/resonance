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

    private static PeerBackpressure Subject(int giveUpAfter = 5, int maxActive = 50) =>
        new(giveUpAfter, TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(5), maxActive);

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
    public void The_Hold_Doubles_With_Each_Consecutive_Round()
    {
        var peers = Subject(giveUpAfter: 10);

        // each round is a refusal arriving after the previous hold expired
        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out var second);
        peers.Refused("alice", second.AddSeconds(1), out var third);

        Assert.Equal(Now.AddSeconds(30), first);
        Assert.Equal(second, first.AddSeconds(61));
        Assert.Equal(third, second.AddSeconds(121));
    }

    [Fact]
    public void The_Hold_Is_Capped()
    {
        var peers = Subject(giveUpAfter: 100);

        var at = Now;
        var lastHold = TimeSpan.Zero;

        for (var i = 0; i < 20; i++)
        {
            peers.Refused("alice", at, out var until);
            lastHold = until - at;
            at = until.AddSeconds(1);
        }

        Assert.Equal(TimeSpan.FromMinutes(5), lastHold);
    }

    // The bug this class was shipped with: fifty files active with a peer are all refused in the same
    // instant, so counting each one spent the entire allowance in 0.6 seconds and gave up having never
    // actually waited or retried. A round is "we asked and were refused", not "a file was refused".
    [Fact]
    public void Refusals_Arriving_During_A_Hold_Are_The_Same_Round()
    {
        var peers = Subject(giveUpAfter: 5);

        Assert.True(peers.Refused("alice", Now, out var until));

        // the other 49 files active with this peer, refused in the same instant
        for (var i = 0; i < 49; i++)
        {
            Assert.True(peers.Refused("alice", Now, out var repeat));
            Assert.Equal(until, repeat);
        }

        Assert.Equal(1, peers.RefusalCount("alice"));
        Assert.False(peers.HasGivenUp("alice"));
    }

    [Fact]
    public void Each_Refused_Round_Halves_How_Many_Files_We_Ask_For()
    {
        var peers = Subject(giveUpAfter: 100, maxActive: 50);

        Assert.Equal(50, peers.ActiveLimit("alice"));

        var at = Now;
        var seen = new System.Collections.Generic.List<int>();

        for (var i = 0; i < 7; i++)
        {
            peers.Refused("alice", at, out var until);
            seen.Add(peers.ActiveLimit("alice"));
            at = until.AddSeconds(1);
        }

        Assert.Equal(new[] { 25, 12, 6, 3, 1, 1, 1 }, seen);
    }

    [Fact]
    public void A_Deliberate_Retry_Keeps_What_We_Learned_About_The_Batch_Size()
    {
        var peers = Subject(giveUpAfter: 2, maxActive: 50);

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out _);

        Assert.True(peers.HasGivenUp("alice"));
        Assert.Equal(12, peers.ActiveLimit("alice"));

        peers.Clear("alice");

        // released, but we do not go back to asking for fifty -- it just refused that
        Assert.False(peers.HasGivenUp("alice"));
        Assert.Equal(12, peers.ActiveLimit("alice"));
    }

    [Fact]
    public void A_Success_Restores_The_Full_Batch_Size()
    {
        var peers = Subject(giveUpAfter: 100, maxActive: 50);

        peers.Refused("alice", Now, out _);
        Assert.Equal(25, peers.ActiveLimit("alice"));

        peers.Succeeded("alice");

        Assert.Equal(50, peers.ActiveLimit("alice"));
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

        Assert.True(peers.Refused("alice", Now, out var first));
        Assert.True(peers.Refused("alice", first.AddSeconds(1), out var second));

        // the third round reaches the limit
        Assert.False(peers.Refused("alice", second.AddSeconds(1), out _));
        Assert.True(peers.HasGivenUp("alice"));
    }

    [Fact]
    public void A_Peer_Given_Up_On_Stays_Held_So_Nothing_Is_Activated_For_It()
    {
        var peers = Subject(giveUpAfter: 2);

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out _);

        // far in the future: a plain expiry must not let the queue start draining again
        Assert.True(peers.IsHeld("alice", Now.AddDays(1), out _));
    }

    [Fact]
    public void A_Success_Clears_The_Backpressure()
    {
        var peers = Subject(giveUpAfter: 3);

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out _);
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

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out _);
        Assert.True(peers.HasGivenUp("alice"));

        peers.Clear("alice");

        Assert.False(peers.HasGivenUp("alice"));
        Assert.False(peers.IsHeld("alice", Now, out _));
    }

    [Fact]
    public void Peers_Are_Tracked_Independently()
    {
        var peers = Subject(giveUpAfter: 2);

        peers.Refused("alice", Now, out var first);
        peers.Refused("alice", first.AddSeconds(1), out _);

        Assert.True(peers.HasGivenUp("alice"));
        Assert.False(peers.IsHeld("bob", Now, out _));
    }
}
