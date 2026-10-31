namespace Resonance.Tests.Analysis;

using System.Reflection;
using Microsoft.Extensions.Options;
using global::resonance.Analysis;
using global::resonance.Common;
using global::resonance.MusicLibrary;
using global::resonance.Shares;

[Collection("Music path configuration")]
public sealed class AnalysisResultPersistenceTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string root = Path.Combine(Path.GetTempPath(), "resonance-analysis-write-" + Guid.NewGuid().ToString("N"));
    private readonly string path;
    private readonly AnalysisStore store;
    private readonly MusicRepository repository;
    private readonly TrackAnalysisInfo track;
    private readonly AnalysisService service;
    private readonly ShareProxy proxy;
    private readonly IShareService shares;
    private int writes;
    private bool? requestedLibrarySync;
    private Action<FileTags> write = _ => { };

    public AnalysisResultPersistenceTests()
    {
        Directory.CreateDirectory(root);
        MusicPath.Configure(root);
        path = Path.Combine(root, "track #1.flac");
        File.WriteAllBytes(path, new byte[64]);
        var connection = $"Data Source={Path.Combine(root, "analysis.db")};Pooling=False";
        repository = new MusicRepository(connection, false);
        repository.Initialize();
        store = new AnalysisStore(connection, usePostgres: false);
        IndexTrack();
        track = new TrackAnalysisInfo("library\\track #1.flac", MusicPath.ToRelative(path), root, Path.GetFileName(path), "flac", null,
            string.Empty, false, null, "Artist", "Track", "Album");
        shares = DispatchProxy.Create<IShareService, ShareProxy>();
        proxy = (ShareProxy)(object)shares;
        proxy.Call = (method, args) =>
        {
            if (method.Name == "GetTags") return new FileTags("Artist", "Artist", "Album", "Track", 1, 2026);
            if (method.Name == "WriteFileTags")
            {
                writes++;
                requestedLibrarySync = (bool)args![2]!;
                write((FileTags)args![1]!);
                return null;
            }
            throw new InvalidOperationException("Unexpected share call: " + method.Name);
        };
        service = new AnalysisService(shares, null!, null!, store);
    }

    private static AnalysisResult Result() => new(
        Bpm: 128, Key: "Am", Waveform: new WaveformData([0.25f], [0.2f], [0.1f], [0.05f], 1),
        Loudness: new LoudnessData(-9, -1, 4));

    [Fact]
    public void ActiveReaderDoesNotDiscardAnyCompletedAnalysisOrModifyTheAudioFile()
    {
        var original = File.ReadAllBytes(path);
        using var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        write = tags =>
        {
            Assert.Equal((uint)128, tags.Bpm);
            Assert.Equal("Am", tags.Key);
            Assert.Equal("Artist", tags.Artist);
            using var writer = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        };
        Assert.True(service.PersistAnalysisResult(track, Result(), writeToTags: true));
        Assert.Equal(1, writes);
        Assert.True(reader.CanRead);
        Assert.Equal(original, File.ReadAllBytes(path));
        AssertCached();
    }

    [Fact]
    public void SuccessfulTagWriteCachesTheNewFingerprint()
    {
        var originalSize = new FileInfo(path).Length;
        write = _ => File.AppendAllText(path, "updated tags");
        Assert.True(service.PersistAnalysisResult(track, Result(), writeToTags: true));
        Assert.True(new FileInfo(path).Length > originalSize);
        Assert.Equal(1, writes);
        Assert.False(requestedLibrarySync);
        AssertCached();
    }

    [Fact]
    public void ExplicitTagEditsStillRequestLibraryReconciliation()
    {
        service.SetBpm(track.MaskedFilename, 128);
        Assert.Equal(1, writes);
        Assert.True(requestedLibrarySync);
    }

    [Fact]
    public void DisablingFileTagWritesStillPersistsAnalysis()
    {
        write = _ => throw new InvalidOperationException("File tags must not be touched");
        Assert.True(service.PersistAnalysisResult(track, Result(), writeToTags: false));
        Assert.Equal(0, writes);
        AssertCached();
    }

    [Fact]
    public void UnrelatedStorageFailureStillPropagates()
    {
        var failure = new IOException("storage failure");
        write = _ => throw failure;
        Assert.Same(failure, Assert.Throws<IOException>(() => service.PersistAnalysisResult(track, Result(), writeToTags: true)));
        Assert.Empty(store.GetDetectedTags());
        Assert.Null(store.GetWaveform(path));
    }

    [Fact]
    public async Task MissingPackagesStopAResetBeforeClearingAnySavedAnalysisOrChangingTags()
    {
        service.PersistAnalysisResult(track, Result(), writeToTags: false);
        var original = File.ReadAllBytes(path);
        proxy.Call = (method, _) => method.Name == "FindFiles"
            ? new[] { new TaggedFile(track.MaskedFilename, track.OriginalFilename, root, track.Filename, "flac", null!) }
            : throw new InvalidOperationException("No file tags may be touched before dependency validation");
        var monitor = DispatchProxy.Create<IOptionsMonitor<global::resonance.Options>, ShareProxy>();
        ((ShareProxy)(object)monitor).Call = (_, _) => new global::resonance.Options
        {
            Analysis = new() { EssentiaPython = Path.Combine(root, "missing-python") },
        };
        var scan = new AnalysisService(shares, monitor, null!, store);
        await scan.StartScanAsync(new(ResetAll: true, OnlyFilenames: [track.MaskedFilename]));
        for (var i = 0; i < 500 && scan.ScanState.Scanning; i++) await Task.Delay(10);
        Assert.False(scan.ScanState.Scanning);
        Assert.False(scan.ScanState.Completed);
        Assert.False(scan.ScanState.Cancelled);
        Assert.True(scan.ScanState.DependencyUnavailable);
        Assert.Contains("BPM/key", scan.ScanState.Error);
        Assert.Equal(1, scan.ScanState.Failed);
        Assert.Equal(0, scan.ScanState.Analysed);
        Assert.Equal(0, writes);
        Assert.Equal(original, File.ReadAllBytes(path));
        AssertCached();
    }

    [Fact]
    public async Task CachedCompleteAnalysisDoesNotRequireLoadingMissingDetectorPackages()
    {
        service.PersistAnalysisResult(track, Result(), writeToTags: false);
        proxy.Call = (method, _) => method.Name == "FindFiles"
            ? new[] { new TaggedFile(track.MaskedFilename, track.OriginalFilename, root, track.Filename, "flac", null!) }
            : throw new InvalidOperationException("A cached result should not change tags");
        var monitor = DispatchProxy.Create<IOptionsMonitor<global::resonance.Options>, ShareProxy>();
        ((ShareProxy)(object)monitor).Call = (_, _) => new global::resonance.Options
        {
            Analysis = new() { EssentiaPython = Path.Combine(root, "missing-python") },
        };
        var scan = new AnalysisService(shares, monitor, null!, store);
        await scan.StartScanAsync(new(OnlyFilenames: [track.MaskedFilename]));
        for (var i = 0; i < 500 && scan.ScanState.Scanning; i++) await Task.Delay(10);
        Assert.False(scan.ScanState.Scanning);
        Assert.True(scan.ScanState.Completed);
        Assert.False(scan.ScanState.DependencyUnavailable);
        Assert.Null(scan.ScanState.Error);
        Assert.Equal(0, scan.ScanState.Failed);
        AssertCached();
    }

    private void IndexTrack()
    {
        var info = new FileInfo(path);
        repository.Upsert(new MusicTrack(MusicPath.ToRelative(path), Path.GetFileName(path), string.Empty, "flac",
            info.Length, new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            120, "Track", "Artist", "Artist", "Album", 2026, 1, 1, "Trance", null, string.Empty, string.Empty, false, "Xiph", 1000, 44100, 16));
    }

    private void AssertCached()
    {
        // The scan refreshes the library fingerprint after persisting its analysis result.
        IndexTrack();
        var cached = Assert.Single(store.GetDetectedTags());
        Assert.Equal(MusicPath.ToRelative(path), cached.Key);
        Assert.Equal((uint?)128, cached.Value.Bpm);
        Assert.Equal("Am", cached.Value.Key);
        Assert.NotNull(store.GetWaveform(path));
        Assert.Equal(-9, store.GetLoudness(path).IntegratedLufs);
    }

    public void Dispose()
    {
        MusicPath.Configure(previousRoot);
        Directory.Delete(root, recursive: true);
    }

    public class ShareProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
}
