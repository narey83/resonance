// <copyright file="LogRollupStore.cs" company="John Narey">
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
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

/// <summary>Bounded, atomic compaction of raw SQLite logs into hourly counters.</summary>
internal static class LogRollupStore
{
    internal static async Task EnsureSchemaAsync(LogsDbContext db, CancellationToken token)
    {
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "LogHourlySummaries" (
                "Hour" TEXT NOT NULL, "Level" TEXT NOT NULL, "SourceContext" TEXT NOT NULL,
                "Count" INTEGER NOT NULL, "FirstSeen" TEXT NOT NULL, "LastSeen" TEXT NOT NULL,
                PRIMARY KEY ("Hour", "Level", "SourceContext"));
            """, token);
    }

    internal static async Task<int> CompactBatchAsync(
        LogsDbContext db, DateTime routineCutoff, DateTime warningCutoff,
        DateTime errorCutoff, DateTime summaryCutoff, CancellationToken token, bool legacy = false)
    {
        await EnsureSchemaAsync(db, token);
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        FormattableString selectBatch = $"""
            CREATE TEMP TABLE "LogCompactionBatch" AS
            SELECT "Id", "Timestamp", "Level", COALESCE("SourceContext", '') AS "SourceContext"
            FROM "LogEntries"
            WHERE "Timestamp" < {routineCutoff} AND (
                ("Level" NOT IN ('Warning', 'Error', 'Fatal')) OR
                ("Level" = 'Warning' AND "Timestamp" < {warningCutoff}) OR
                ("Level" IN ('Error', 'Fatal') AND "Timestamp" < {errorCutoff}))
            ORDER BY "Timestamp", "Id" LIMIT 1000;
            """;
        if (legacy)
        {
            // Only these fixed schema identifiers are substituted, never request values.
            selectBatch = FormattableStringFactory.Create(selectBatch.Format
                .Replace("FROM \"LogEntries\"", "FROM \"legacy_public_LogEntries\"")
                .Replace("COALESCE(\"SourceContext\", '')", "COALESCE(\"Context\", '')")
                .Replace("ORDER BY \"Timestamp\", \"Id\"", "ORDER BY \"Id\""), selectBatch.GetArguments());
        }

        await db.Database.ExecuteSqlInterpolatedAsync(selectBatch, token);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO "LogHourlySummaries" ("Hour", "Level", "SourceContext", "Count", "FirstSeen", "LastSeen")
            SELECT strftime('%Y-%m-%d %H:00:00', "Timestamp"), "Level", "SourceContext",
                COUNT(*), MIN("Timestamp"), MAX("Timestamp")
            FROM "LogCompactionBatch" WHERE 1 GROUP BY 1, 2, 3
            ON CONFLICT ("Hour", "Level", "SourceContext") DO UPDATE SET
                "Count" = "Count" + excluded."Count",
                "FirstSeen" = MIN("FirstSeen", excluded."FirstSeen"),
                "LastSeen" = MAX("LastSeen", excluded."LastSeen");
            """, token);
        var deleteBatch = """
            DELETE FROM "LogEntries" WHERE ("Id", "Timestamp") IN
                (SELECT "Id", "Timestamp" FROM "LogCompactionBatch");
            """;
        if (legacy)
        {
            deleteBatch = deleteBatch.Replace("DELETE FROM \"LogEntries\"", "DELETE FROM \"legacy_public_LogEntries\"");
        }

        var removed = await db.Database.ExecuteSqlRawAsync(deleteBatch, token);
        await db.Database.ExecuteSqlRawAsync("DROP TABLE \"LogCompactionBatch\";", token);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "LogHourlySummaries" WHERE "Hour" < {summaryCutoff};
            """, token);
        await transaction.CommitAsync(token);
        return removed;
    }
}
