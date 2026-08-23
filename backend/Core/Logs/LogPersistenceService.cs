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
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Npgsql;
using Serilog;

/// <summary>
///     Drains <see cref="Program.LogEmitted"/> into PostgreSQL: a bounded, drop-oldest queue between
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
    private static readonly TimeSpan BatchLinger = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan MaintenanceInterval = TimeSpan.FromHours(1);

    private readonly Channel<LogRecord> channel = Channel.CreateBounded<LogRecord>(new BoundedChannelOptions(ChannelCapacity)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
    });

    public LogPersistenceService(
        IDbContextFactory<LogsDbContext> dbContextFactory,
        ConnectionStringDictionary connectionStrings,
        IOptionsMonitor<resonance.Options> options)
    {
        DbContextFactory = dbContextFactory;
        ConnectionStrings = connectionStrings;
        Options = options;
    }

    private IDbContextFactory<LogsDbContext> DbContextFactory { get; }

    private ConnectionStringDictionary ConnectionStrings { get; }

    private IOptionsMonitor<resonance.Options> Options { get; }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Database);

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted += OnLogEmitted;
        return base.StartAsync(cancellationToken);
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted -= OnLogEmitted;
        channel.Writer.TryComplete();
        return base.StopAsync(cancellationToken);
    }

    // Never blocks: TryWrite on a bounded DropOldest channel always succeeds, evicting the oldest
    // queued record if full rather than waiting for room. Internal (not private) so tests can drive
    // the queue/batching behavior directly, without needing to go through the real static
    // Program.LogEmitted event to do it.
    internal void Enqueue(LogRecord record) => channel.Writer.TryWrite(record);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunPartitionMaintenanceAsync(stoppingToken);
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

            if (DateTime.UtcNow - lastMaintenance > MaintenanceInterval)
            {
                await RunPartitionMaintenanceAsync(stoppingToken);
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

        if (!await channel.Reader.WaitToReadAsync(stoppingToken) || !channel.Reader.TryRead(out var first))
        {
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
            context.Entries.AddRange(batch.ConvertAll(ToEntry));

            await context.SaveChangesAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            Log.Warning("Failed to persist {Count} log entries to Postgres: {Message}", batch.Count, ex.Message);
        }
    }

    private async Task RunPartitionMaintenanceAsync(CancellationToken stoppingToken)
    {
        try
        {
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
        catch (Exception ex)
        {
            Log.Warning("Log partition maintenance failed: {Message}", ex.Message);
        }
    }

    private void OnLogEmitted(object sender, LogRecord record) => Enqueue(record);
}
