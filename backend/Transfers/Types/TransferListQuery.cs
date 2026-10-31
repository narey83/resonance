// <copyright file="TransferListQuery.cs" company="JP Dillingham">
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

namespace resonance.Transfers;

using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Soulseek;

/// <summary>
///     The shared query behind the transfer list endpoints.
/// </summary>
/// <remarks>
///     <para>
///         These endpoints used to return the entire transfer history. On a long-lived instance that
///         is 1.5 million rows and a 13 MB response taking four and a half seconds to build — polled
///         every two seconds by the mobile transfers screen, so responses overlapped and piled up
///         until the connection pool was full and the client spent seconds parsing each one. No
///         client can display that many rows, and none tries to: they all filter client-side.
///     </para>
///     <para>
///         That was fixed by trimming the finished transfers out of the <em>response</em>, in memory,
///         after loading them all. The database was still handing over every live row first: measured
///         on the production instance, the uploads endpoint fetched 143,458 rows and 37 MB to return
///         at most 500 of them, and EF Core materialised an entity for each one, on every call. The
///         cap belongs in the query, so this asks for the rows it is going to keep — about 4,100
///         instead of 143,458.
///     </para>
///     <para>
///         In-flight transfers are never dropped, however many there are; only finished ones are
///         capped, newest first.
///     </para>
/// </remarks>
internal static class TransferListQuery
{
    internal const string SqliteRecoveryIndex = "IX_Transfers_RecoveryDirection";
    internal const string SqliteListIndex = "IX_Transfers_ListDirectionRemovedCompletionTime";
    internal static string RecoveryPredicateSql => $"\"EndedAt\" IS NULL OR ({CompletedFlagSql})=0";
    internal static string CompletedFlagSql => "CASE WHEN \"State\" IN (" +
        string.Join(",", TransferStateCategories.Completed.Select(state => (int)state).OrderBy(state => state)) + ") THEN 1 ELSE 0 END";

    internal static void EnsureSqliteIndexes(TransfersDbContext context)
    {
        if (!context.Database.IsSqlite())
        {
            return;
        }

        var recoveryIndexSql = $"CREATE INDEX IF NOT EXISTS \"{SqliteRecoveryIndex}\" ON \"Transfers\" (\"Direction\") WHERE {RecoveryPredicateSql}";
        var listIndexSql = $"CREATE INDEX IF NOT EXISTS \"{SqliteListIndex}\" ON \"Transfers\" (\"Direction\", \"Removed\", ({CompletedFlagSql}), COALESCE(\"EndedAt\", \"RequestedAt\") DESC)";
        context.Database.ExecuteSqlRaw(recoveryIndexSql);
        context.Database.ExecuteSqlRaw(listIndexSql);
    }

    internal static List<Transfer> ListForRecovery(TransfersDbContext context, TransferDirection direction)
    {
        if (context.Database.IsSqlite())
        {
            var recoverySql = $"SELECT * FROM \"Transfers\" WHERE \"Direction\"=@direction AND ({RecoveryPredicateSql})";
            return context.Transfers.FromSqlRaw(recoverySql,
                new SqliteParameter("@direction", direction.ToString())).AsNoTracking().ToList();
        }

        var completed = TransferStateCategories.Completed;
        return context.Transfers.AsNoTracking().Where(transfer => transfer.Direction == direction)
            .Where(transfer => transfer.EndedAt == null || !completed.Contains(transfer.State)).ToList();
    }

    /// <summary>
    ///     Returns every in-flight transfer in the given direction, plus at most
    ///     <paramref name="maxCompleted"/> of the most recently finished ones.
    /// </summary>
    /// <param name="context">The transfers database context.</param>
    /// <param name="direction">The direction to list.</param>
    /// <param name="includeRemoved">Whether to include transfers that were previously removed.</param>
    /// <param name="activeOnly">Whether to omit finished transfers entirely.</param>
    /// <param name="maxCompleted">The most finished transfers to return.</param>
    /// <returns>The in-flight transfers followed by the capped finished ones.</returns>
    internal static List<Transfer> ListCapped(
        TransfersDbContext context,
        TransferDirection direction,
        bool includeRemoved,
        bool activeOnly,
        int maxCompleted)
    {
        if (context.Database.IsSqlite())
        {
            return ListSqlite(context, direction, includeRemoved, activeOnly, maxCompleted);
        }

        // Deliberately the HashSet, not an array: `array.Contains(x)` resolves to MemoryExtensions'
        // ReadOnlySpan-based overload, which EF Core's parameter extraction can't handle. The same
        // trap is documented at length in LogQueryService.
        var completed = TransferStateCategories.Completed;

        var scoped = context.Transfers
            .AsNoTracking()
            .Where(t => t.Direction == direction)
            .Where(t => !t.Removed || includeRemoved);

        var transfers = scoped
            .Where(t => !completed.Contains(t.State))
            .ToList();

        if (activeOnly)
        {
            return transfers;
        }

        // Ordered by the same key the in-memory cap used. EndedAt is set on every finished transfer
        // in practice — the coalesce is here so a row that somehow finished without one is ordered
        // by when it was asked for rather than sorting to an arbitrary end and being dropped.
        transfers.AddRange(scoped
            .Where(t => completed.Contains(t.State))
            .OrderByDescending(t => t.EndedAt ?? t.RequestedAt)
            .Take(maxCompleted)
            .ToList());

        return transfers;
    }

