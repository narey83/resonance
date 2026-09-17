// <copyright file="TransferRollupRefresher.cs" company="John Narey">
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

namespace resonance.Telemetry;

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Serilog;

/// <summary>
///     Keeps <see cref="TransferRollup"/> up to date by calling the Postgres refresh function on a
///     timer, so the aggregation happens once in the background instead of once per dashboard load.
/// </summary>
/// <remarks>
///     The work is deliberately all inside the database: the function reads and writes the transfer
///     table without anything crossing the wire, so the backend's part is issuing one statement and
///     logging the result.
/// </remarks>
public sealed class TransferRollupRefresher : BackgroundService
{
    // A bucket is five minutes wide, so refreshing faster than that only ever re-rolls the trailing
    // lookback window for nothing. Two minutes keeps the tail no more than a bucket or so behind.
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(2);

    // While backfilling, each pass covers a chunk and returns immediately; run them back to back so
    // four months of history is caught up in minutes rather than over the following days.
    private static readonly TimeSpan CatchUpInterval = TimeSpan.FromSeconds(10);

    // Let the schema check and the rest of the app settle first.
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

    public TransferRollupRefresher(ConnectionStringDictionary connectionStrings)
    {
        ConnectionStrings = connectionStrings;
    }

    private ConnectionStringDictionary ConnectionStrings { get; }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var caughtUp = true;

            try
            {
                caughtUp = await RefreshAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // The reports fall back to querying the transfer table directly for any window the
                // rollup doesn't cover, so a failure here costs speed, not correctness.
                Log.Warning("Transfer rollup refresh failed: {Message}", ex.Message);
            }

            try
            {
                await Task.Delay(caughtUp ? Interval : CatchUpInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task<bool> RefreshAsync(CancellationToken cancellationToken)
    {
        var startedAt = DateTime.UtcNow;

        await using var connection = new NpgsqlConnection(ConnectionStrings[Database.Transfers]);
        await connection.OpenAsync(cancellationToken);

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT rolled_from, rolled_through, rows_written, caught_up FROM transfers.refresh_transfer_rollup()";

        // A backfill chunk aggregates a week of the transfer table; the 30-second default is not
        // enough for that on the production host, where the equivalent ad-hoc query takes ~30s.
        command.CommandTimeout = 600;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            return true;
        }

        var rolledThrough = reader.IsDBNull(1) ? (DateTime?)null : reader.GetDateTime(1);
        var rowsWritten = reader.IsDBNull(2) ? 0L : reader.GetInt64(2);
        var caughtUp = !reader.IsDBNull(3) && reader.GetBoolean(3);

        var elapsed = (int)(DateTime.UtcNow - startedAt).TotalMilliseconds;

        if (!caughtUp)
        {
            Log.Information(
                "Transfer rollup backfilling: rolled through {Through:u}, {Rows} row(s) in {Elapsed}ms",
                rolledThrough,
                rowsWritten,
                elapsed);
        }
        else
        {
            Log.Debug(
                "Transfer rollup refreshed through {Through:u}, {Rows} row(s) in {Elapsed}ms",
                rolledThrough,
                rowsWritten,
                elapsed);
        }

        return caughtUp;
    }
}
