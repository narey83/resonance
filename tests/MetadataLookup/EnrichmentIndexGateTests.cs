namespace Resonance.Tests.MetadataLookup;

using global::resonance;
using global::resonance.MetadataLookup;

public class EnrichmentIndexGateTests
{
    [Fact]
    public async Task WaitsForIndexAndResumesSameWorkWhenReady()
    {
        var state = new ShareState { Ready = true, Scanning = true };
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var gate = new EnrichmentIndexGate(() => state, async ct =>
        {
            entered.TrySetResult();
            await release.Task.WaitAsync(ct);
        });
        var work = gate.WaitAsync(CancellationToken.None);
        await entered.Task;
        Assert.False(work.IsCompleted);
        state = state with { Scanning = false };
        release.SetResult();
        await work;
        Assert.False(gate.Blocked);
    }

    [Theory]
    [InlineData(false, false, false)]
    [InlineData(true, true, false)]
    [InlineData(true, false, true)]
    public async Task StopCancelsEvenWhileWaitingForInitialOrPendingIndex(bool ready, bool scanning, bool pending)
    {
        var state = new ShareState { Ready = ready, Scanning = scanning, ScanPending = pending };
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var gate = new EnrichmentIndexGate(() => state, ct =>
        {
            entered.TrySetResult();
            return Task.Delay(Timeout.Infinite, ct);
        });
        using var cancellation = new CancellationTokenSource();
        var work = gate.WaitAsync(cancellation.Token);
        await entered.Task;
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => work);
    }

    [Fact]
    public async Task GateIsRecheckedWhenAnotherScanStarts()
    {
        var state = new ShareState { Ready = true };
        var gate = new EnrichmentIndexGate(() => state);
        await gate.WaitAsync(CancellationToken.None);
        state = state with { Scanning = true };
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        Assert.True(gate.Blocked);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => gate.WaitAsync(cancellation.Token));
    }
}
