namespace Resonance.Tests.Analysis;

using System.Text.Json;
using System.Text.Json.Nodes;
using global::resonance.Analysis;
using global::resonance.Analysis.UsbExport;

public class BridgeExportReadinessTests
{
    private static JsonObject Complete()
    {
        return JsonNode.Parse("""
        {"scope":{"fullTrack":true},"durationSeconds":120,
         "featureAvailability":{"beats":"available","key":"available","waveform":"available","semanticPhrases":"available","vocalPresence":"available","genre":"available"},
         "features":{"beats":{"result":{"bpm_median_interval":120,"beats_seconds":[0,0.5,1],"downbeats_seconds":[0]}},"key":{"result":{"key":"Am"}},"waveform":{"result":{"overallPeaks":[0.5],"bands":{"low":[0.1],"mid":[0.2],"high":[0.3]}}},"semanticPhrases":{"result":{}},"vocalPresence":{"result":{}},"genre":{"result":{}}}}
        """)!.AsObject();
    }

    [Fact]
    public void CompleteFullTrackCanBeShared()
    {
        Assert.True(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(Complete())));
    }

    [Theory]
    [InlineData("beats")]
    [InlineData("key")]
    [InlineData("waveform")]
    [InlineData("semanticPhrases")]
    [InlineData("vocalPresence")]
    [InlineData("genre")]
    public void MissingOrFailedFeaturesCannotBeShared(string feature)
    {
        var analysis = Complete();
        analysis["featureAvailability"]![feature] = "failed";
        Assert.False(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(analysis)));
        analysis["featureAvailability"]![feature] = "available";
        analysis["features"]!.AsObject().Remove(feature);
        Assert.False(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(analysis)));
    }

    [Fact]
    public void PartialTracksAndInvalidTimelinesCannotBeShared()
    {
        var analysis = Complete();
        analysis["scope"]!["fullTrack"] = false;
        Assert.False(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(analysis)));
        analysis["scope"]!["fullTrack"] = true;
        analysis["features"]!["beats"]!["result"]!["beats_seconds"] = JsonNode.Parse("[1,0.5]");
        Assert.False(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(analysis)));
        Assert.False(ExportAnalysisContract.Ready(JsonSerializer.SerializeToElement(new { })));
    }

    [Fact]
    public void BatchPlansAreBoundedDeterministicAndSensitiveToAnalysisChanges()
    {
        var tracks = Enumerable.Range(0, 250).Select(i => new BridgeLibraryBatchService.VerifiedTrack(
            "track-" + i, "aa" + i.ToString("x62"), "analysis", "source", 1, 1, 25L << 20)).ToArray();
        var plan = BridgeLibraryBatchService.Plan(tracks);
        Assert.Equal(250, plan.Sum(batch => batch.Descriptor.Tracks));
        Assert.All(plan, batch =>
        {
            Assert.InRange(batch.Descriptor.Tracks, 1, 100);
            Assert.InRange(batch.Descriptor.EstimatedBytes, 1, 2L << 30);
        });
        Assert.Equal(plan.Select(batch => batch.Descriptor.Id), BridgeLibraryBatchService.Plan(tracks.Reverse()).Select(batch => batch.Descriptor.Id));
        var changed = tracks.ToArray();
        changed[0] = changed[0] with { AnalysisId = "new-analysis" };
        Assert.NotEqual(plan[0].Descriptor.Id, BridgeLibraryBatchService.Plan(changed)[0].Descriptor.Id);
        var otherBucket = tracks.Append(tracks[0] with { SourceKey = new string('b', 64) });
        var extended = BridgeLibraryBatchService.Plan(otherBucket);
        Assert.Equal(plan.Take(plan.Length - 1).Select(batch => batch.Descriptor.Id), extended.Take(plan.Length - 1).Select(batch => batch.Descriptor.Id));
        Assert.NotEqual(plan[^1].Descriptor.Id, extended[^1].Descriptor.Id);
        Assert.Empty(BridgeLibraryBatchService.Plan(Array.Empty<BridgeLibraryBatchService.VerifiedTrack>()));
    }

    [Fact]
    public void EnhancedSummaryDoesNotRequireNativeMetricsOrReplaceStaleRows()
    {
        var directory = Path.Combine(Path.GetTempPath(), "bridge-summary-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "track.mp3");
            File.WriteAllBytes(path, new byte[10]);
            var store = new AnalysisStore("Data Source=" + Path.Combine(directory, "analysis.db") + ";Pooling=False", usePostgres: false);
            var id = Guid.NewGuid().ToString("N");
            var summary = JsonSerializer.Serialize(new { complete = true, analysisId = id, exportReady = true });
            store.SaveDjSummary(path, summary);
            Assert.Equal(id, store.ExportReferenceFor(path));
            using (var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=" + Path.Combine(directory, "analysis.db") + ";Pooling=False"))
            {
                connection.Open();
                using var command = connection.CreateCommand();
                command.CommandText = "SELECT overall_peaks, analysed_at FROM track_analysis";
                using var reader = command.ExecuteReader();
                Assert.True(reader.Read());
                Assert.True(reader.IsDBNull(0));
                Assert.InRange(reader.GetInt64(1), DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 60, DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 1);
            }
            var next = Guid.NewGuid().ToString("N");
            store.SaveDjSummary(path, JsonSerializer.Serialize(new { complete = true, analysisId = next, exportReady = true }));
            Assert.Equal(next, store.ExportReferenceFor(path));
            File.WriteAllBytes(path, new byte[11]);
            store.SaveDjSummary(path, summary);
            Assert.Null(store.ExportReferenceFor(path));
            Assert.Equal(next, Assert.Single(store.ExportReferences()).AnalysisId);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void PartialReanalysisPreservesSuccessfulFactsButCannotGrantExportReadiness()
    {
        var directory = Path.Combine(Path.GetTempPath(), "crate-facts-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "track.mp3");
            File.WriteAllBytes(path, new byte[10]);
            var connectionString = "Data Source=" + Path.Combine(directory, "analysis.db") + ";Pooling=False";
            var store = new AnalysisStore(connectionString, usePostgres: false);
            Assert.True(store.SaveDjSummary(path, """{"genre":"Techno","key":"Am","bpm":128,"vocals":false,"exportReady":true,"analysisId":"first"}"""));
            var partial = """{"genre":null,"key":"C","bpm":null,"vocals":null,"complete":false,"exportReady":false,"analysisId":"second"}""";
            Assert.True(store.SaveDjSummary(path, partial));
            Assert.False(store.SaveDjSummary(path, partial));
            using var db = new Microsoft.Data.Sqlite.SqliteConnection(connectionString);
            db.Open();
            using var command = db.CreateCommand();
            command.CommandText = "SELECT dj_summary FROM track_analysis";
            using var summary = JsonDocument.Parse((string)command.ExecuteScalar()!);
            Assert.Equal("Techno", summary.RootElement.GetProperty("genre").GetString());
            Assert.Equal("C", summary.RootElement.GetProperty("key").GetString());
            Assert.Equal(128, summary.RootElement.GetProperty("bpm").GetInt32());
            Assert.False(summary.RootElement.GetProperty("vocals").GetBoolean());
            Assert.Null(store.ExportReferenceFor(path));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void BasicAnalysisOfReplacementAudioCannotReviveOldCrateFacts()
    {
        var directory = Path.Combine(Path.GetTempPath(), "crate-replaced-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var path = Path.Combine(directory, "track.mp3");
            File.WriteAllBytes(path, new byte[10]);
            var connectionString = "Data Source=" + Path.Combine(directory, "analysis.db") + ";Pooling=False";
            var store = new AnalysisStore(connectionString, usePostgres: false);
            store.Save(path, new AnalysisResult(Bpm:128, Key:"Am"));
            store.SaveDjSummary(path, """{"genre":"Techno","exportReady":true,"analysisId":"old"}""");
            File.WriteAllBytes(path, new byte[11]);
            store.Save(path, new AnalysisResult(Bpm:140));
            using var db = new Microsoft.Data.Sqlite.SqliteConnection(connectionString);
            db.Open();
            using var command = db.CreateCommand();
            command.CommandText = "SELECT detected_bpm, detected_key, dj_summary FROM track_analysis";
            using var reader = command.ExecuteReader();
            Assert.True(reader.Read());
            Assert.Equal(140, reader.GetInt32(0));
            Assert.True(reader.IsDBNull(1));
            Assert.True(reader.IsDBNull(2));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Fact]
    public void ExportReferencesSkipIncompleteAndMalformedSummaries()
    {
        var directory = Path.Combine(Path.GetTempPath(), "bridge-readiness-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var connectionString = "Data Source=" + Path.Combine(directory, "analysis.db") + ";Pooling=False";
            using var connection = new Microsoft.Data.Sqlite.SqliteConnection(connectionString);
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TABLE track_analysis(masked_filename TEXT PRIMARY KEY, file_size INTEGER, analysed_at INTEGER)";
            command.ExecuteNonQuery();
            var store = new AnalysisStore(connectionString, usePostgres: false);
            var id = Guid.NewGuid().ToString("N");
            var summaries = new[] { "[]", "invalid-json", "{}", "{\"complete\":false}",
                JsonSerializer.Serialize(new { complete = true, analysisId = id, exportReady = false }),
                JsonSerializer.Serialize(new { complete = true, analysisId = id, exportReady = true }) };
            for (var i = 0; i < summaries.Length; i++)
            {
                command.CommandText = "INSERT INTO track_analysis(masked_filename, file_size, analysed_at, dj_summary) VALUES(@path, 1, 0, @summary)";
                command.Parameters.Clear();
                command.Parameters.AddWithValue("@path", "track-" + i);
                command.Parameters.AddWithValue("@summary", summaries[i]);
                command.ExecuteNonQuery();
            }
            var reference = Assert.Single(store.ExportReferences());
            Assert.Equal("track-5", reference.Path);
            Assert.Equal(id, reference.AnalysisId);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }
}
