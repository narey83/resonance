// <copyright file="TransferRollup.cs" company="John Narey">
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
using Npgsql;
using Serilog;

/// <summary>
///     A pre-aggregated summary of the transfer table, maintained by Postgres so the Overview
///     dashboard reads rows that are already counted instead of counting them per request.
/// </summary>
/// <remarks>
///     <para>
///         The reports aggregate <c>transfers."Transfers"</c>, which on the production host is
///         3.3M rows / 3GB after four months. Measured there, the 30-day transfer summary — one
///         card, on the default dashboard — takes <b>29.9 seconds</b>, and the reports are run on
///         the request that needs them. Rolled up at this grain the same window is ~132k rows,
///         a 25x reduction, and the summary becomes an index range scan over small integers.
///     </para>
///     <para>
///         The grain is five minutes x direction x state x username. Five minutes because that is
///         the finest histogram bucket the dashboard asks for; username because
///         <c>COUNT(DISTINCT "Username")</c> cannot be recovered from rows that have already been
///         summed across users, and the distinct-user count is on every summary card.
///     </para>
///     <para>
///         Sums and counts are stored rather than averages, so an average over any span is
///         re-derived as <c>SUM(x_sum) / SUM(x_count)</c> — averaging pre-averaged buckets would
///         weight a five-minute lull the same as a five-minute flood.
///     </para>
/// </remarks>
internal static class TransferRollup
{
    /// <summary>
    ///     The bucket width. Every histogram interval the dashboard requests (5, 15, 60, 360 and
    ///     1440 minutes) is a multiple of this, so each one can be composed from whole buckets.
    /// </summary>
    internal const int BucketMinutes = 5;

    /// <summary>
    ///     How far back each refresh re-aggregates, regardless of the watermark. A transfer's row is
    ///     updated in place as it is retried, so a bucket can still change after its time has passed;
    ///     re-rolling a trailing window absorbs that without rebuilding the whole table.
    /// </summary>
    internal const int LookbackHours = 2;

    /// <summary>
    ///     The most history one refresh will cover. The first run has four months to backfill, and
    ///     doing that in a single statement would hold one long transaction against the busiest
    ///     table in the database on a host with two cores; instead it catches up a chunk per pass.
    /// </summary>
    internal const int BackfillChunkDays = 7;

    private static readonly string Ddl = $@"
        CREATE SCHEMA IF NOT EXISTS transfers;

        CREATE TABLE IF NOT EXISTS transfers.transfer_rollup (
            bucket              TIMESTAMPTZ      NOT NULL,
            ""Direction""         TEXT             NOT NULL,
            ""State""             INTEGER          NOT NULL,
            ""StateDescription""  TEXT             NOT NULL,
            ""Username""          TEXT             NOT NULL,
            total_bytes         BIGINT           NOT NULL,
            transfer_count      BIGINT           NOT NULL,
            speed_sum           DOUBLE PRECISION NOT NULL,
            wait_sum            DOUBLE PRECISION,
            wait_count          BIGINT           NOT NULL,
            duration_sum        DOUBLE PRECISION,
            duration_count      BIGINT           NOT NULL,
            PRIMARY KEY (bucket, ""Direction"", ""State"", ""StateDescription"", ""Username"")
        );

        -- Every report filters a time range first, and the primary key already leads with bucket,
        -- so range scans are served by it. This one covers the leaderboard and user-list reports,
        -- which group by username across a window.
        CREATE INDEX IF NOT EXISTS ""IDX_TransferRollup_UserWindow""
            ON transfers.transfer_rollup (""Username"", bucket);

        -- A single row recording how far the rollup has been built. Kept in its own table rather
        -- than derived from MAX(bucket) so that a window with no transfers at all is still known
        -- to be covered, instead of being re-scanned forever.
        CREATE TABLE IF NOT EXISTS transfers.transfer_rollup_watermark (
            singleton           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
            rolled_up_from      TIMESTAMPTZ NOT NULL,
            rolled_up_through   TIMESTAMPTZ NOT NULL
        );

