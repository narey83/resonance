// <copyright file="LogPersistenceService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
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
using Serilog;

public class LogPersistenceService : BackgroundService
{
    private static readonly BoundedChannelOptions ChannelOptions = new(5000)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = true,
    };

    private readonly Channel<LogRecord> _channel = Channel.CreateBounded<LogRecord>(ChannelOptions);

    public LogPersistenceService(IDbContextFactory<LogsDbContext> dbContextFactory, IOptionsMonitor<resonance.Options> options)
    {
        DbContextFactory = dbContextFactory;
        Options = options;
    }

    private IDbContextFactory<LogsDbContext> DbContextFactory { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Database);
    private IOptionsMonitor<resonance.Options> Options { get; }

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted += OnLogEmitted;
        return base.StartAsync(cancellationToken);
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        Program.LogEmitted -= OnLogEmitted;
        _channel.Writer.TryComplete();
        return base.StopAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunRetentionAsync();

        var batch = new List<LogEntry>(50);
        var lastRetention = DateTime.UtcNow;

        await foreach (var record in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            batch.Add(ToEntry(record));

            while (batch.Count < 50 && _channel.Reader.TryRead(out var next))
                batch.Add(ToEntry(next));

            try
            {
                await using var ctx = await DbContextFactory.CreateDbContextAsync(stoppingToken);
                await ctx.LogEntries.AddRangeAsync(batch, stoppingToken);
                await ctx.SaveChangesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to persist {Count} log entries: {Message}", batch.Count, ex.Message);
            }

            batch.Clear();

            if (DateTime.UtcNow - lastRetention > TimeSpan.FromHours(6))
            {
                await RunRetentionAsync();
                lastRetention = DateTime.UtcNow;
            }
        }
    }

    private void OnLogEmitted(object _, LogRecord record)
    {
        _channel.Writer.TryWrite(record);
    }

    private async Task RunRetentionAsync()
    {
        var days = Options.CurrentValue.Retention.Logs;

        if (days <= 0)
            return;

        var cutoff = DateTime.UtcNow.AddDays(-days);

        try
        {
            await using var ctx = await DbContextFactory.CreateDbContextAsync();
            var deleted = await ctx.LogEntries
                .Where(e => e.Timestamp < cutoff)
                .ExecuteDeleteAsync();

            if (deleted > 0)
                Log.Information("Deleted {Count} log entries older than {Days} days", deleted, days);
        }
        catch (Exception ex)
        {
            Log.Warning("Log retention cleanup failed: {Message}", ex.Message);
        }
    }

    private static LogEntry ToEntry(LogRecord r) => new()
    {
        Timestamp = r.Timestamp,
        Level = r.Level,
        Context = r.Context,
        SubContext = r.SubContext,
        Message = r.Message,
        Exception = r.Exception,
    };
}
