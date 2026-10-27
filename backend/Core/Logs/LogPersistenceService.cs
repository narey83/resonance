// <copyright file="LogPersistenceService.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │
//   │ This program is free software: you can redistribute it and/or modify
//   │ it under the terms of the GNU Affero General Public License as published
//   │ by the Free Software Foundation, version 3.
//   │
//   │ This program is distributed in the hope that it will be useful,
//   │ but WITHOUT ANY WARRANTY; without even the implied warranty of
//   │ MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//   │ GNU Affero General Public License for more details.
//   │
//   │ You should have received a copy of the GNU Affero General Public License
//   │ along with this program.  If not, see https://www.gnu.org/licenses/.
//   │
//   │ This program is distributed with Additional Terms pursuant to Section 7
//   │ of the AGPLv3.  See the LICENSE file in the root directory of this
//   │ project for the complete terms and conditions.
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Core.LogStore;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Npgsql;
using Serilog;

/// <summary>
///     Drains <see cref="Program.LogEmitted"/> into the configured log database: a bounded, drop-oldest queue between
///     the Serilog emit path and the database (requirement: logging must never block the thread that
///     emitted it), batched inserts (requirement: never one INSERT per event), and periodic partition
///     maintenance (create partitions ahead of need, drop expired ones -- see
///     <see cref="LogPartitioning"/>).
///
///     Deliberately does not replay/retry a batch that fails to persist -- a dropped log event is an
///     acceptable loss; retrying indefinitely against a database that's currently unhappy is how a
///     logging subsystem turns into an amplifier for whatever's already wrong.
/// </summary>
public class LogPersistenceService : BackgroundService
{
    // 5000 in-flight events before the oldest starts getting dropped -- matches the size of the
    // existing in-memory ring buffer (Program.LogBuffer) feeding the live-tail hub, and is large
    // enough to absorb a burst without ever blocking the emitting thread (TryWrite never waits).
    // Internal (not private) so tests can size a queue-saturation scenario against the real value.
    internal const int ChannelCapacity = 5000;

    // "Configurable" here means "not hardcoded to one row per INSERT and easy to change", per the
    // batch-size requirement (100-500) -- these aren't exposed as CLI/env options since nothing
    // outside this file has a reason to tune them.
    internal const int BatchSize = 200;
    internal const int RetentionBatchSize = 1000;
    private static readonly TimeSpan BatchLinger = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan MaintenanceInterval = TimeSpan.FromMinutes(1);
    private static long nextSqliteId = DateTime.UtcNow.Ticks;
    private readonly CancellationTokenSource maintenanceCancellation = new();

