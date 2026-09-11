namespace Resonance.Tests.Logs;

using global::resonance;
using global::resonance.Core.LogStore;

public class LogQueryServiceTests
{
    private static LogEntry Entry(long id, string timestamp, string level, string message, string context = "Application") => new()
    {
        Id = id,
        Timestamp = DateTime.Parse(timestamp).ToUniversalTime(),
        Level = level,
        SourceContext = context,
        Message = message,
    };

    private static LogsDbContext Seed(Microsoft.Data.Sqlite.SqliteConnection connection, params LogEntry[] entries)
    {
        var context = LogsTestSupport.CreateSchema(connection);
        context.Entries.AddRange(entries);
        context.SaveChanges();
        return context;
    }

    // Thin wrapper so call sites can pass C#'s bare `null` for unused filter args without
    // triggering CS8625 against LogQueryService.QueryAsync's non-nullable parameter types.
    private static Task<(List<LogRecord> Items, int Total)> Query(
        LogsDbContext context, long? afterId, string[]? levels = null, string[]? contexts = null, string? search = null,
        DateTime? from = null, DateTime? to = null, int offset = 0, int limit = 100) =>
        LogQueryService.QueryAsync(context, afterId, levels!, contexts!, search!, from, to, offset, limit);

    [Fact]
    public async Task QueryAsync_AfterId_ReturnsOnlyNewerRecords_InAscendingIdOrder()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "one"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "two"),
            Entry(3, "2026-08-01T00:00:02Z", "Information", "three"));

        var (items, total) = await Query(
            context, afterId: 1, levels: null, contexts: null, search: null, from: null, to: null, offset: 0, limit: 100);

        Assert.Equal(2, total);
        Assert.Equal(new[] { "two", "three" }, items.Select(i => i.Message)); // ascending, per requirement 7
        Assert.Equal(new long?[] { 2, 3 }, items.Select(i => i.Id));
    }

    [Fact]
    public async Task QueryAsync_AfterId_RespectsLimit()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "one"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "two"),
            Entry(3, "2026-08-01T00:00:02Z", "Information", "three"));

        var (items, _) = await Query(
            context, afterId: 0, levels: null, contexts: null, search: null, from: null, to: null, offset: 0, limit: 2);

        Assert.Equal(new[] { "one", "two" }, items.Select(i => i.Message));
    }

    [Fact]
    public async Task QueryAsync_WithoutAfterId_ReturnsNewestFirst_WithLowerBoundTotal()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "one"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "two"),
            Entry(3, "2026-08-01T00:00:02Z", "Information", "three"));

        var (items, total) = await Query(
            context, afterId: null, levels: null, contexts: null, search: null, from: null, to: null, offset: 0, limit: 100);

        Assert.Equal(3, total);
        Assert.Equal(new[] { "three", "two", "one" }, items.Select(i => i.Message));
    }

    [Fact]
    public async Task QueryAsync_Offset_PaginatesTheHistoricalPath()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "one"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "two"),
            Entry(3, "2026-08-01T00:00:02Z", "Information", "three"));

        var (page1, total1) = await Query(
            context, afterId: null, levels: null, contexts: null, search: null, from: null, to: null, offset: 0, limit: 2);
        var (page2, total2) = await Query(
            context, afterId: null, levels: null, contexts: null, search: null, from: null, to: null, offset: 2, limit: 2);

        Assert.Equal(3, total1);
        Assert.Equal(3, total2);
        Assert.Equal(new[] { "three", "two" }, page1.Select(i => i.Message));
        Assert.Equal(new[] { "one" }, page2.Select(i => i.Message));
    }

    [Fact]
    public async Task QueryAsync_FiltersByLevel()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "info one"),
            Entry(2, "2026-08-01T00:00:01Z", "Error", "error one"));

        var (items, total) = await Query(
            context, afterId: null, levels: new[] { "Error" }, contexts: null, search: null, from: null, to: null, offset: 0, limit: 100);

        Assert.Equal(1, total);
        Assert.Equal("error one", Assert.Single(items).Message);
    }

    [Fact]
    public async Task QueryAsync_FiltersByContext()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "a", "Transfers / Uploads"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "b", "Shares / Scan"));

        var (items, _) = await Query(
            context, afterId: null, levels: null, contexts: new[] { "Shares / Scan" }, search: null, from: null, to: null, offset: 0, limit: 100);

        Assert.Equal("b", Assert.Single(items).Message);
    }

    [Fact]
    public async Task QueryAsync_FiltersByDateRange()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "early"),
            Entry(2, "2026-08-02T00:00:00Z", "Information", "middle"),
            Entry(3, "2026-08-03T00:00:00Z", "Information", "late"));

        var (items, total) = await Query(
            context, afterId: null, levels: null, contexts: null, search: null,
            from: DateTime.Parse("2026-08-01T12:00:00Z").ToUniversalTime(),
            to: DateTime.Parse("2026-08-02T12:00:00Z").ToUniversalTime(),
            offset: 0, limit: 100);

        Assert.Equal(1, total);
        Assert.Equal("middle", Assert.Single(items).Message);
    }

    [Fact]
    public async Task QueryAsync_Search_MatchesSubstring()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "download started"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "share scan complete"));

        var (items, _) = await Query(
            context, afterId: null, levels: null, contexts: null, search: "started", from: null, to: null, offset: 0, limit: 100);

        Assert.Equal("download started", Assert.Single(items).Message);
    }

    [Fact]
    public async Task QueryAsync_Search_TreatsWildcardCharactersLiterally()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(
            connection,
            Entry(1, "2026-08-01T00:00:00Z", "Information", "progress: 50% complete"),
            Entry(2, "2026-08-01T00:00:01Z", "Information", "progress: XX complete"));

        // A literal '%' in the search text must not act as a SQL wildcard -- only the row that
        // actually contains "50%" should match, not everything with "complete".
        var (items, total) = await Query(
            context, afterId: null, levels: null, contexts: null, search: "50%", from: null, to: null, offset: 0, limit: 100);

        Assert.Equal(1, total);
        Assert.Equal("progress: 50% complete", Assert.Single(items).Message);
    }

    [Fact]
    public async Task QueryAsync_ReturnsEmpty_WhenNothingMatches()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = Seed(connection, Entry(1, "2026-08-01T00:00:00Z", "Information", "one"));

        var (items, total) = await Query(
            context, afterId: null, levels: new[] { "Error" }, contexts: null, search: null, from: null, to: null, offset: 0, limit: 100);

        Assert.Empty(items);
        Assert.Equal(0, total);
    }
}
