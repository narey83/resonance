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

    [Fact]
    public void Pending_Pages_Are_Bounded_And_Cover_The_Queue_Without_Changing_Records()
    {
        var sql = new List<string>();
        using var connection = Connect();
        using var context = Context(connection, sql);
        Seed(context, completed: 30, inFlight: 12);
        TransferListQuery.EnsureSqliteIndexes(context);
        var before = context.Transfers.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.State, t.EndedAt }).ToList();
        var ids = new List<Guid>();
        for (var page = 0; page < 3; page++)
        {
            var result = TransferListQuery.ListPage(context, TransferDirection.Upload, false, false, 5, page, 5);
            Assert.Equal(12, result.TotalPending);
            var pending = result.Transfers.Where(t => t.EndedAt is null).ToList();
            Assert.Equal(page == 2 ? 2 : 5, pending.Count);
            Assert.Equal(5, result.Transfers.Count(t => t.EndedAt is not null));
            ids.AddRange(pending.Select(t => t.Id));
        }

        Assert.Equal(12, ids.Distinct().Count());
        Assert.Equal(before, context.Transfers.AsNoTracking().OrderBy(t => t.Id).Select(t => new { t.Id, t.State, t.EndedAt }).ToList());
        Assert.Contains(sql, statement => statement.Contains("LIMIT") && statement.Contains("OFFSET"));
    }

    [Fact]
    public void Pending_Pages_Prioritize_Data_Flow_And_Filter_Removed_And_Other_Directions()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 2, inFlight: 8);
        Seed(context, completed: 1, inFlight: 3, removed: true, prefix: "removed");
        Seed(context, completed: 1, inFlight: 4, direction: TransferDirection.Download, prefix: "download");
        var queued = context.Transfers.Where(t => t.Direction == TransferDirection.Upload && !t.Removed && t.EndedAt == null).ToList();
        foreach (var row in queued) row.State = TransferStates.Queued | TransferStates.Locally;
        queued[0].State = TransferStates.InProgress;
        queued[0].RequestedAt = DateTime.UtcNow;
        context.SaveChanges();
        var first = TransferListQuery.ListPage(context, TransferDirection.Upload, false, true, 5, 0, 1);
        Assert.Equal(8, first.TotalPending);
        Assert.Equal(queued[0].Id, Assert.Single(first.Transfers).Id);
        var removed = TransferListQuery.ListPage(context, TransferDirection.Upload, true, true, 5, 0, 20);
        Assert.Equal(11, removed.TotalPending);
        Assert.Equal(11, removed.Transfers.Count);
        Assert.All(removed.Transfers, t => Assert.Equal(TransferDirection.Upload, t.Direction));
        Assert.Empty(TransferListQuery.ListPage(context, TransferDirection.Upload, false, true, 5, 99, 5).Transfers);
    }

    [Theory]
    [InlineData(-1, 250)]
    [InlineData(0, 0)]
    [InlineData(0, 501)]
    [InlineData(int.MaxValue, 250)]
    public void Pending_Pages_Reject_Invalid_Bounds(int page, int pageSize)
    {
        using var connection = Connect();
        using var context = Context(connection);
        Assert.Throws<ArgumentOutOfRangeException>(() => TransferListQuery.ListPage(context, TransferDirection.Upload, false, false, 5, page, pageSize));
    }

    [Fact]
    public void Status_Counts_The_Whole_Queue_But_Only_Returns_Throughput_Samples()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 30, inFlight: 8);
        Seed(context, completed: 1, inFlight: 3, removed: true, prefix: "removed");
        Seed(context, completed: 1, inFlight: 4, direction: TransferDirection.Download, prefix: "download");
        var waiting = context.Transfers.Where(t => t.Direction == TransferDirection.Upload && !t.Removed && t.EndedAt == null).ToList();
        foreach (var row in waiting) row.State = TransferStates.Queued | TransferStates.Locally;
        waiting[0].State = TransferStates.InProgress;
        waiting[0].BytesTransferred = 42;
        waiting[1].State = TransferStates.Initializing;
        var recent = context.Transfers.First(t => t.Direction == TransferDirection.Upload && !t.Removed && t.EndedAt != null);
        recent.EndedAt = DateTime.UtcNow;
        recent.BytesTransferred = 100;
        context.SaveChanges();
        TransferListQuery.EnsureSqliteIndexes(context);
        var status = TransferListQuery.Status(context, TransferDirection.Upload);
        Assert.Equal(6, status.QueuedCount);
        Assert.Equal(2, status.ActiveCount);
        Assert.Equal(3, status.Transfers.Count);
        Assert.Contains(status.Transfers, t => t.Id == waiting[0].Id && t.BytesTransferred == 42);
        Assert.Contains(status.Transfers, t => t.Id == recent.Id && t.BytesTransferred == 100);
        Assert.DoesNotContain(status.Transfers, t => t.State == (TransferStates.Queued | TransferStates.Locally));
        Assert.Equal(4, TransferListQuery.Status(context, TransferDirection.Download).ActiveCount);
    }

    [Fact]
    public void Status_Recent_History_Is_Bounded_And_Uses_An_Indexed_Time_Range()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 600, inFlight: 0);
        foreach (var row in context.Transfers) row.EndedAt = DateTime.UtcNow;
        context.SaveChanges();
        TransferListQuery.EnsureSqliteIndexes(context);
        Assert.Equal(500, TransferListQuery.Status(context, TransferDirection.Upload).Transfers.Count);
        using var command = connection.CreateCommand();
        command.CommandText = $"EXPLAIN QUERY PLAN SELECT Id,State,BytesTransferred FROM Transfers WHERE Direction='Upload' AND Removed=0 AND ({TransferListQuery.CompletedFlagSql})=1 AND COALESCE(EndedAt,RequestedAt)>=@since ORDER BY COALESCE(EndedAt,RequestedAt) DESC LIMIT 500";
        command.Parameters.AddWithValue("@since", DateTime.UtcNow.AddSeconds(-15));
        using var reader = command.ExecuteReader();
        Assert.True(reader.Read());
        var plan = reader.GetString(3);
        Assert.Contains(TransferListQuery.SqliteListIndex, plan);
        Assert.Contains("SEARCH", plan);
        Assert.Contains(">", plan);
    }

    [Fact]
    public void Recipient_Directory_Covers_The_Whole_Queue_While_Details_Are_Paged_Per_Person()
    {
        var sql = new List<string>();
        using var connection = Connect();
        using var context = Context(connection, sql);
        Seed(context, completed: 30, inFlight: 200);
        Seed(context, completed: 0, inFlight: 1001, prefix: "bob", username: "bob");
        Seed(context, completed: 0, inFlight: 3, removed: true, prefix: "removed");
        Seed(context, completed: 0, inFlight: 7, direction: TransferDirection.Download, prefix: "download");
        var pending = context.Transfers.Where(t => t.Direction == TransferDirection.Upload && !t.Removed && t.EndedAt == null).OrderBy(t => t.Filename).ToList();
        for (var i = 0; i < pending.Count; i++)
        {
            pending[i].State = TransferStates.Queued | TransferStates.Locally;
        }

        pending[0].State = TransferStates.InProgress;
        pending.First(t => t.Username == "alice").State = TransferStates.Initializing;
        context.SaveChanges();
        TransferListQuery.EnsureSqliteIndexes(context);
        var page = TransferListQuery.UploadQueuePage(context, "alice", 1, 50);
        Assert.Equal(1201, page.TotalPending);
        Assert.Equal(200, page.UserTotalPending);
        Assert.Equal(2, page.Users.Count);
        Assert.Equal(1001, page.Users.Single(u => u.Username == "bob").PendingCount);
        Assert.Equal(1000, page.Users.Single(u => u.Username == "bob").WaitingCount);
        Assert.Equal(1, page.Users.Single(u => u.Username == "bob").ActiveCount);
        Assert.Equal(1, page.Users.Single(u => u.Username == "bob").SendingCount);
        Assert.Equal(1, page.Users.Single(u => u.Username == "alice").ActiveCount);
        Assert.Equal(0, page.Users.Single(u => u.Username == "alice").SendingCount);
        Assert.Equal(50, page.Transfers.Count);
        Assert.All(page.Transfers, transfer => Assert.Equal("alice", transfer.Username));
        Assert.DoesNotContain(page.Transfers, transfer => global::resonance.Transfers.TransferStateCategories.Completed.Contains(transfer.State));
        Assert.Contains(sql, statement => statement.Contains("GROUP BY", StringComparison.Ordinal));
        Assert.Equal("bob", TransferListQuery.UploadQueuePage(context, null!, 0, 50).Username);
        Assert.Equal(3, TransferListQuery.UploadQueuePage(context, "alice", 999, 50).Page);
        var missing = TransferListQuery.UploadQueuePage(context, "alice' OR 1=1 --", 0, 50);
        Assert.Empty(missing.Transfers);
        Assert.Equal(0, missing.UserTotalPending);
        Assert.Equal(1201, missing.TotalPending);
    }

    [Fact]
    public void Empty_Recipient_Directory_Does_Not_Load_History()
    {
        using var connection = Connect();
        using var context = Context(connection);
        Seed(context, completed: 20, inFlight: 0);
        var page = TransferListQuery.UploadQueuePage(context, null!, 0, 250);
        Assert.Null(page.Username);
        Assert.Empty(page.Users);
        Assert.Empty(page.Transfers);
        Assert.Equal(0, page.TotalPending);
    }

    private static SqliteConnection Connect()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        return connection;
    }

    private static TransfersDbContext Context(SqliteConnection connection, List<string>? sql = null)
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
        string prefix = "up",
        string username = "alice")
    {
        var start = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        for (var i = 0; i < completed; i++)
        {
            context.Add(new Transfer
            {
                Id = Guid.NewGuid(),
                Username = username,
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
                Username = username,
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
