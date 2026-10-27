namespace Resonance.Tests.Transfers;

using global::resonance.Transfers.Uploads;

public sealed class UploadWorkLifetimeTests
{
    [Fact]
    public async Task StopCancelsWorkButWaitsForCleanupAndCallbacks()
    {
        var lifetime = new UploadWorkLifetime();
        var work = lifetime.Enter();
        var callback = lifetime.Enter();
        var stopped = lifetime.StopAsync();
        Assert.True(lifetime.Token.IsCancellationRequested);
        Assert.Null(lifetime.TryEnter());
        Assert.Throws<OperationCanceledException>(() => lifetime.Enter());
        Assert.False(stopped.IsCompleted);
        work.Dispose();
        work.Dispose(); // Repeated release must not drain another callback's lease.
        Assert.False(stopped.IsCompleted);
        callback.Dispose();
        await stopped.WaitAsync(TimeSpan.FromSeconds(5));
        await lifetime.StopAsync();
    }

    [Fact]
    public async Task ScheduledWorkIsReservedBeforeExecution()
    {
        var lifetime = new UploadWorkLifetime();
        var lease = lifetime.Enter();
        var run = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = Task.Run(async () =>
        {
            using (lease) { await run.Task; }
        });
        var stopped = lifetime.StopAsync();
        Assert.False(stopped.IsCompleted);
        run.SetResult();
        await worker;
        await stopped.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task ShutdownDoesNotDisposeDependenciesUntilCancelledTaskFinallyExits()
    {
        var lifetime = new UploadWorkLifetime();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var cleanup = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var disposed = false;
        var worker = Task.Run(async () =>
        {
            using var work = lifetime.Enter();
            started.SetResult();
            try { await Task.Delay(Timeout.Infinite, lifetime.Token); }
            catch (OperationCanceledException) { }
            finally
            {
                cleanup.SetResult();
                await release.Task;
                Assert.False(disposed);
            }
        });
        await started.Task;
        var stopped = lifetime.StopAsync();
        await cleanup.Task;
        Assert.False(stopped.IsCompleted);
        release.SetResult();
        await stopped.WaitAsync(TimeSpan.FromSeconds(5));
        disposed = true;
        await worker;
    }

    [Fact]
    public async Task EmptyLifetimeStopsImmediatelyAndRejectsFutureWork()
    {
        var lifetime = new UploadWorkLifetime();
        await lifetime.StopAsync().WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Null(lifetime.TryEnter());
    }
}
