// <copyright file="LogsSchemaInitializer.cs" company="John Narey">
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
using System.Globalization;
using Npgsql;

/// <summary>
///     Creates and maintains the native-partitioned <c>logs."LogEntries"</c> table via raw DDL,
///     mirroring the existing hand-rolled-table pattern used for <c>transfers."TransferNetworkInfo"</c>
///     (Program.cs) rather than EF's <see cref="Microsoft.EntityFrameworkCore.DbContext.Database"/>
///     .EnsureCreated() path -- declarative range partitioning (<c>PARTITION BY RANGE</c>) can't be
///     expressed through EF's model at all, so this is deliberately outside that mechanism rather
///     than a workaround for it.
///
///     Every statement here only ever targets a schema/table/index that doesn't exist yet, or a
///     partition that starts out empty -- see <see cref="LogPersistenceService"/> for why that
///     property is load-bearing: it's what keeps this from ever repeating the historical incident
///     where a trigram index built against an already-large table blew the schema-init command
///     timeout and, as CREATE INDEX CONCURRENTLY, starved unrelated schemas on the shared host.
/// </summary>
public static class LogsSchemaInitializer
{
    /// <summary>
    ///     Creates the schema, the parent partitioned table, and every index on it (Postgres
    ///     auto-propagates parent indexes to each partition, present and future) if they don't
    ///     already exist. Safe to call on every startup.
    /// </summary>
    public static void EnsureSchemaAndIndexes(NpgsqlConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE SCHEMA IF NOT EXISTS logs;

            CREATE TABLE IF NOT EXISTS logs."LogEntries" (
                "Id" BIGINT GENERATED ALWAYS AS IDENTITY,
                "Timestamp" TIMESTAMPTZ NOT NULL,
                "Level" VARCHAR(20) NOT NULL,
                "SourceContext" VARCHAR(200),
                "SubContext" VARCHAR(200),
                "Message" TEXT,
                "Exception" TEXT,
                "Properties" JSONB,
                PRIMARY KEY ("Id", "Timestamp")
            ) PARTITION BY RANGE ("Timestamp");

            -- Id > @afterId ORDER BY Id is already a pure PK-index seek via the primary key above;
            -- these cover every other GET /logs access pattern (LogQueryService).
            CREATE INDEX IF NOT EXISTS "IX_LogEntries_Timestamp"
                ON logs."LogEntries" ("Timestamp" DESC);

            CREATE INDEX IF NOT EXISTS "IX_LogEntries_Level_Timestamp"
                ON logs."LogEntries" ("Level", "Timestamp" DESC);

            CREATE INDEX IF NOT EXISTS "IX_LogEntries_SourceContext_Timestamp"
                ON logs."LogEntries" ("SourceContext", "Timestamp" DESC);

            -- The log viewer's search box is Message.Contains(...) -- a leading-wildcard match no
            -- btree can serve. A plain btree here would silently do nothing for that query shape;
            -- trigram + GIN is the only index type that actually helps it. Depends on pg_trgm,
            -- already created during startup ahead of TransfersDbContext (see Program.cs).
            CREATE INDEX IF NOT EXISTS "IX_LogEntries_Message_Trgm"
                ON logs."LogEntries" USING gin ("Message" gin_trgm_ops);
            """;
        command.ExecuteNonQuery();
    }

    /// <summary>
    ///     Creates the partition for <paramref name="year"/>/<paramref name="month"/> if it doesn't
    ///     already exist. The bounds are inlined as literal date strings rather than query
    ///     parameters -- PARTITION OF ... FOR VALUES FROM/TO requires constant expressions, not
    ///     bind parameters, in Postgres' grammar. Safe here since both values are computed
    ///     internally (see <see cref="LogPartitioning"/>), never user input.
    /// </summary>
    public static void EnsurePartition(NpgsqlConnection connection, int year, int month)
    {
        var (start, end) = LogPartitioning.Bounds(year, month);
        var tableName = LogPartitioning.TableName(year, month);

        using var command = connection.CreateCommand();
        command.CommandText = $"""
            CREATE TABLE IF NOT EXISTS logs."{tableName}"
                PARTITION OF logs."LogEntries"
                FOR VALUES FROM ('{start:yyyy-MM-dd}') TO ('{end:yyyy-MM-dd}');
            """;
        command.ExecuteNonQuery();
    }

    /// <summary>
    ///     Every partition table currently attached to <c>logs."LogEntries"</c>, by name.
    /// </summary>
    /// <returns>The partition table names.</returns>
    public static List<string> GetExistingPartitionNames(NpgsqlConnection connection)
    {
        var names = new List<string>();

        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT c.relname
            FROM pg_inherits i
            JOIN pg_class c ON c.oid = i.inhrelid
            JOIN pg_class p ON p.oid = i.inhparent
            JOIN pg_namespace n ON n.oid = p.relnamespace
            WHERE n.nspname = 'logs' AND p.relname = 'LogEntries';
            """;

        using var reader = command.ExecuteReader();

        while (reader.Read())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    /// <summary>
    ///     Drops one partition -- a metadata-only operation regardless of how many rows it holds,
    ///     unlike a DELETE over the equivalent rows. This is retention: see
    ///     <see cref="LogPartitioning.ExpiredPartitions"/> for which partitions this is safe to call
    ///     for and why dropping a whole month at a time is an acceptable trade at this log volume.
    /// </summary>
    public static void DropPartition(NpgsqlConnection connection, string tableName)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"""DROP TABLE IF EXISTS logs."{tableName}";""";
        command.ExecuteNonQuery();
    }

    /// <summary>
    ///     Full startup initialization: schema, parent table, indexes, and every partition required
    ///     for "now" plus a lookahead buffer. Idempotent; safe to call every time the app starts.
    /// </summary>
    public static void Initialize(string connectionString, int partitionMonthsAhead = 2)
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();

        EnsureSchemaAndIndexes(connection);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        foreach (var (year, month) in LogPartitioning.RequiredPartitions(today, partitionMonthsAhead))
        {
            EnsurePartition(connection, year, month);
        }
    }
}
