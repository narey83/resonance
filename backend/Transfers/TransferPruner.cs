// <copyright file="TransferPruner.cs" company="John Narey">
//    ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮  ╭╮
//   ─╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰──╯╰  resonance
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) 2026 John Narey.
//   │ Part of Resonance, a Soulseek client based on slskd.
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.Transfers;

using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Soulseek;

/// <summary>
///     Performs retention soft-deletes without waiting behind transfers that are still being updated.
/// </summary>
internal static class TransferPruner
{
    // This table carries several reporting indexes, so every soft-delete fans out into substantial
    // index maintenance on the small shared Postgres host. Keep transactions deliberately tiny:
    // larger 5,000-row batches still exceeded the 30-second command timeout in production.
    private const int BatchSize = 100;

    /// <summary>
    ///     Marks one bounded, lock-skipping batch of eligible transfers as removed.
    /// </summary>
    /// <returns>The number of transfers marked as removed.</returns>
    public static int Prune(
        TransfersDbContext context,
        TransferDirection direction,
        DateTime cutoff,
        IReadOnlyCollection<int> states)
    {
        const string sql = """
            WITH candidates AS (
                SELECT "Id"
                FROM transfers."Transfers"
                WHERE "Direction" = @direction
                  AND NOT "Removed"
                  AND "EndedAt" IS NOT NULL
                  AND "EndedAt" < @cutoff
                  AND "State" = ANY (@states)
                ORDER BY "EndedAt"
                LIMIT @batchSize
                FOR UPDATE SKIP LOCKED
            )
            UPDATE transfers."Transfers" AS transfers
            SET "Removed" = TRUE
            FROM candidates
            WHERE transfers."Id" = candidates."Id"
            """;

        return context.Database.ExecuteSqlRaw(
            sql,
            new NpgsqlParameter<string>("direction", direction.ToString()),
            new NpgsqlParameter<DateTime>("cutoff", cutoff),
            new NpgsqlParameter<int[]>("states", states.ToArray()),
            new NpgsqlParameter<int>("batchSize", BatchSize));
    }
}
