namespace Resonance.Tests.Database;

using global::resonance;
using global::resonance.Telemetry;
using global::resonance.Transfers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Soulseek;

public class OverviewReportCorrectnessTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "overview-reports-" + Guid.NewGuid().ToString("N"));
    private readonly TransfersDbContext context;
    private readonly MemoryCache cache = new(new MemoryCacheOptions());
    private readonly ReportsService reports;
    private readonly DateTime start = new(2026, 10, 20, 0, 0, 0, DateTimeKind.Utc);
    private readonly DateTime end = new(2026, 10, 27, 0, 0, 0, DateTimeKind.Utc);

    public OverviewReportCorrectnessTests()
    {
        System.IO.Directory.CreateDirectory(directory);
        var connection = $"Data Source={Path.Combine(directory, "test.db")};Pooling=False";
        context = new(new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options);
        SqliteSchema.Initialize(context);
        var connections = new ConnectionStringDictionary(new Dictionary<global::resonance.Database, ConnectionString> { [global::resonance.Database.Transfers] = connection }, false);
        new TransferNetworkInfoStore(connections).Initialize();
        reports = new(connections, cache);
    }

    [Fact]
    public void SuccessfulReportsUseActualBytesAndKeepFailedOutcomesSeparate()
    {
        Add("peer", TransferStates.Succeeded, 200, 100); // 100 actual bytes after resume.
        Add("peer", TransferStates.Succeeded, 1000, 1000); // Already complete: no new bytes.
        Add("peer", TransferStates.Errored, 50, 0);
        Add("peer", TransferStates.Succeeded, 10, 20); // Corrupt negative delta is clamped.
        context.SaveChanges();
        var summary = reports.GetTransferSummary(start, end, TransferDirection.Upload)[TransferDirection.Upload];
        Assert.Equal(3, summary[TransferStates.Succeeded].Count);
        Assert.Equal(100, summary[TransferStates.Succeeded].TotalBytes);
        Assert.Equal(1, summary[TransferStates.Errored].Count);
        Assert.Equal(50, summary[TransferStates.Errored].TotalBytes);
        var histogram = reports.GetTransferHistogram(start, end, TimeSpan.FromHours(1), TransferDirection.Upload);
        Assert.Equal(100, histogram.Values.Sum(bucket => bucket[TransferDirection.Upload].GetValueOrDefault(TransferStates.Succeeded)?.TotalBytes ?? 0));
        Assert.Equal(100, reports.GetTopFiles(start, end).Single().TotalBytes);
        Assert.Equal(100, reports.GetUserList(start, end).Items.Single().UploadBytes);
        Assert.Equal(100, reports.GetActivityHeatmap(start, end, TransferDirection.Upload).Sum(cell => cell.Bytes));
    }

    [Fact]
    public void LightweightSummaryKeepsCountsAndBytesWithoutCalculatingTimings()
    {
        Add("peer", TransferStates.Succeeded, 200, 100);
        context.SaveChanges();
        var full = reports.GetTransferSummary(start, end, TransferDirection.Upload)[TransferDirection.Upload][TransferStates.Succeeded];
        var counters = reports.GetTransferSummary(start, end, TransferDirection.Upload, includeTimings: false)[TransferDirection.Upload][TransferStates.Succeeded];
        Assert.Equal(full.Count, counters.Count);
        Assert.Equal(full.TotalBytes, counters.TotalBytes);
        Assert.Equal(full.AverageSpeed, counters.AverageSpeed);
        Assert.True(full.AverageDuration > 0);
        Assert.Equal(0, counters.AverageDuration);
    }

    [Fact]
    public void PeerRetentionIncludesOnlyActivePeersAndRecognizesTheirEarlierHistory()
    {
        Add("returning", TransferStates.Succeeded, 100, 0, start.AddDays(-2));
        Add("returning", TransferStates.Succeeded, 100, 0);
        Add("new", TransferStates.Succeeded, 100, 0);
        Add("inactive", TransferStates.Succeeded, 100, 0, start.AddDays(-3));
        context.SaveChanges();
        var result = reports.GetPeerRetention(start, end);
        Assert.Equal(1, result.NewPeers);
        Assert.Equal(1, result.ReturningPeers);
    }

    [Fact]
    public void DifferentCustomRangesCannotCollideAcrossCacheTiers()
    {
        var now = DateTime.UtcNow;
        var method = typeof(ReportsService).GetMethod("WindowKey", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)!;
        var shortWindow = method.Invoke(null, new object[] { now.AddMinutes(-576), now });
        var dayWindow = method.Invoke(null, new object[] { now.AddDays(-1), now });
        Assert.NotEqual(shortWindow, dayWindow);
    }

    [Fact]
    public void RepeatedRollingRangesReuseTheirCacheKey()
    {
        var now = DateTime.UtcNow;
        var method = typeof(ReportsService).GetMethod("WindowKey", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic)!;
        var first = method.Invoke(null, new object[] { now.AddDays(-7), now });
        var next = method.Invoke(null, new object[] { now.AddDays(-7).AddSeconds(3), now.AddSeconds(3) });
        Assert.Equal(first, next);
    }

    [Theory]
    [InlineData("Succeeded")]
    [InlineData("succeeded")]
    [InlineData("SUCCEEDED")]
    public void HistorySuccessFilterKeepsOnlySuccessfulRows(string state)
    {
        Add("success", TransferStates.Succeeded, 100, 0);
        Add("failure", TransferStates.Errored, 20, 0);
        context.SaveChanges();
        var result = reports.GetTransferHistory(state: state, start: start, end: end);
        Assert.Equal("success", Assert.Single(result.Items).Username);
    }

    [Fact]
    public void HistorySuccessPagingPreservesRetrySuppressionAndDirection()
    {
        Add("old", TransferStates.Errored, 20, 0);
        Add("retry", TransferStates.Succeeded, 100, 0, start.AddHours(2));
        var old = context.Transfers.Local.Single(item => item.Username == "old");
        context.Transfers.Local.Single(item => item.Username == "retry").RetryOfId = old.Id;
        Add("latest", TransferStates.Succeeded, 100, 0, start.AddHours(3));
        Add("download", TransferStates.Succeeded, 100, 0, start.AddHours(4), direction: TransferDirection.Download);
        context.SaveChanges();
        var first = reports.GetTransferHistory(direction: TransferDirection.Upload, state: "Succeeded", start: start, end: end, limit: 1);
        Assert.Equal("latest", Assert.Single(first.Items).Username);
        Assert.Equal(2, first.Total);
        var next = reports.GetTransferHistory(direction: TransferDirection.Upload, state: "Succeeded", start: start, end: end, limit: 1, offset: 1);
        Assert.Equal("retry", Assert.Single(next.Items).Username);
        Assert.Equal(1, next.Items[0].PriorFailedAttempts);
        Assert.Empty(reports.GetTransferHistory(state: "Errored", start: start, end: end).Items);
    }

    [Fact]
    public void HistoryAndAttemptsExposeStoredResumeOffset()
    {
        Add("resumed", TransferStates.Succeeded, 1000, 1000);
        context.SaveChanges();

        var history = Assert.Single(reports.GetTransferHistory(start: start, end: end).Items);
        Assert.Equal(1000L, history.StartOffset);
        Assert.Equal(history.StartOffset, history.BytesTransferred);
        Assert.Equal(history.StartOffset, Assert.Single(reports.GetTransferAttempts(history.Id)).StartOffset);
    }

    [Fact]
    public void HistoryPartialStateAndEscapedFilenameSearchStillWork()
    {
        Add("literal", TransferStates.Succeeded, 100, 0, filename: "music/100%_literal.flac");
        Add("other", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        var result = reports.GetTransferHistory(state: "ceed", search: "%_literal", start: start, end: end);
        Assert.Equal("literal", Assert.Single(result.Items).Username);
    }

    [Fact]
    public void FailedHistoryFilterIncludesEveryUnsuccessfulOutcomeButNoSuccesses()
    {
        foreach (var outcome in new[] { TransferStates.Errored, TransferStates.TimedOut, TransferStates.Rejected, TransferStates.Aborted, TransferStates.Cancelled })
        {
            Add(outcome.ToString(), outcome, 0, 0);
        }

        Add("success", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        var result = reports.GetTransferHistory(state: "Failed", start: start, end: end);
        Assert.Equal(5, result.Items.Count);
        Assert.DoesNotContain(result.Items, item => item.Username == "success");
    }

    [Fact]
    public void HistoryForgetsDisconnectedUploadsButRetainsOtherRemovedTransfers()
    {
        Add("abandoned", TransferStates.Cancelled, 0, 0, start.AddHours(3));
        Add("retained", TransferStates.Errored, 0, 0, start.AddHours(2));
        Add("ordinary", TransferStates.Succeeded, 100, 0, start.AddHours(1));
        var abandoned = context.Transfers.Local.Single(item => item.Username == "abandoned");
        abandoned.Removed = true;
        abandoned.Exception = global::resonance.Transfers.Transfer.ForgottenUploadReason;
        context.Transfers.Local.Single(item => item.Username == "retained").Removed = true;
        context.SaveChanges();

        // A bulk update can leave the text used by the UI stale on existing rows.
        context.Database.ExecuteSqlRaw("UPDATE Transfers SET StateDescription = 'Queued, Locally' WHERE Id = {0}", abandoned.Id);

        var history = reports.GetTransferHistory(direction: TransferDirection.Upload, start: start, end: end, limit: 1);
        Assert.Equal("retained", Assert.Single(history.Items).Username);
        Assert.Equal(2, history.Total);
        var next = reports.GetTransferHistory(direction: TransferDirection.Upload, start: start, end: end, limit: 1, offset: 1);
        Assert.Equal("ordinary", Assert.Single(next.Items).Username);
        Assert.DoesNotContain(reports.GetTransferHistory(direction: TransferDirection.Upload, state: "Failed", start: start, end: end).Items,
            item => item.Username == "abandoned");
    }

    [Fact]
    public void UserPagesSortsAndSearchesReuseOneAggregateSnapshot()
    {
        Add("alpha", TransferStates.Succeeded, 200, 100, start.AddHours(1));
        Add("beta", TransferStates.Succeeded, 300, 0, start.AddHours(2));
        Add("charlie", TransferStates.Errored, 0, 0, start.AddHours(3));
        context.SaveChanges();
        var first = reports.GetUserList(start, end, limit: 1);
        Assert.Equal("charlie", Assert.Single(first.Items).Username);
        Assert.Equal(3, first.Total);

        // If any view reaggregates Transfers, it can no longer reconstruct these rows.
        context.Database.ExecuteSqlRaw("DELETE FROM Transfers");
        var sorted = reports.GetUserList(start, end, sortBy: UserReportSortBy.Username, sortOrder: SortOrder.ASC, limit: 1);
        Assert.Equal("alpha", Assert.Single(sorted.Items).Username);
        Assert.Equal(100, sorted.Items[0].UploadBytes);
        var next = reports.GetUserList(start, end, sortBy: UserReportSortBy.Username, sortOrder: SortOrder.ASC, limit: 1, offset: 1);
        Assert.Equal("beta", Assert.Single(next.Items).Username);
        var filtered = reports.GetUserList(start, end, search: "CHARLIE");
        Assert.Equal("charlie", Assert.Single(filtered.Items).Username);
        Assert.Equal(1, filtered.Total);
        Assert.Equal(1, filtered.Items[0].UploadErrorCount);
    }

    [Fact]
    public void LiveUserWindowReusesSnapshotAsNowAdvancesButSeparatesDifferentStarts()
    {
        Add("original", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        Assert.Single(reports.GetUserList(start, end, liveWindow: true).Items);
        Add("new", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        Assert.Single(reports.GetUserList(start, end.AddSeconds(5), liveWindow: true).Items);
        Assert.Equal(2, reports.GetUserList(start.AddDays(-1), end.AddSeconds(5), liveWindow: true).Items.Count);
    }

    [Fact]
    public void NewUserSnapshotInvalidatesPreviouslyCachedPages()
    {
        Add("original", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        Assert.Single(reports.GetUserList(start, end, liveWindow: true).Items);
        Add("new", TransferStates.Succeeded, 100, 0);
        context.SaveChanges();
        cache.Remove($"reports:users:aggregate:live:{start.Ticks}");
        Assert.Equal(2, reports.GetUserList(start, end.AddSeconds(5), liveWindow: true).Items.Count);
    }

    [Fact]
    public void UserSnapshotKeepsNumericTypesStableAcrossZeroAndFractionalSpeeds()
    {
        Add("zero", TransferStates.Errored, 0, 0, start.AddHours(3));
        Add("fractional", TransferStates.Succeeded, 100, 0, start.AddHours(2));
        context.Transfers.Local.Single(item => item.Username == "fractional").AverageSpeed = 951743.2061675217;
        Add("download", TransferStates.Succeeded, 100, 0, start.AddHours(1), direction: TransferDirection.Download);
        context.Transfers.Local.Single(item => item.Username == "download").AverageSpeed = 123.75;
        context.SaveChanges();
        var rows = reports.GetUserList(start, end).Items;
        Assert.Equal(3, rows.Count);
        Assert.Equal(0, rows[0].UploadAverageSpeed);
        Assert.Equal(951743.2061675217, rows.Single(item => item.Username == "fractional").UploadAverageSpeed);
        Assert.Equal(123.75, rows.Single(item => item.Username == "download").DownloadAverageSpeed);
    }

    private void Add(string username, TransferStates outcome, long transferred, long offset, DateTime? ended = null, TransferDirection direction = TransferDirection.Upload, string filename = "music/track.flac")
    {
        var time = ended ?? start.AddHours(1);
        context.Transfers.Add(new global::resonance.Transfers.Transfer
        {
            Id = Guid.NewGuid(), Username = username, Filename = filename, Direction = direction,
            Size = 1000, StartOffset = offset, BytesTransferred = transferred, State = TransferStates.Completed | outcome,
            RequestedAt = time.AddMinutes(-2), EnqueuedAt = time.AddMinutes(-2), StartedAt = time.AddMinutes(-1), EndedAt = time,
        });
    }

    public void Dispose()
    {
        context.Dispose(); cache.Dispose(); System.IO.Directory.Delete(directory, true);
    }
}