    /// <summary>Returns one page of pending transfers and bounded recent history.</summary>
    /// <returns>The matching files and the total pending count before pagination.</returns>
    internal static (List<Transfer> Transfers, int TotalPending) ListPage(
        TransfersDbContext context, TransferDirection direction, bool includeRemoved,
        bool activeOnly, int maxCompleted, int page, int pageSize)
    {
        if (page < 0 || pageSize < 1 || pageSize > 500 || page > int.MaxValue / pageSize)
        {
            throw new ArgumentOutOfRangeException(nameof(page));
        }

        var completed = TransferStateCategories.Completed;
        var scoped = context.Transfers.AsNoTracking()
            .Where(t => t.Direction == direction && (!t.Removed || includeRemoved));
        var pending = context.Database.IsSqlite()
            ? context.Transfers.FromSqlRaw(
                "SELECT * FROM \"Transfers\" WHERE \"Direction\"=@direction AND " +
                (includeRemoved ? string.Empty : "\"Removed\"=0 AND ") + $"({CompletedFlagSql})=0",
                new SqliteParameter("@direction", direction.ToString())).AsNoTracking()
            : scoped.Where(t => !completed.Contains(t.State));
        var total = pending.Count();
        var files = pending.OrderBy(t => t.State == TransferStates.InProgress ? 0
                : t.State == TransferStates.Initializing ? 1 : 2)
            .ThenBy(t => t.RequestedAt).ThenBy(t => t.Id)
            .Skip(page * pageSize).Take(pageSize).ToList();
        if (!activeOnly && maxCompleted > 0)
        {
            // Retain the existing recent-history cap, independent of the pending page.
            var history = context.Database.IsSqlite()
                ? context.Transfers.FromSqlRaw(
                    "SELECT * FROM \"Transfers\" WHERE \"Direction\"=@direction AND " +
                    (includeRemoved ? string.Empty : "\"Removed\"=0 AND ") + $"({CompletedFlagSql})=1",
                    new SqliteParameter("@direction", direction.ToString())).AsNoTracking()
                : scoped.Where(t => completed.Contains(t.State));
            files.AddRange(history.OrderByDescending(t => t.EndedAt ?? t.RequestedAt).ThenBy(t => t.Id)
                .Take(maxCompleted).ToList());
        }

        return (files, total);
    }

    /// <summary>Reads aggregate counts without materializing the queued files.</summary>
    /// <returns>Counts and the byte samples needed by the status strip.</returns>
    internal static TransferListStatus Status(TransfersDbContext context, TransferDirection direction)
    {
        var completed = TransferStateCategories.Completed;
        var scoped = context.Transfers.AsNoTracking().Where(t => t.Direction == direction && !t.Removed);
        var pending = context.Database.IsSqlite()
            ? context.Transfers.FromSqlRaw("SELECT * FROM \"Transfers\" WHERE \"Direction\"=@direction AND \"Removed\"=0 AND (" + CompletedFlagSql + ")=0",
                new SqliteParameter("@direction", direction.ToString())).AsNoTracking()
            : scoped.Where(t => !completed.Contains(t.State));
        var counts = pending.GroupBy(t => t.State).Select(g => new { State = g.Key, Count = g.Count() }).ToList();
        var active = pending.Where(t => t.State == TransferStates.InProgress || t.State == TransferStates.Initializing)
            .Select(t => new TransferProgress(t.Id, t.State, t.BytesTransferred)).ToList();
        var history = context.Database.IsSqlite()
            ? context.Transfers.FromSqlRaw("SELECT * FROM \"Transfers\" WHERE \"Direction\"=@direction AND \"Removed\"=0 AND (" + CompletedFlagSql + ")=1",
                new SqliteParameter("@direction", direction.ToString())).AsNoTracking()
            : scoped.Where(t => completed.Contains(t.State));
        var cutoff = DateTime.UtcNow.AddSeconds(-15);

        // Match the expression index's time key so quiet periods do not scan the archive.
        active.AddRange(history.Where(t => (t.EndedAt ?? t.RequestedAt) >= cutoff)
            .OrderByDescending(t => t.EndedAt ?? t.RequestedAt).Take(500)
            .Select(t => new TransferProgress(t.Id, t.State, t.BytesTransferred)).ToList());
        return new TransferListStatus(
            counts.Where(c => c.State == TransferStates.InProgress || c.State == TransferStates.Initializing).Sum(c => c.Count),
            counts.Where(c => TransferStateCategories.Queued.Contains(c.State) || c.State.ToString() == "Requested").Sum(c => c.Count),
            active);
    }

    private static List<Transfer> ListSqlite(TransfersDbContext context, TransferDirection direction,
        bool includeRemoved, bool activeOnly, int maxCompleted)
    {
        var live = new List<Transfer>();
        var finished = new List<Transfer>();
        foreach (var removed in includeRemoved ? new[] { 0, 1 } : new[] { 0 })
        {
            // Exact equality predicates match the expression index. No JSON membership filter,
            // full-history sort, or archive scan is needed to return the current queue.
            var predicate = $"FROM \"Transfers\" WHERE \"Direction\"=@direction AND \"Removed\"=@removed AND ({CompletedFlagSql})=";
            live.AddRange(context.Transfers.FromSqlRaw("SELECT * " + predicate + "0",
                new SqliteParameter("@direction", direction.ToString()), new SqliteParameter("@removed", removed)).AsNoTracking().ToList());
            if (!activeOnly && maxCompleted > 0)
            {
                finished.AddRange(context.Transfers.FromSqlRaw("SELECT * " + predicate + "1 ORDER BY COALESCE(\"EndedAt\", \"RequestedAt\") DESC LIMIT @limit",
                    new SqliteParameter("@direction", direction.ToString()), new SqliteParameter("@removed", removed),
                    new SqliteParameter("@limit", maxCompleted)).AsNoTracking().ToList());
            }
        }

        live.AddRange(finished.OrderByDescending(transfer => transfer.EndedAt ?? transfer.RequestedAt).Take(Math.Max(0, maxCompleted)));
        return live;
    }
}