        CREATE OR REPLACE FUNCTION transfers.refresh_transfer_rollup(
            p_lookback      INTERVAL DEFAULT INTERVAL '{LookbackHours} hours',
            p_max_span      INTERVAL DEFAULT INTERVAL '{BackfillChunkDays} days'
        )
        RETURNS TABLE (rolled_from TIMESTAMPTZ, rolled_through TIMESTAMPTZ, rows_written BIGINT, caught_up BOOLEAN)
        LANGUAGE plpgsql
        AS $fn$
        DECLARE
            v_epoch    CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '2000-01-01 00:00:00+00';
            v_bucket   CONSTANT INTERVAL    := INTERVAL '{BucketMinutes} minutes';
            v_from     TIMESTAMPTZ;
            v_to       TIMESTAMPTZ;
            v_target   TIMESTAMPTZ;
            v_origin   TIMESTAMPTZ;
            v_written  BIGINT := 0;
        BEGIN
            -- On a fresh installation these objects are created before EF Core has built the transfer
            -- table, so the refresher can call this first. Nothing to roll up yet, and reporting it as
            -- caught up keeps the refresher on its normal interval instead of retrying in a tight loop
            -- (and keeps a first boot free of warnings about a table that is simply not there yet).
            IF to_regclass('transfers.""Transfers""') IS NULL THEN
                RETURN QUERY SELECT NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0::BIGINT, TRUE;
                RETURN;
            END IF;

            -- Only whole, closed buckets. Storing the bucket currently in progress would record a
            -- partial count and then never revisit it once the watermark moved past.
            v_target := date_bin(v_bucket, now(), v_epoch);

            SELECT rolled_up_from, rolled_up_through INTO v_origin, v_from
            FROM transfers.transfer_rollup_watermark;

            IF v_from IS NULL THEN
                SELECT date_bin(v_bucket, min(""EndedAt""), v_epoch)
                INTO v_from
                FROM transfers.""Transfers""
                WHERE ""EndedAt"" IS NOT NULL;

                v_origin := v_from;
            ELSE
                v_from := LEAST(v_from, v_target - p_lookback);
            END IF;

            -- No completed transfers at all: nothing to roll up, and no watermark to record.
            IF v_from IS NULL THEN
                RETURN QUERY SELECT NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 0::BIGINT, TRUE;
                RETURN;
            END IF;

            v_to := LEAST(v_target, v_from + p_max_span);

            IF v_from >= v_to THEN
                RETURN QUERY SELECT v_origin, v_from, 0::BIGINT, TRUE;
                RETURN;
            END IF;

            DELETE FROM transfers.transfer_rollup
            WHERE bucket >= v_from AND bucket < v_to;

            INSERT INTO transfers.transfer_rollup (
                bucket, ""Direction"", ""State"", ""StateDescription"", ""Username"",
                total_bytes, transfer_count, speed_sum,
                wait_sum, wait_count, duration_sum, duration_count)
            SELECT
                date_bin(v_bucket, ""EndedAt"", v_epoch),
                ""Direction"",
                ""State"",
                COALESCE(""StateDescription"", ''),
                ""Username"",
                -- Bytes actually moved, not Size: Size counts a whole file for a transfer that moved
                -- part of it, and counts it again each time a peer re-requests a file it already has
                -- in full (those resume at the end, move nothing, and still succeed). BytesTransferred
                -- includes StartOffset, so the offset comes back off. Mirrors ReportsService.
                SUM(GREATEST(""BytesTransferred"" - ""StartOffset"", 0)),
                COUNT(*),
                SUM(""AverageSpeed""),
                SUM(EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt""))),
                COUNT(EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt""))),
                SUM(EXTRACT(EPOCH FROM (""EndedAt"" - ""StartedAt""))),
                COUNT(EXTRACT(EPOCH FROM (""EndedAt"" - ""StartedAt"")))
            FROM transfers.""Transfers""
            WHERE ""EndedAt"" IS NOT NULL
              AND ""EndedAt"" >= v_from
              AND ""EndedAt"" <  v_to
            GROUP BY 1, 2, 3, 4, 5;

            GET DIAGNOSTICS v_written = ROW_COUNT;

            INSERT INTO transfers.transfer_rollup_watermark (singleton, rolled_up_from, rolled_up_through)
            VALUES (TRUE, v_origin, v_to)
            ON CONFLICT (singleton) DO UPDATE
                SET rolled_up_from    = LEAST(transfers.transfer_rollup_watermark.rolled_up_from, EXCLUDED.rolled_up_from),
                    rolled_up_through = EXCLUDED.rolled_up_through;

            RETURN QUERY SELECT v_origin, v_to, v_written, v_to >= v_target;
        END;
        $fn$;
    ";

    private static ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    /// <summary>
    ///     Creates the rollup table, its watermark and the refresh function if they are not already
    ///     present. Safe to run on every start.
    /// </summary>
    /// <param name="connectionString">The transfers database connection string.</param>
    internal static void EnsureSchema(string connectionString)
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = Ddl;

        // Creating the objects is quick, but it queues behind anything already holding a lock on the
        // transfer table; give it more room than the 30-second default so a boot during a long report
        // doesn't leave the rollup missing until the next restart.
        command.CommandTimeout = 120;
        command.ExecuteNonQuery();

        Log.Debug("Transfer rollup schema ensured");
    }
}
