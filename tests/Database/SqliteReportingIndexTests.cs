namespace Resonance.Tests.Database;

using global::resonance;
using global::resonance.Transfers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Dapper;

public class SqliteReportingIndexTests
{
    [Fact]
    public void ExistingVersionOneGetsReportingIndexAndKeepsBothIndexes()
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection).Options;
        using var context = new TransfersDbContext(options);
        SqliteSchema.Initialize(context);
        Assert.Equal(3, connection.ExecuteScalar<int>("SELECT Version FROM __ResonanceSchema WHERE Context='TransfersDbContext'"));
        Assert.Equal(2, connection.ExecuteScalar<int>("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('IX_Transfers_ReportWindow','IDX_Transfers_Heatmap')"));
        connection.Execute("DROP INDEX IX_Transfers_ReportWindow; UPDATE __ResonanceSchema SET Version=1 WHERE Context='TransfersDbContext'");
        var id = Guid.NewGuid();
        context.Transfers.Add(new Transfer { Id = id, Username = "index-test", Filename = "track.flac", RequestedAt = DateTime.UtcNow, EndedAt = DateTime.UtcNow, State = Soulseek.TransferStates.Completed | Soulseek.TransferStates.Succeeded });
        context.SaveChanges();
        var before = connection.ExecuteScalar<long>("SELECT count(*) FROM Transfers");
        SqliteSchema.Initialize(context);
        SqliteSchema.Initialize(context);
        Assert.Equal(1, before);
        Assert.Equal(before, connection.ExecuteScalar<long>("SELECT count(*) FROM Transfers"));
        Assert.Equal("index-test", context.Transfers.Single().Username);
        Assert.Equal(3, connection.ExecuteScalar<int>("SELECT Version FROM __ResonanceSchema WHERE Context='TransfersDbContext'"));
        var plan = string.Join(" ", connection.Query("EXPLAIN QUERY PLAN SELECT count(*) FROM Transfers WHERE EndedAt >= '2026-10-26'").Select(row => (string)row.detail));
        Assert.Contains("IX_Transfers_ReportWindow", plan);
        Assert.Contains("SEARCH", plan);
    }
    [Fact]
    public void PostgresModelRetainsSeparateReportAndHeatmapIndexes()
    {
        var options = new DbContextOptionsBuilder<TransfersDbContext>().UseNpgsql("Host=localhost;Database=report_index_test;Username=test;Password=test").Options;
        using var context = new TransfersDbContext(options);
        var script = context.Database.GenerateCreateScript();
        Assert.Contains("CREATE INDEX \"IDX_Transfers_Reports\"", script);
        Assert.Contains("CREATE INDEX \"IDX_Transfers_Heatmap\"", script);
    }

}
