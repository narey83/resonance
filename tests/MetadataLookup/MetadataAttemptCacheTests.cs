namespace Resonance.Tests.MetadataLookup;

using System.Text.Json;
using global::resonance.Common;
using global::resonance.MetadataLookup;
using Serilog;

[Collection("Music path configuration")]
public sealed class MetadataAttemptCacheTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string directory = Path.Combine(Path.GetTempPath(), "metadata-history-" + Guid.NewGuid());
    private readonly ILogger logger = new LoggerConfiguration().CreateLogger();
    private string CacheFile => Path.Combine(directory, "attempts.json");
    private string Root => Path.Combine(directory, "music");

    public MetadataAttemptCacheTests()
    {
        Directory.CreateDirectory(Root);
        MusicPath.Configure(Root);
    }

    [Fact]
    public void RelativeHistoryMatchesCurrentAbsolutePath()
    {
        WriteTrack("HATE/track.mp3");
        WriteHistory(("HATE/track.mp3", 1, "written"));
        var cache = new MetadataAttemptCache(CacheFile, logger);
        Assert.True(cache.ShouldSkip(Path.Combine(Root, "HATE/track.mp3")));
        Assert.True(cache.ShouldSkip("HATE/track.mp3"));
        Assert.False(cache.ShouldSkip(Path.Combine(Root, "Other/track.mp3")));
        Assert.False(cache.ShouldSkip(Root + "-other/HATE/track.mp3"));
    }

    [Fact]
    public void NewRecordsRemainRelativeAcrossRestartAndMountMove()
    {
        WriteTrack("album/song.flac");
        var cache = new MetadataAttemptCache(CacheFile, logger);
        cache.Record(Path.Combine(Root, "album/song.flac"), "artist|song|album", "musicbrainz", "nomatch");
        cache.Save();
        using (var json = JsonDocument.Parse(File.ReadAllText(CacheFile)))
            Assert.True(json.RootElement.TryGetProperty("album/song.flac", out _));
        var movedRoot = Path.Combine(directory, "new-mount");
        Directory.Move(Root, movedRoot);
        MusicPath.Configure(movedRoot);
        var reloaded = new MetadataAttemptCache(CacheFile, logger);
        Assert.True(reloaded.ShouldSkip(Path.Combine(movedRoot, "album/song.flac")));
    }

    [Fact]
    public void AbsoluteAndLegacyHistoryMergeWithoutLosingNewestOutcome()
    {
        WriteTrack("album/song.flac");
        WriteHistory(("album/song.flac", 1, "nomatch"),
            (Path.Combine(Root, "album/song.flac"), 3, "written"),
            ("/mnt/data/music/album/song.flac", 2, "nomatch"));
        var cache = new MetadataAttemptCache(CacheFile, logger);
        Assert.True(cache.ShouldSkip(Path.Combine(Root, "album/song.flac")));
        using var json = JsonDocument.Parse(File.ReadAllText(CacheFile));
        Assert.Single(json.RootElement.EnumerateObject());
        Assert.Equal("written", json.RootElement.GetProperty("album/song.flac").GetProperty("Outcome").GetString());
    }

    [Fact]
    public void UnavailableMusicMountDoesNotEraseHistory()
    {
        WriteHistory(("album/song.flac", 1, "written"));
        MusicPath.Configure(Path.Combine(directory, "unmounted"));
        var cache = new MetadataAttemptCache(CacheFile, logger);
        cache.Save();
        Assert.True(cache.ShouldSkip("album/song.flac"));
        using var json = JsonDocument.Parse(File.ReadAllText(CacheFile));
        Assert.Single(json.RootElement.EnumerateObject());
    }

    [Fact]
    public void PruningChecksConfiguredMusicRootRatherThanWorkingDirectory()
    {
        Directory.CreateDirectory(Path.Combine(Root, "album"));
        WriteHistory(("album/deleted.flac", 1, "written"));
        var cache = new MetadataAttemptCache(CacheFile, logger);
        Assert.True(cache.ShouldSkip(Path.Combine(Root, "album/deleted.flac")));
        cache.PruneMissing();
        Assert.False(cache.ShouldSkip(Path.Combine(Root, "album/deleted.flac")));
    }

    [Fact]
    public void CancelledCleanupKeepsPreviouslyLoadedHistory()
    {
        Directory.CreateDirectory(Path.Combine(Root, "album"));
        WriteHistory(("album/deleted.flac", 1, "written"));
        var cache = new MetadataAttemptCache(CacheFile, logger);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        Assert.Throws<OperationCanceledException>(() => cache.PruneMissing(cancellation.Token));
        Assert.True(cache.ShouldSkip("album/deleted.flac"));
    }

    private void WriteTrack(string relative)
    {
        var path = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "test");
    }

    private void WriteHistory(params (string Path, long AttemptedAt, string Outcome)[] entries)
        => File.WriteAllText(CacheFile, JsonSerializer.Serialize(entries.ToDictionary(
            e => e.Path, e => new { Identity = "artist|song|album", e.AttemptedAt, Provider = "musicbrainz", e.Outcome })));

    public void Dispose()
    {
        MusicPath.Configure(previousRoot);
        Directory.Delete(directory, true);
    }
}
