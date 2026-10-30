namespace Resonance.Tests.Transfers;

using global::resonance.Transfers.Uploads;

public sealed class UploadPeerCooldownTests
{
    [Fact]
    public async Task ThreeFailuresPauseOnlyThatPeerAndExpiryAllowsOneProbe()
    {
        var clock = new ManualUploadClock();
        var cooldown = new UploadPeerCooldown(clock);
        await Open(cooldown);
        var probeTask = cooldown.EnterAsync("alice", CancellationToken.None);
        Assert.Equal(TimeSpan.FromMinutes(5), await clock.NextDelay());
        var followingTask = cooldown.EnterAsync("alice", CancellationToken.None);
        using (await cooldown.EnterAsync("bob", CancellationToken.None)) { }
        Assert.False(probeTask.IsCompleted);
        Assert.False(followingTask.IsCompleted);
        clock.Advance(TimeSpan.FromMinutes(5));
        using (var probe = await probeTask.WaitAsync(TimeSpan.FromSeconds(5)))
        {
            Assert.False(followingTask.IsCompleted);
            probe.RecordSuccess();
        }

        using (await followingTask.WaitAsync(TimeSpan.FromSeconds(5))) { }
    }

    [Fact]
    public async Task FailedProbeReopensCooldownImmediately()
    {
        var clock = new ManualUploadClock();
        var cooldown = new UploadPeerCooldown(clock);
        await Open(cooldown);
        var probe = cooldown.EnterAsync("alice", CancellationToken.None);
        await clock.NextDelay();
        clock.Advance(TimeSpan.FromMinutes(5));
        using (var lease = await probe)
        {
            Assert.Equal(clock.GetUtcNow().AddMinutes(5), lease.RecordConnectionFailure());
        }

        using var cancellation = new CancellationTokenSource();
        var next = cooldown.EnterAsync("alice", cancellation.Token);
        Assert.Equal(TimeSpan.FromMinutes(5), await clock.NextDelay());
        Assert.False(next.IsCompleted);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => next);
    }

    [Fact]
    public async Task SuccessResetsStreakAndOldFailuresExpire()
    {
        var clock = new ManualUploadClock();
        var cooldown = new UploadPeerCooldown(clock);
        for (var i = 0; i < 2; i++)
        {
            using var lease = await cooldown.EnterAsync("alice", CancellationToken.None);
            Assert.Null(lease.RecordConnectionFailure());
        }

        using (var success = await cooldown.EnterAsync("alice", CancellationToken.None)) { success.RecordSuccess(); }
        using (var next = await cooldown.EnterAsync("alice", CancellationToken.None)) { Assert.Null(next.RecordConnectionFailure()); }
        clock.Advance(TimeSpan.FromMinutes(5));
        using (var next = await cooldown.EnterAsync("alice", CancellationToken.None)) { Assert.Null(next.RecordConnectionFailure()); }
        using (var next = await cooldown.EnterAsync("alice", CancellationToken.None)) { Assert.Null(next.RecordConnectionFailure()); }
    }

    [Fact]
    public async Task CancellationInterruptsCooldownWithoutUnlockingAnotherLease()
    {
        var clock = new ManualUploadClock();
        var cooldown = new UploadPeerCooldown(clock);
        await Open(cooldown);
        using var cancellation = new CancellationTokenSource();
        var cancelled = cooldown.EnterAsync("alice", cancellation.Token);
        await clock.NextDelay();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
        var active = cooldown.EnterAsync("alice", CancellationToken.None);
        await clock.NextDelay();
        clock.Advance(TimeSpan.FromMinutes(5));
        using var lease = await active;
        using var waitingCancellation = new CancellationTokenSource();
        var waiting = cooldown.EnterAsync("alice", waitingCancellation.Token);
        waitingCancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);
        var following = cooldown.EnterAsync("alice", CancellationToken.None);
        Assert.False(following.IsCompleted);
        lease.RecordSuccess();
        lease.Dispose();
        lease.Dispose();
        using (await following.WaitAsync(TimeSpan.FromSeconds(5))) { }
    }

    private static async Task Open(UploadPeerCooldown cooldown)
    {
        for (var i = 0; i < 3; i++)
        {
            using var lease = await cooldown.EnterAsync("alice", CancellationToken.None);
            var retry = lease.RecordConnectionFailure();
            Assert.Equal(i == 2, retry.HasValue);
        }
    }
}
