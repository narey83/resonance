namespace Resonance.Tests.Analysis;

using System.Diagnostics;
using global::resonance.Analysis;

public sealed class BackgroundAnalysisWorkTests
{
    [Fact]
    public async Task CpuWorkUsesDedicatedLowPriorityThreadWithoutChangingCaller()
    {
        var callerThread = Thread.CurrentThread;
        var callerIsPool = callerThread.IsThreadPoolThread;
        var callerPriority = callerThread.Priority;
        var result = await BackgroundAnalysisWork.RunCpuAsync(() =>
        {
            Assert.False(Thread.CurrentThread.IsThreadPoolThread);
            if (OperatingSystem.IsLinux())
            {
                var stat = File.ReadAllText("/proc/thread-self/stat");
                var fields = stat[(stat.LastIndexOf(')') + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                Assert.True(int.Parse(fields[16]) >= 10);
            }
            return 42;
        }, default);
        Assert.Equal(42, result);
        Assert.Equal(callerIsPool, callerThread.IsThreadPoolThread);
        Assert.Equal(callerPriority, callerThread.Priority);
    }

    [Fact]
    public async Task CancelledCpuWorkNeverStartsAndFailuresReachCaller()
    {
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var called = false;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => BackgroundAnalysisWork.RunCpuAsync(() => called = true, cancelled.Token));
        Assert.False(called);
        await Assert.ThrowsAsync<InvalidDataException>(() => BackgroundAnalysisWork.RunCpuAsync<int>(() => throw new InvalidDataException("bad samples"), default));
    }

    [Fact]
    public async Task ChildProcessHasLowerPriorityThanBackend()
    {
        if (!OperatingSystem.IsLinux()) return;
        using var backend = Process.GetCurrentProcess();
        var priority = backend.PriorityClass;
        using var child = new Process { StartInfo = new("/bin/sleep", "30") { UseShellExecute = false } };
        try
        {
            BackgroundAnalysisWork.Start(child);
            Assert.Equal(ProcessPriorityClass.BelowNormal, child.PriorityClass);
            Assert.Equal(priority, backend.PriorityClass);
        }
        finally
        {
            if (!child.HasExited) child.Kill();
            await child.WaitForExitAsync();
        }
    }
}
