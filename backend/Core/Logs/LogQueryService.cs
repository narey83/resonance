// <copyright file="LogQueryService.cs" company="John Narey">
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
using System.Linq.Expressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

/// <summary>
///     Postgres-backed equivalent of <see cref="LogFileReader"/> -- database-side filtering,
///     ordering, and LIMIT throughout, so nothing here ever loads the whole table into memory.
/// </summary>
public static class LogQueryService
{
    private static readonly Expression<Func<LogEntry, LogRecord>> ToRecord = e => new LogRecord
    {
        Id = e.Id,
        Timestamp = e.Timestamp,
        Level = e.Level,
        Context = e.SourceContext,
        SubContext = e.SubContext,
        Message = e.Message,
        Exception = e.Exception,
        Properties = e.Properties,
    };

    /// <summary>
    ///     Queries log entries. When <paramref name="afterId"/> is given, this takes the live-tail
    ///     fast path: <c>WHERE "Id" > @afterId ORDER BY "Id" LIMIT @limit</c>, a pure primary-key-index
    ///     seek with no separate COUNT query -- nothing consuming a poll needs an exact total across
    ///     all history, and computing one would turn a cheap seek back into a scan. Everything else
    ///     (offset/level/context/search/from/to) returns newest first and fetches one extra record
    ///     to expose a cheap lower-bound total without counting the entire log store.
    /// </summary>
    /// <returns>The matching page of records, and a lower-bound total suitable for detecting another page.</returns>
    public static async Task<(List<LogRecord> Items, int Total)> QueryAsync(
        LogsDbContext context,
        long? afterId,
        string[] levels,
        string[] contexts,
        string search,
        DateTime? from,
        DateTime? to,
        int offset,
        int limit,
        CancellationToken cancellationToken = default,
        long? beforeId = null)
    {
        var query = context.Entries.AsNoTracking().AsQueryable();

        if (levels?.Length > 0)
        {
            // Deliberately List<T>, not the string[] directly: `array.Contains(x)` resolves to
            // MemoryExtensions' ReadOnlySpan-based overload (arrays implicitly convert to spans),
            // and EF Core 8's parameter-extraction interpreter -- built before ReadOnlySpan-returning
            // generic delegates like this were common -- can't instantiate a generic argument that's
            // a ref struct, throwing a TypeLoadException at query time. List<T>.Contains is a plain
            // instance method, sidestepping that overload resolution entirely. Confirmed live against
            // Postgres: the bare array form 500s on every call, this form doesn't.
            var levelList = levels.ToList();
            query = query.Where(e => levelList.Contains(e.Level));
        }

        if (contexts?.Length > 0)
        {
            var contextList = contexts.ToList();
            query = query.Where(e => contextList.Contains(e.SourceContext));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            // The 3-argument overload emits an explicit ESCAPE '\' clause. Postgres already treats
            // '\' as the default LIKE escape character, so this changes nothing there, but SQLite
            // (used by the test suite) has no default escape character at all without one -- an
            // unescaped 3-arg call would silently stop honoring EscapeLikePattern's escaping there.
            var pattern = $"%{EscapeLikePattern(search)}%";
            query = query.Where(e => e.Message != null && EF.Functions.Like(e.Message, pattern, "\\"));
        }

        if (from.HasValue)
        {
            query = query.Where(e => e.Timestamp >= from.Value);
        }

        if (to.HasValue)
        {
            query = query.Where(e => e.Timestamp <= to.Value);
        }

        if (beforeId.HasValue)
        {
            query = to.HasValue
                ? query.Where(e => e.Timestamp < to.Value || e.Id < beforeId.Value)
                : query.Where(e => e.Id < beforeId.Value);
        }

        if (afterId.HasValue)
        {
            var items = await query
                .Where(e => e.Id > afterId.Value)
                .OrderBy(e => e.Id)
                .Take(limit)
                .Select(ToRecord)
                .ToListAsync(cancellationToken);

            return (items, items.Count);
        }

        var page = await query
            .OrderByDescending(e => e.Timestamp)
            .ThenByDescending(e => e.Id) // stable tie-break: many rows can share a millisecond at real volume
            .Skip(offset)
            .Take(limit + 1)
            .Select(ToRecord)
            .ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        if (hasMore)
        {
            page.RemoveAt(page.Count - 1);
        }

        return (page, offset + page.Count + (hasMore ? 1 : 0));
    }

    // The old JSONL reader matched search terms as a literal substring (StringComparison.Ordinal) --
    // no wildcard syntax. A real SQL LIKE pattern would otherwise treat a literal '%' or '_' in the
    // user's search text as a wildcard, which is a behavior change worth avoiding, not just an
    // injection concern (Npgsql already parameterizes the value itself).
    private static string EscapeLikePattern(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
