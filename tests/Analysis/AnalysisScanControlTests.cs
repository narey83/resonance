namespace Resonance.Tests.Analysis;

using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance;
using resonance.Analysis;
using resonance.Analysis.API;

public sealed class AnalysisScanControlTests
{
    [Fact]
    public async Task PauseFinishesAdmittedWorkAndResumeUsesTheSameQueue()
    {
        using var control = new AnalysisScanControl();
        var started = new List<int>();
        var current = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        await control.AdmitAsync(() => started.Add(1), CancellationToken.None);
        Assert.True(control.Pause());
        var next = control.AdmitAsync(() => started.Add(2), CancellationToken.None);
        Assert.False(next.IsCompleted);
        Assert.False(control.EndToken.IsCancellationRequested);
        current.SetResult(true);
        await current.Task;
        Assert.Equal([1], started);
        Assert.True(control.Resume());
        await next.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal([1, 2], started);
    }

    [Fact]
    public async Task EndDoesNotCancelAdmittedTrackWork()
    {
        using var control = new AnalysisScanControl();
        using var activeCancellation = new CancellationTokenSource();
        using var dispatchCancellation = CancellationTokenSource.CreateLinkedTokenSource(activeCancellation.Token, control.EndToken);
        var complete = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        await control.AdmitAsync(() => { }, dispatchCancellation.Token);
        var activeWork = complete.Task.WaitAsync(activeCancellation.Token);
        Assert.True(control.End());
        Assert.True(dispatchCancellation.IsCancellationRequested);
        Assert.False(activeCancellation.IsCancellationRequested);
        Assert.False(activeWork.IsCompleted);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => control.AdmitAsync(() => Assert.Fail("Queued work started after End"), dispatchCancellation.Token));
        complete.SetResult(true);
        Assert.True(await activeWork);
    }

    [Fact]
    public async Task EndReleasesPausedWorkersWithoutStartingQueuedTracks()
    {
        using var control = new AnalysisScanControl();
        Assert.True(control.Pause());
        var started = false;
        var next = control.AdmitAsync(() => started = true, CancellationToken.None);
        Assert.True(control.End());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => next.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.False(started);
        Assert.True(control.EndToken.IsCancellationRequested);
        Assert.False(control.Resume());
        Assert.False(control.Pause());
    }

    [Fact]
    public async Task PauseAndAdmissionAreAtomic()
    {
        using var control = new AnalysisScanControl();
        using var entered = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();
        var first = Task.Run(() => control.AdmitAsync(() => { entered.Set();Assert.True(release.Wait(TimeSpan.FromSeconds(5))); }, CancellationToken.None));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        var pause = Task.Run(control.Pause);
        release.Set();
        await first.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(await pause.WaitAsync(TimeSpan.FromSeconds(5)));
        var second = control.AdmitAsync(() => { }, CancellationToken.None);
        Assert.False(second.IsCompleted);
        control.Resume();
        await second.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task CallerCancellationAndDisposalReleaseWaiters()
    {
        var control = new AnalysisScanControl();
        using var cancellation = new CancellationTokenSource();
        control.Pause();
        var cancelled = control.AdmitAsync(() => { }, cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => cancelled);
        Assert.False(control.EndToken.IsCancellationRequested);
        var disposed = control.AdmitAsync(() => { }, CancellationToken.None);
        control.Dispose();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => disposed.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.False(control.Resume());
        Assert.False(control.End());
        control.Dispose();
    }

    [Fact]
    public void ServiceReportsPausingPausedAndEndingAcrossClients()
    {
        var service = new AnalysisService(null!, null!, null!, null!);
        Assert.True(service.ScanState.SupportsPause);
        Assert.False(service.PauseScan());
        Assert.False(service.ResumeScan());
        Assert.False(service.EndScan());
        using var control = new AnalysisScanControl();
        typeof(AnalysisService).GetProperty("ScanControl", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(service, control);
        var stateProperty = typeof(AnalysisService).GetProperty("CurrentState", BindingFlags.Instance | BindingFlags.NonPublic)!;
        stateProperty.SetValue(service, new AnalysisScanState(true, false, false, 100, 10, 0, 0, 0.1, 2));
        Assert.True(service.PauseScan());
        Assert.True(service.ScanState.PauseRequested);
        Assert.False(service.ScanState.Paused);
        stateProperty.SetValue(service, new AnalysisScanState(true, false, false, 100, 12, 0, 0, 0.12));
        Assert.True(service.ScanState.Paused);
        Assert.True(service.ResumeScan());
        Assert.False(service.ScanState.PauseRequested);
        Assert.True(service.EndScan());
        Assert.True(service.ScanState.Ending);
        Assert.False(service.ResumeScan());
    }

    [Theory]
    [InlineData(nameof(AnalysisController.PauseScan), true, 204)]
    [InlineData(nameof(AnalysisController.PauseScan), false, 404)]
    [InlineData(nameof(AnalysisController.ResumeScan), true, 204)]
    [InlineData(nameof(AnalysisController.ResumeScan), false, 404)]
    [InlineData(nameof(AnalysisController.EndScan), true, 204)]
    [InlineData(nameof(AnalysisController.EndScan), false, 404)]
    public void EndpointsDispatchToTheMatchingQueueControl(string method, bool accepted, int status)
    {
        var service = DispatchProxy.Create<IAnalysisService, ControlProxy>();
        var proxy = (ControlProxy)(object)service;
        proxy.Accepted = accepted;
        var controller = new AnalysisController(service);
        var result = typeof(AnalysisController).GetMethod(method)!.Invoke(controller, null);
        Assert.Equal(method, proxy.Called);
        Assert.Equal(status, Assert.IsAssignableFrom<Microsoft.AspNetCore.Mvc.Infrastructure.IStatusCodeActionResult>(result).StatusCode);
    }

    [Theory]
    [InlineData(nameof(AnalysisController.PauseScan))]
    [InlineData(nameof(AnalysisController.ResumeScan))]
    [InlineData(nameof(AnalysisController.EndScan))]
    public void ControlsRequireWriteRoleAndAreSeparateFromImmediateCancellation(string name)
    {
        var method = typeof(AnalysisController).GetMethod(name)!;
        var auth = Assert.Single(method.GetCustomAttributes<AuthorizeAttribute>());
        Assert.Equal(AuthPolicy.Any, auth.Policy);
        Assert.Equal(AuthRole.ReadWriteOrAdministrator, auth.Roles);
        Assert.NotNull(method.GetCustomAttribute<HttpPostAttribute>());
    }
    public class ControlProxy : DispatchProxy
    {
        public bool Accepted { get; set; }
        public string? Called { get; private set; }
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            Called = targetMethod!.Name;
            return Accepted;
        }
    }

}
