namespace Resonance.Tests.MetadataLookup;

using global::resonance.MetadataLookup;
using global::resonance.Shares;
using Serilog;

public sealed class MetadataActivityTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lookup-evidence-" + Guid.NewGuid());
    private readonly ILogger log = new LoggerConfiguration().CreateLogger();
    private string Journal => Path.Combine(directory, "activity.jsonl");
    private static FileTags Empty => new(null!, null, null, null!, 0, 0, Key: "8A", Bpm: 125, Comment: "Keep me");
    private static Dictionary<string, string> Sources => new() { ["Album"] = "Discogs", ["Year"] = "MusicBrainz" };

    public MetadataActivityTests() => Directory.CreateDirectory(directory);

    [Fact]
    public void OnlyChangedProviderValuesReadBackFromDiskCountAsUpdates()
    {
        var before = Empty with { Year = 2000 };
        var proposed = before with { Album = "Online album", Title = "User edit", Year = 2001 };
        var after = proposed with { Year = 2000 };
        var changed = MetadataTagEvidence.ConfirmChanges(before, after, proposed, Sources);
        Assert.Single(changed);
        Assert.Equal("Discogs", changed["Album"]);
        Assert.Empty(MetadataTagEvidence.ConfirmChanges(before, before, proposed, Sources));
    }

    [Fact]
    public void SuccessfulSaveMustReadBackChangesAndPreserveOtherTags()
    {
        var disk = Empty;
        var result = MetadataTagEvidence.Write("test-track", tags => tags with { Album = "Found" }, Sources,
            tags => disk = tags, () => disk);
        Assert.Equal("Found", disk.Album);
        Assert.Equal("Keep me", disk.Comment);
        Assert.Equal("8A", disk.Key);
        Assert.Equal(125u, disk.Bpm);
        Assert.Equal("Discogs", result.Fields["Album"]);
    }

    [Fact]
    public void MatchingWithoutChangesDoesNotRewriteTheFile()
    {
        var writes = 0;
        var result = MetadataTagEvidence.Write("test-track", tags => tags, Sources, _ => writes++, () => Empty);
        Assert.Equal(0, writes);
        Assert.Empty(result.Fields);
    }

    [Fact]
    public void SaveReturningWithoutPersistingIsNotAnUpdate()
    {
        var result = MetadataTagEvidence.Write("test-track", tags => tags with { Album = "Found" }, Sources,
            _ => { }, () => Empty);
        Assert.Empty(result.Fields);
    }

    [Fact]
    public void FailedSaveOrVerificationCannotReturnSuccess()
    {
        Assert.Throws<IOException>(() => MetadataTagEvidence.Write("test-track", tags => tags with { Album = "Found" },
            Sources, _ => throw new IOException("Write failed"), () => Empty));
        var reads = 0;
        Assert.Throws<IOException>(() => MetadataTagEvidence.Write("test-track", tags => tags with { Album = "Found" },
            Sources, _ => { }, () => reads++ == 0 ? Empty : throw new IOException("Read failed")));
    }

    [Fact]
    public void HistorySurvivesRestartAndLaterUnsuccessfulAttempts()
    {
        var store = new MetadataActivityStore(Journal, log);
        store.Record("album/song.flac", Event("Updated", Sources));
        for (var i = 0; i < 25; i++) store.Record("album/song.flac", Event("NoMatch"));
        store.Record("other/song.flac", Event("Preview"));
        var reloaded = new MetadataActivityStore(Journal, log);
        var (history, lastUpdate) = reloaded.Get("album/song.flac");
        Assert.Equal(20, history.Length);
        Assert.All(history, item => Assert.Equal("NoMatch", item.Status));
        Assert.Equal("Updated", lastUpdate.Status);
        Assert.Equal("Discogs", lastUpdate.Fields["Album"]);
        Assert.Null(reloaded.Get("other/song.flac").LastUpdate);
        Assert.Empty(reloaded.Get("missing.flac").History);
        Assert.True(reloaded.Healthy);
    }

    [Fact]
    public void CorruptTailDoesNotDiscardPreviousOrSubsequentEvidence()
    {
        var store = new MetadataActivityStore(Journal, log);
        store.Record("song.flac", Event("NoMatch"));
        File.AppendAllText(Journal, "\n{incomplete");
        store.Record("song.flac", Event("Updated", Sources));
        var reloaded = new MetadataActivityStore(Journal, log);
        Assert.Equal(2, reloaded.Get("song.flac").History.Length);
        Assert.NotNull(reloaded.Get("song.flac").LastUpdate);
        Assert.False(reloaded.Healthy);
    }

    [Fact]
    public void InvalidButWellFormedJsonDoesNotPreventStartupOrClaimAnUpdate()
    {
        File.WriteAllText(Journal, """{"Path":"song.flac","Activity":{}}""");
        var store = new MetadataActivityStore(Journal, log);
        Assert.False(store.Healthy);
        Assert.Empty(store.Get("song.flac").History);
        Assert.Null(store.Get("song.flac").LastUpdate);
    }

    [Fact]
    public async Task ConcurrentWorkersPersistSeparateRecords()
    {
        var store = new MetadataActivityStore(Journal, log);
        await Task.WhenAll(Enumerable.Range(0, 50).Select(i => Task.Run(() => store.Record($"{i}.flac", Event("Updated", Sources)))));
        var reloaded = new MetadataActivityStore(Journal, log);
        Assert.True(reloaded.Healthy);
        for (var i = 0; i < 50; i++) Assert.NotNull(reloaded.Get($"{i}.flac").LastUpdate);
    }

    [Fact]
    public void PersistenceFailureIsReportedWithoutInventingSuccess()
    {
        var store = new MetadataActivityStore(Path.Combine(directory, "missing", "journal"), log);
        store.Record("song.flac", Event("NoMatch"));
        Assert.False(store.Healthy);
        Assert.Null(store.Get("song.flac").LastUpdate);
    }

    private static MetadataActivityEvent Event(string status, IReadOnlyDictionary<string, string>? fields = null)
        => new(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, status, "Automatic", "Synthetic test", fields ?? new Dictionary<string, string>());

    public void Dispose() => Directory.Delete(directory, true);
}