    private readonly Channel<LogRecord> channel = Channel.CreateBounded<LogRecord>(new BoundedChannelOptions(ChannelCapacity)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
    });
    private int disposed;

    public LogPersistenceService(
        IDbContextFactory<LogsDbContext> dbContextFactory,
        ConnectionStringDictionary connectionStrings,
        IOptionsMonitor<resonance.Options> options)
    {
        DbContextFactory = dbContextFactory;
        ConnectionStrings = connectionStrings;
        Options = options;
    }

    internal TimeSpan ShutdownFlushTimeout { get; init; } = TimeSpan.FromSeconds(5);

    private IDbContextFactory<LogsDbContext> DbContextFactory { get; }

    private ConnectionStringDictionary ConnectionStrings { get; }

    private IOptionsMonitor<resonance.Options> Options { get; }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Database);

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted += OnLogEmitted;
        return base.StartAsync(cancellationToken);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted -= OnLogEmitted;
        channel.Writer.TryComplete();
        maintenanceCancellation.Cancel();

        // The host deadline may already have expired while other services stopped. Give the
        // queued and in-flight log batches their own bounded window before cancelling the writer.
        using var flushDeadline = new CancellationTokenSource(ShutdownFlushTimeout);
        try
        {
            if (ExecuteTask is not null)
            {
                await ExecuteTask.WaitAsync(flushDeadline.Token);
            }
        }
        catch (OperationCanceledException) when (flushDeadline.IsCancellationRequested)
        {
            Log.Warning("Timed out draining database log entries after {Seconds} seconds; some entries may not have been persisted", ShutdownFlushTimeout.TotalSeconds);
        }
        finally
        {
            // Only cancel background writes after the drain has finished or its real deadline elapsed.
            await base.StopAsync(flushDeadline.Token);
        }
    }

    public override void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }

        Program.LogEmitted -= OnLogEmitted;
        channel.Writer.TryComplete();
        maintenanceCancellation.Cancel();
        base.Dispose();
        maintenanceCancellation.Dispose();
    }

    // Never blocks: TryWrite on a bounded DropOldest channel always succeeds, evicting the oldest
    // queued record if full rather than waiting for room. Internal (not private) so tests can drive
    // the queue/batching behavior directly, without needing to go through the real static
    // Program.LogEmitted event to do it.
    internal void Enqueue(LogRecord record) => channel.Writer.TryWrite(record);

    internal async Task<int> PruneSqliteBatchAsync(DateTime cutoff, CancellationToken stoppingToken)
    {
        await using var context = await DbContextFactory.CreateDbContextAsync(stoppingToken);
        return await context.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "LogEntries" WHERE ("Timestamp","Id") IN (
                SELECT "Timestamp","Id" FROM "LogEntries"
                WHERE "Timestamp" < {cutoff}
                ORDER BY "Timestamp","Id" LIMIT {RetentionBatchSize})
            """, stoppingToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var maintenance = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken, maintenanceCancellation.Token);
        await RunPartitionMaintenanceAsync(maintenance.Token);
        var lastMaintenance = DateTime.UtcNow;

        while (!stoppingToken.IsCancellationRequested)
        {
            List<LogRecord> batch;

            try
            {
                batch = await ReadBatchAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            if (batch.Count > 0)
            {
                await InsertBatchAsync(batch, stoppingToken);
            }
            else if (channel.Reader.Completion.IsCompleted)
            {
                break;
            }

            if (!maintenance.IsCancellationRequested && DateTime.UtcNow - lastMaintenance > MaintenanceInterval)
            {
                await RunPartitionMaintenanceAsync(maintenance.Token);
                lastMaintenance = DateTime.UtcNow;
            }
        }
    }

    private static LogEntry ToEntry(LogRecord record) => new()
    {
        Timestamp = record.Timestamp,
        Level = Truncate(record.Level, 20),
        SourceContext = Truncate(record.Context, 200),
        SubContext = Truncate(record.SubContext, 200),
        Message = record.Message,
        Exception = record.Exception,
        Properties = record.Properties,
    };

    // A value beyond its column's max length would fail that one row's INSERT and, since the whole
    // batch is one SaveChangesAsync, take every other row in the batch down with it. Context/level
    // values are bounded by the Logs registry in practice, but SubContext can carry a username or
    // hostname supplied indirectly by something outside this app's control -- truncate defensively
    // rather than let one long value poison an otherwise-good batch.
    private static string Truncate(string value, int maxLength) =>
        value is null || value.Length <= maxLength ? value : value[..maxLength];

    /// <summary>
    ///     Reads up to <see cref="BatchSize"/> records, waiting up to <see cref="BatchLinger"/> past
    ///     the first one for more to arrive -- batches by size OR time, whichever comes first. Without
    ///     the time bound, a quiet period would mean one-row "batches" (an insert per event, exactly
    ///     what batching exists to avoid); without the size bound, a sustained burst would mean
    ///     unbounded batches and unbounded insert latency.
    /// </summary>
    private async Task<List<LogRecord>> ReadBatchAsync(CancellationToken stoppingToken)
    {
        var batch = new List<LogRecord>(BatchSize);

        LogRecord first;
        using var maintenanceCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        maintenanceCts.CancelAfter(MaintenanceInterval);
        try
        {
            if (!await channel.Reader.WaitToReadAsync(maintenanceCts.Token) || !channel.Reader.TryRead(out first))
            {
                return batch;
            }
        }
        catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
        {
            // Let the outer loop run retention even when logging is completely quiet.
            return batch;
        }

        batch.Add(first);

        var deadline = DateTime.UtcNow + BatchLinger;

        while (batch.Count < BatchSize)
        {
            if (channel.Reader.TryRead(out var next))
            {
                batch.Add(next);
                continue;
            }

            var remaining = deadline - DateTime.UtcNow;

            if (remaining <= TimeSpan.Zero)
            {
                break;
            }

            using var lingerCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
            lingerCts.CancelAfter(remaining);

            try
            {
                if (!await channel.Reader.WaitToReadAsync(lingerCts.Token))
                {
                    break;
                }
            }
            catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested)
            {
                break; // linger deadline elapsed, not a real cancellation
            }
        }

        return batch;
    }

    private async Task InsertBatchAsync(List<LogRecord> batch, CancellationToken stoppingToken)
    {
        try
        {
            await using var context = await DbContextFactory.CreateDbContextAsync(stoppingToken);

            // Pure inserts of untracked entities -- nothing here needs change detection.
            context.ChangeTracker.AutoDetectChangesEnabled = false;
            var entries = batch.ConvertAll(ToEntry);
            if (!ConnectionStrings.UsePostgres)
            {
                // SQLite cannot auto-generate one component of this composite key.
                // Concurrent log events can share a timestamp; keep every event distinct.
                foreach (var entry in entries)
                {
                    entry.Id = Interlocked.Increment(ref nextSqliteId);
                }
            }

            context.Entries.AddRange(entries);

            await context.SaveChangesAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            Log.Warning("Failed to persist {Count} log entries to the database: {Message}", batch.Count, ex.Message);
        }
    }

    private async Task RunPartitionMaintenanceAsync(CancellationToken stoppingToken)
    {
        try
        {
            if (!ConnectionStrings.UsePostgres)
            {
                var retention = Options.CurrentValue.Retention;
                var now = DateTime.UtcNow;
                for (var batch = 0; batch < 32; batch++)
                {
                    await using var db = await DbContextFactory.CreateDbContextAsync(stoppingToken);
                    var count = await LogRollupStore.CompactBatchAsync(
                        db, now.AddDays(-retention.Logs),
                        now.AddDays(-Math.Max(retention.Logs, retention.WarningLogs)),
                        now.AddDays(-Math.Max(retention.Logs, retention.ErrorLogs)),
                        now.AddDays(-retention.LogSummaries), stoppingToken);
                    if (count < RetentionBatchSize)
                    {
                        var legacyExists = await db.Database.SqlQueryRaw<long>(
                            "SELECT COUNT(*) AS \"Value\" FROM sqlite_master WHERE type='table' AND name='legacy_public_LogEntries'").SingleAsync(stoppingToken);
                        if (legacyExists != 0)
                        {
                            count += await LogRollupStore.CompactBatchAsync(
                                db, now.AddDays(-retention.Logs),
                                now.AddDays(-Math.Max(retention.Logs, retention.WarningLogs)),
                                now.AddDays(-Math.Max(retention.Logs, retention.ErrorLogs)),
                                now.AddDays(-retention.LogSummaries), stoppingToken, legacy: true);
                        }
                    }

                    if (count < RetentionBatchSize)
                    {
                        break;
                    }

                    await Task.Delay(TimeSpan.FromMilliseconds(50), stoppingToken);
                }

                return;
            }

            await using var connection = new NpgsqlConnection(ConnectionStrings[Database.Logs]);
            await connection.OpenAsync(stoppingToken);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);

            foreach (var (year, month) in LogPartitioning.RequiredPartitions(today))
            {
                LogsSchemaInitializer.EnsurePartition(connection, year, month);
            }

            var retentionDays = Options.CurrentValue.Retention.Logs;

            if (retentionDays > 0)
            {
                var existing = LogsSchemaInitializer.GetExistingPartitionNames(connection);
                var expired = LogPartitioning.ExpiredPartitions(existing, DateTime.UtcNow, retentionDays);

                foreach (var name in expired)
                {
                    LogsSchemaInitializer.DropPartition(connection, name);
                    Log.Information("Dropped expired log partition {Partition}", name);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Retention is background housekeeping; final writes have priority during shutdown.
        }
        catch (Exception ex)
        {
            Log.Warning("Log partition maintenance failed: {Message}", ex.Message);
        }
    }

    private void OnLogEmitted(object sender, LogRecord record) => Enqueue(record);
}
