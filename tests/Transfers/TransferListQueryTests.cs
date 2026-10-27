namespace Resonance.Tests.Transfers;

using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Soulseek;
using Transfer = global::resonance.Transfers.Transfer;
using TransferListQuery = global::resonance.Transfers.TransferListQuery;
using TransfersDbContext = global::resonance.Transfers.TransfersDbContext;

/// <summary>
///     Covers the capped transfer listing. The point of it is that the cap reaches the database: the
///     uploads endpoint used to fetch every live row (143,458 rows / 37MB on the production instance)
///     and then keep 500 of them in memory. A test that only checked the returned rows would pass just
///     as happily against the old in-memory trim, so the generated SQL is asserted on too.
/// </summary>
public class TransferListQueryTests
{
    private const int MaxCompleted = 5;

    [Fact]
    public void Startup_Recovery_Uses_Sparse_Index_And_Preserves_Dangling_Record_Semantics()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 30, inFlight: 1);
        Seed(context, completed: 2, inFlight: 1, removed: true, prefix: "removed");
        var missingEnd = context.Transfers.First(t => t.EndedAt != null);
        missingEnd.EndedAt = null;
        context.SaveChanges();
        TransferListQuery.EnsureSqliteIndexes(context);
        // Give SQLite the same selectivity statistics as the deployed archive; tiny unanalysed
        // fixtures can choose another Direction index because every B-tree fits on one page.
        context.Database.ExecuteSqlRaw("ANALYZE");
        var result = TransferListQuery.ListForRecovery(context, TransferDirection.Upload);
        Assert.Equal(3, result.Count);
        Assert.Contains(result, transfer => transfer.Id == missingEnd.Id);
        Assert.Contains(result, transfer => transfer.Removed);
        using var command = connection.CreateCommand();
        command.CommandText = $"EXPLAIN QUERY PLAN SELECT * FROM \"Transfers\" WHERE \"Direction\"='Upload' AND ({TransferListQuery.RecoveryPredicateSql})";
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        Assert.Contains(TransferListQuery.SqliteRecoveryIndex, reader.GetString(3));
    }

    [Fact]
    public void Sqlite_Queue_And_Finished_Queries_Use_The_Composite_Index_Without_Sorting_History()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 50, inFlight: 3);
        TransferListQuery.EnsureSqliteIndexes(context);
        foreach (var terminal in new[] { 0, 1 })
        {
            using var command = connection.CreateCommand();
            command.CommandText = $"EXPLAIN QUERY PLAN SELECT * FROM \"Transfers\" WHERE \"Direction\"='Upload' AND \"Removed\"=0 AND ({TransferListQuery.CompletedFlagSql})={terminal}" +
                (terminal == 1 ? " ORDER BY COALESCE(\"EndedAt\",\"RequestedAt\") DESC LIMIT 500" : "");
            using var reader = command.ExecuteReader();
            var plan = new List<string>();
            while (reader.Read()) plan.Add(reader.GetString(3));
            Assert.Contains(plan, line => line.Contains("SEARCH") && line.Contains(TransferListQuery.SqliteListIndex));
            Assert.DoesNotContain(plan, line => line.Contains("TEMP B-TREE"));
        }
    }

    [Fact]
    public void Caps_Finished_Transfers_In_The_Query_Not_In_Memory()
    {
        var sql = new List<string>();
        using var connection = Connect();
        using var context = Context(connection, sql);

        Seed(context, completed: 50, inFlight: 3);

        TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: false, activeOnly: false, MaxCompleted);

        // If the cap were applied after loading, the finished-transfer query would have no LIMIT.
        var capped = sql.Where(s => s.Contains("ORDER BY", StringComparison.Ordinal)).ToList();

        Assert.NotEmpty(capped);
        Assert.All(capped, s => Assert.Contains("LIMIT", s, StringComparison.Ordinal));
    }

    [Fact]
    public void Returns_Every_In_Flight_Transfer_And_Only_The_Newest_Finished_Ones()
    {
        using var connection = Connect();
        using var context = Context(connection);

        Seed(context, completed: 50, inFlight: 12);

        var result = TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: false, activeOnly: false, MaxCompleted);

        var finished = result.Where(t => t.EndedAt is not null).ToList();
        var live = result.Where(t => t.EndedAt is null).ToList();

        // In-flight transfers are never dropped, however many there are.
        Assert.Equal(12, live.Count);
        Assert.Equal(MaxCompleted, finished.Count);

        // Newest first: the seed ends transfer i at (base + i minutes), so the last five win.
        Assert.Equal(
            new[] { 49, 48, 47, 46, 45 },
            finished.OrderByDescending(t => t.EndedAt).Select(SeedIndex).ToArray());
    }

    [Fact]
    public void ActiveOnly_Omits_Finished_Transfers_Entirely()
    {
        using var connection = Connect();
        using var context = Context(connection);

        Seed(context, completed: 50, inFlight: 4);

        var result = TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: false, activeOnly: true, MaxCompleted);

        Assert.Equal(4, result.Count);
        Assert.All(result, t => Assert.Null(t.EndedAt));
    }

    [Fact]
    public void Excludes_Removed_Transfers_Unless_Asked_For()
    {
        using var connection = Connect();
        using var context = Context(connection);

        Seed(context, completed: 3, inFlight: 0, removed: true);
        Seed(context, completed: 2, inFlight: 0, prefix: "kept");

        var without = TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: false, activeOnly: false, MaxCompleted);
        var with = TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: true, activeOnly: false, MaxCompleted);

        Assert.Equal(2, without.Count);
        Assert.Equal(5, with.Count);
    }

    [Fact]
    public void Does_Not_Mix_Directions()
    {
        using var connection = Connect();
        using var context = Context(connection);

        Seed(context, completed: 3, inFlight: 1);
        Seed(context, completed: 3, inFlight: 1, direction: TransferDirection.Download, prefix: "down");

        var uploads = TransferListQuery.ListCapped(context, TransferDirection.Upload, includeRemoved: false, activeOnly: false, MaxCompleted);

        Assert.Equal(4, uploads.Count);
        Assert.All(uploads, t => Assert.Equal(TransferDirection.Upload, t.Direction));
    }

    // "up-49.mp3" -> 49
    private static int SeedIndex(Transfer transfer) =>
        int.Parse(transfer.Filename.Split('-')[^1].Replace(".mp3", string.Empty));

    private static SqliteConnection Connect()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        return connection;
    }

    private static TransfersDbContext Context(SqliteConnection connection, List<string> sql = null)
    {
        var builder = new DbContextOptionsBuilder<TransfersDbContext>().UseSqlite(connection);

        if (sql is not null)
        {
            builder.LogTo(sql.Add, Microsoft.Extensions.Logging.LogLevel.Information);
        }

        var context = new TransfersDbContext(builder.Options);
        context.Database.EnsureCreated();
        return context;
    }

    private static void Seed(
        TransfersDbContext context,
        int completed,
        int inFlight,
        TransferDirection direction = TransferDirection.Upload,
        bool removed = false,
        string prefix = "up")
    {
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        for (var i = 0; i < completed; i++)
        {
            context.Add(new Transfer
            {
                Id = Guid.NewGuid(),
                Username = "alice",
                Direction = direction,
                Filename = $"{prefix}-{i}.mp3",
                RequestedAt = start,
                StartedAt = start,
                EndedAt = start.AddMinutes(i),
                State = TransferStates.Completed | TransferStates.Succeeded,
                StateDescription = "Completed, Succeeded",
                Removed = removed,
            });
        }

        for (var i = 0; i < inFlight; i++)
        {
            context.Add(new Transfer
            {
                Id = Guid.NewGuid(),
                Username = "alice",
                Direction = direction,
                Filename = $"{prefix}-live-{i}.mp3",
                RequestedAt = start,
                State = TransferStates.InProgress,
                Removed = removed,
            });
        }

        context.SaveChanges();
    }
}
