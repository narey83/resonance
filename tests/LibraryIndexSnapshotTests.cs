namespace Resonance.Tests;

using global::resonance.Common;
using global::resonance.MusicLibrary;

[Collection("Music path configuration")]
public sealed class LibraryIndexSnapshotTests : IDisposable
{
    private readonly string previousRoot = MusicPath.Root;
    private readonly string root = Path.Combine(Path.GetTempPath(), "resonance-index-" + Guid.NewGuid().ToString("N"));
    private readonly MusicRepository repository;
    private readonly LibraryIndexSnapshotService snapshots;

    public LibraryIndexSnapshotTests()
    {
        Directory.CreateDirectory(root);
        MusicPath.Configure(root);
        repository = new MusicRepository($"Data Source={Path.Combine(root, "test.db")};Pooling=False");
        repository.Initialize();
        snapshots = new LibraryIndexSnapshotService(repository, Path.Combine(root, "snapshots"));
    }

    [Fact]
    public void SnapshotRestoresOriginalAddedDatesAndTrackMetadata()
    {
        var path = Path.Combine(root, "first.flac");
        repository.Upsert(Track(path, 638000000000000000));
        var saved = snapshots.Create();
        Assert.DoesNotContain(root, File.ReadAllText(Path.Combine(root, "snapshots", $"{saved.Id:N}.tracks.json")));
        Assert.Single(snapshots.List());
        Assert.Equal(1, repository.ClearIndexVerified());
        Assert.Equal(0, repository.GetStats().Total);

        var movedRoot = Path.Combine(root, "moved");
        MusicPath.Configure(movedRoot);

        var restored = snapshots.Restore(saved.Id);
        Assert.Equal(saved.Id, restored.Id);
        Assert.Equal(1, repository.GetStats().Total);
        Assert.Equal(638000000000000000, repository.GetByPath(Path.Combine(movedRoot, "first.flac"))!.IndexedAt);
        Assert.Equal("Original title", repository.GetByPath(Path.Combine(movedRoot, "first.flac"))!.Title);
    }

    [Fact]
    public void DamagedSnapshotCannotReplaceCurrentIndex()
    {
        var path = Path.Combine(root, "first.flac");
        repository.Upsert(Track(path, 638000000000000000));
        var saved = snapshots.Create();
        File.AppendAllText(Path.Combine(root, "snapshots", $"{saved.Id:N}.tracks.json"), "corrupt");
        repository.Upsert(Track(Path.Combine(root, "second.flac"), 638100000000000000));

        Assert.Throws<InvalidDataException>(() => snapshots.Restore(saved.Id));
        Assert.Equal(2, repository.GetStats().Total);
    }

    private static MusicTrack Track(string path, long indexedAt) => new(
        path, Path.GetFileName(path), Path.GetDirectoryName(path)!, ".flac", 123, indexedAt,
        indexedAt, 180, "Original title", "Artist", null!, "Album", 2020, 1, 1,
        "Electronic", 120, "Am", null!, false, null!, null, null, null);

    public void Dispose()
    {
        MusicPath.Configure(previousRoot);
        Directory.Delete(root, recursive: true);
    }
}
