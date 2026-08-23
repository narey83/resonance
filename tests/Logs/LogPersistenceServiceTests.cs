namespace Resonance.Tests.Logs;

using System.Diagnostics;
using Microsoft.Data.Sqlite;
using global::resonance;
using global::resonance.Core.LogStore;

public class LogPersistenceServiceTests
{
    // Postgres genuinely auto-generates a unique Id for every row (GENERATED ALWAYS AS IDENTITY);
    // SQLite does not for a composite key (see LogsDbContextTests), so every row here keeps its
    // CLR-default Id of 0. That makes Timestamp the only thing distinguishing rows under the
    // composite (Id, Timestamp) primary key -- DateTime.UtcNow's real clock resolution repeats
    // often enough in a tight/concurrent loop to collide and take a whole batch down with it
    // (SaveChangesAsync fails atomically). A monotonically increasing synthetic timestamp sidesteps
    // that SQLite-testing-only artifact entirely, without masking anything about production.
    private static long timestampTicks;

    private static DateTime NextTimestamp() =>
        new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddTicks(Interlocked.Increment(ref timestampTicks));

    private static LogPersistenceService NewService(SqliteConnection connection)
    {
        var options = LogsTestSupport.Options(connection);

        using (var seed = new LogsDbContext(options))
        {
            seed.Database.EnsureCreated();
        }

        var factory = new LogsTestSupport.TestDbContextFactory(options);
        return new LogPersistenceService(factory, LogsTestSupport.FakeConnectionStrings(), LogsTestSupport.OptionsMonitor());
    }

    private static int CountRows(SqliteConnection connection)
    {
        using var context = new LogsDbContext(LogsTestSupport.Options(connection));
        return context.Entries.Count();
    }

    private static async Task WaitUntilAsync(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(25);
        }

        Assert.Fail($"Condition was not met within {timeout}.");
    }

    [Fact]
    public async Task Enqueued_Records_AreEventuallyPersisted()
    {
        using var connection = LogsTestSupport.OpenConnection();
        var service = NewService(connection);

        await service.StartAsync(CancellationToken.None);
        try
        {
            for (var i = 0; i < 5; i++)
            {
                service.Enqueue(new LogRecord { Timestamp = NextTimestamp(), Level = "Information", Message = $"m{i}" });
            }

            await WaitUntilAsync(() => CountRows(connection) == 5, TimeSpan.FromSeconds(5));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.Equal(5, CountRows(connection));
    }

    [Fact]
    public async Task ABurstLargerThanOneBatch_IsFullyPersisted_AcrossMultipleBatches()
    {
        using var connection = LogsTestSupport.OpenConnection();
        var service = NewService(connection);

        // More than one BatchSize's worth, so this only passes if the drain loop keeps reading
        // and inserting batch after batch rather than handling just the first one.
        const int count = (LogPersistenceService.BatchSize * 2) + 50;

        await service.StartAsync(CancellationToken.None);
        try
        {
            for (var i = 0; i < count; i++)
            {
                service.Enqueue(new LogRecord { Timestamp = NextTimestamp(), Level = "Information", Message = $"m{i}" });
            }

            await WaitUntilAsync(() => CountRows(connection) == count, TimeSpan.FromSeconds(15));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.Equal(count, CountRows(connection));
    }

    [Fact]
    public async Task ConcurrentProducers_AllLandInTheDatabase_WithNoLossUnderCapacity()
    {
        using var connection = LogsTestSupport.OpenConnection();
        var service = NewService(connection);

        const int producers = 8;
        const int perProducer = 100; // 800 total, comfortably under ChannelCapacity (5000)

        await service.StartAsync(CancellationToken.None);
        try
        {
            var tasks = Enumerable.Range(0, producers).Select(p => Task.Run(() =>
            {
                for (var i = 0; i < perProducer; i++)
                {
                    service.Enqueue(new LogRecord { Timestamp = NextTimestamp(), Level = "Information", Message = $"p{p}-{i}" });
                }
            }));

            await Task.WhenAll(tasks);

            await WaitUntilAsync(() => CountRows(connection) == producers * perProducer, TimeSpan.FromSeconds(15));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.Equal(producers * perProducer, CountRows(connection));
    }

    [Fact]
    public async Task Enqueue_UnderQueueSaturation_NeverBlocks_AndDropsOnlyTheOldest()
    {
        using var connection = LogsTestSupport.OpenConnection();
        var service = NewService(connection);

        const int overflow = 500;
        const int total = LogPersistenceService.ChannelCapacity + overflow;

        // Deliberately not started yet -- nothing is draining the channel, so this exercises pure
        // producer-side saturation: every one of these calls has to complete on its own, with a
        // full, never-consumed queue behind it.
        var stopwatch = Stopwatch.StartNew();

        for (var i = 0; i < total; i++)
        {
            service.Enqueue(new LogRecord { Timestamp = NextTimestamp(), Level = "Information", Message = $"m{i}" });
        }

        stopwatch.Stop();

        // TryWrite on a bounded DropOldest channel never waits for room -- this should finish
        // near-instantly regardless of capacity. A generous bound catches a regression back to a
        // blocking write without being sensitive to normal machine/CI slowness.
        Assert.True(
            stopwatch.Elapsed < TimeSpan.FromSeconds(5),
            $"Enqueueing {total} records took {stopwatch.Elapsed}, expected near-instant (must never block the caller).");

        await service.StartAsync(CancellationToken.None);
        try
        {
            await WaitUntilAsync(() => CountRows(connection) == LogPersistenceService.ChannelCapacity, TimeSpan.FromSeconds(15));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        using var reader = new LogsDbContext(LogsTestSupport.Options(connection));

        // Ordered by Timestamp, not Id -- every row's Id is the same CLR-default 0 here (see the
        // class-level remark on NextTimestamp), so Timestamp is what actually reflects send order.
        var messages = reader.Entries.OrderBy(e => e.Timestamp).Select(e => e.Message).ToList();

        Assert.Equal(LogPersistenceService.ChannelCapacity, messages.Count);

        // DropOldest evicts from the front: the first `overflow` records sent should be gone, and
        // everything from that point through the last one sent should have survived.
        Assert.Equal($"m{overflow}", messages[0]);
        Assert.Equal($"m{total - 1}", messages[^1]);
        Assert.DoesNotContain("m0", messages);
        Assert.DoesNotContain($"m{overflow - 1}", messages);
    }

    [Fact]
    public async Task PartitionMaintenanceFailure_DoesNotPreventBatchInsertion()
    {
        // RunPartitionMaintenanceAsync opens a raw NpgsqlConnection against the fake connection
        // string used here and will fail every time -- StartAsync runs it once immediately. This
        // proves that failure is caught and logged rather than taking the drain loop down with it,
        // since ordinary insertion has to keep working regardless.
        using var connection = LogsTestSupport.OpenConnection();
        var service = NewService(connection);

        await service.StartAsync(CancellationToken.None);
        try
        {
            service.Enqueue(new LogRecord { Timestamp = NextTimestamp(), Level = "Information", Message = "still works" });
            await WaitUntilAsync(() => CountRows(connection) == 1, TimeSpan.FromSeconds(5));
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        Assert.Equal(1, CountRows(connection));
    }
}
