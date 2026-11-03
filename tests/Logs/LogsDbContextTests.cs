namespace Resonance.Tests.Logs;

using global::resonance.Core.LogStore;
using Microsoft.EntityFrameworkCore;

public class LogsDbContextTests
{
    [Fact]
    public void SqliteSchema_UpgradesExistingLogsWithHistoryIndex()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = new LogsDbContext(LogsTestSupport.Options(connection));
        global::resonance.SqliteSchema.Initialize(context);
        context.Database.ExecuteSqlRaw("DROP INDEX IX_LogEntries_SourceContext_Level_Timestamp");
        context.Database.ExecuteSqlRaw("UPDATE __ResonanceSchema SET Version = 1 WHERE Context = 'LogsDbContext'");

        using var upgraded = new LogsDbContext(LogsTestSupport.Options(connection));
        global::resonance.SqliteSchema.Initialize(upgraded);

        Assert.Equal(1, upgraded.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS Value FROM sqlite_master WHERE type = 'index' AND name = 'IX_LogEntries_SourceContext_Level_Timestamp'").Single());
    }

    // Id is a real GENERATED ALWAYS AS IDENTITY column in Postgres (production) -- verified against
    // the actual dev database, not here. A composite primary key (Id, Timestamp), which Postgres
    // requires on a partitioned table, disables SQLite's single-column autoincrement convention, so
    // Ids are assigned explicitly below; what this test actually covers is that the composite key
    // round-trips distinct rows correctly and that ordering by Id behaves as GET /logs?afterId=
    // depends on.
    [Fact]
    public void Entries_WithDistinctIds_RoundTrip_AndOrderById()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = LogsTestSupport.CreateSchema(connection);

        var first = new LogEntry { Id = 1, Timestamp = DateTime.UtcNow, Level = "Information", Message = "one" };
        var second = new LogEntry { Id = 2, Timestamp = DateTime.UtcNow, Level = "Information", Message = "two" };

        context.Entries.AddRange(second, first); // inserted out of order on purpose
        context.SaveChanges();

        var ordered = context.Entries.OrderBy(e => e.Id).Select(e => e.Message).ToList();
        Assert.Equal(new[] { "one", "two" }, ordered);
    }

    [Fact]
    public void Entries_RoundTripEveryField()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = LogsTestSupport.CreateSchema(connection);

        var timestamp = new DateTime(2026, 8, 1, 12, 30, 0, DateTimeKind.Utc);

        context.Entries.Add(new LogEntry
        {
            Timestamp = timestamp,
            Level = "Error",
            SourceContext = "Transfers / Uploads",
            SubContext = "device-123",
            Message = "upload failed",
            Exception = "System.Exception: boom",
            Properties = """{"RetryCount":3}""",
        });
        context.SaveChanges();

        using var reader = new LogsDbContext(LogsTestSupport.Options(connection));
        var saved = Assert.Single(reader.Entries.ToList());

        Assert.Equal(timestamp, saved.Timestamp);
        Assert.Equal("Error", saved.Level);
        Assert.Equal("Transfers / Uploads", saved.SourceContext);
        Assert.Equal("device-123", saved.SubContext);
        Assert.Equal("upload failed", saved.Message);
        Assert.Equal("System.Exception: boom", saved.Exception);
        Assert.Equal("""{"RetryCount":3}""", saved.Properties);
    }

    [Fact]
    public void Entries_AllowNullOptionalFields()
    {
        using var connection = LogsTestSupport.OpenConnection();
        using var context = LogsTestSupport.CreateSchema(connection);

        context.Entries.Add(new LogEntry { Timestamp = DateTime.UtcNow, Level = "Information", Message = "no extras" });

        // should not throw
        context.SaveChanges();

        var saved = Assert.Single(context.Entries.ToList());
        Assert.Null(saved.SourceContext);
        Assert.Null(saved.SubContext);
        Assert.Null(saved.Exception);
        Assert.Null(saved.Properties);
    }
}
