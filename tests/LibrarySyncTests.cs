namespace Resonance.Tests;

using System.Reflection;
using Microsoft.AspNetCore.SignalR;
using global::resonance;
using global::resonance.Common;
using global::resonance.MusicLibrary;
using global::resonance.MusicLibrary.Activity;
using global::resonance.MusicLibrary.API;

[Collection("Music path configuration")]
public sealed class LibrarySyncTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string root = Path.Combine(Path.GetTempPath(), "resonance-sync-" + Guid.NewGuid().ToString("N"));
    private readonly MusicRepository repository;
    private readonly MusicLibraryService service;
    private readonly List<MusicLibrarySyncState> broadcasts = new();

    public LibrarySyncTests()
    {
        Directory.CreateDirectory(root);
        MusicPath.Configure(root);
        repository = new MusicRepository($"Data Source={Path.Combine(root, "test.db")};Pooling=False", false);
        repository.Initialize();
        var client = Stub<IClientProxy>((_, args) =>
        {
            if (args![1] is object[] values && values.FirstOrDefault() is MusicLibrarySyncState state)
                broadcasts.Add(state);
            return Task.CompletedTask;
        });
        var clients = Stub<IHubClients>((_, _) => client);
        var hub = Stub<IHubContext<LibraryActivityHub>>((_, _) => clients);
        var activity = Stub<ILibraryActivityService>((_, _) => Task.CompletedTask);
        service = new MusicLibraryService(new OptionsAtStartup { Shares = new() { Directories = [root] } }, repository, null!, hub, activity);
    }

    private string Wave(string name)
    {
        var path = Path.Combine(root, name);
        using var writer = new BinaryWriter(File.Create(path));
        writer.Write("RIFF"u8.ToArray()); writer.Write(36 + 8820); writer.Write("WAVEfmt "u8.ToArray());
        writer.Write(16); writer.Write((short)1); writer.Write((short)1); writer.Write(44100); writer.Write(88200);
        writer.Write((short)2); writer.Write((short)16); writer.Write("data"u8.ToArray()); writer.Write(8820); writer.Write(new byte[8820]);
        return path;
    }

    private object? Call(string name, params object[] args) => typeof(MusicLibraryService).GetMethod(name, BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(service, args);
    private Task Sync() => (Task)Call("RunSyncAsync", CancellationToken.None)!;
    private void Changed(string path) => Call("NoteFsChange", path);

    [Fact]
    public async Task AnalysisCompletionAndLateWatcherEventsDoNotBroadcastAFullScan()
    {
        var path = Wave("track.wav");
        await Sync(); broadcasts.Clear();
        service.RegisterQueue("analysis");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddSeconds(2));
        Changed(path);
        Assert.True(service.RefreshTrack(path));
        service.DeregisterQueue("analysis");
        await Sync();
        Assert.Empty(broadcasts);
        Changed(path); // A delayed notification for the same already-indexed write.
        await Sync();
        Assert.Empty(broadcasts);
        Assert.Equal(new FileInfo(path).LastWriteTimeUtc.Ticks, repository.GetByPath(path)!.FileModified);
    }

    [Fact]
    public async Task KnownFileChangesRefreshTheirRowWithoutAScanningBanner()
    {
        var path = Wave("track.wav");
        await Sync(); broadcasts.Clear();
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddSeconds(3));
        Changed(path);
        await Sync();
        Assert.Empty(broadcasts);
        Assert.Equal(new FileInfo(path).LastWriteTimeUtc.Ticks, repository.GetByPath(path)!.FileModified);
    }

    [Fact]
    public async Task UnreadableChangedAudioFallsBackWithoutDeletingTheExistingRow()
    {
        var path = Wave("track.wav");
        await Sync(); broadcasts.Clear();
        File.WriteAllBytes(path, [1, 2, 3]);
        Changed(path);
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        Assert.NotNull(repository.GetByPath(path));
        Assert.Equal(1, service.SyncState.Failed);
    }

    [Fact]
    public async Task ANewFileDuringAnalysisIsStillIndexedAndAnnouncedForPreparation()
    {
        Wave("existing.wav");
        await Sync(); broadcasts.Clear();
        var announced = new List<string>();
        service.NewTracksIndexed += paths => announced.AddRange(paths);
        service.RegisterQueue("analysis");
        var path = Wave("arrival.wav");
        Changed(path);
        service.DeregisterQueue("analysis");
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        Assert.NotNull(repository.GetByPath(path));
        Assert.Contains(path, announced);
    }

    [Fact]
    public async Task ADeletionStillRemovesTheIndexedTrack()
    {
        var path = Wave("removed.wav");
        await Sync(); broadcasts.Clear();
        File.Delete(path);
        Changed(path);
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        Assert.Null(repository.GetByPath(path));
    }

    [Fact]
    public async Task RenameChecksTheOldNameEvenWhenTheNewNameWasAlreadyIndexed()
    {
        var before = Wave("before.wav");
        await Sync(); broadcasts.Clear();
        var after = Path.Combine(root, "after.wav");
        File.Move(before, after);
        Assert.True(service.RefreshTrack(after));
        Call("OnFsRenamed", this, new RenamedEventArgs(WatcherChangeTypes.Renamed, root, "after.wav", "before.wav"));
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        Assert.Null(repository.GetByPath(before));
        Assert.NotNull(repository.GetByPath(after));
    }

    [Fact]
    public async Task ExplicitRequestsAndOtherWritingQueuesStillForceAReconciliation()
    {
        Wave("track.wav");
        await Sync(); broadcasts.Clear();
        service.TriggerImmediateSync();
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        broadcasts.Clear();
        service.RegisterQueue("metadata");
        service.DeregisterQueue("metadata");
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
        broadcasts.Clear();
        service.DeregisterQueue("metadata");
        await Sync();
        Assert.Empty(broadcasts);
    }

    [Fact]
    public async Task WatcherOverflowRemainsBoundedAndFallsBackToAFullScan()
    {
        Wave("track.wav");
        await Sync(); broadcasts.Clear();
        for (var i = 0; i < 520; i++) Changed(Path.Combine(root, $"change-{i}.wav"));
        var pending = (Dictionary<string, long>)typeof(MusicLibraryService).GetField("pendingFsPaths", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(service)!;
        Assert.Equal(512, pending.Count);
        await Sync();
        Assert.Contains(broadcasts, state => state.Running);
    }

    public void Dispose()
    {
        var debounce = (CancellationTokenSource?)typeof(MusicLibraryService).GetProperty("DebounceCts", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(service);
        debounce?.Cancel();
        debounce?.Dispose();
        Directory.Delete(root, true);
        MusicPath.Configure(previousRoot);
    }

    private static T Stub<T>(Func<MethodInfo, object?[]?, object?> call) where T : class
    {
        var value = DispatchProxy.Create<T, Proxy>();
        ((Proxy)(object)value).Call = call;
        return value;
    }

    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
}
