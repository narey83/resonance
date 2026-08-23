// <copyright file="LogPartitioning.cs" company="John Narey">
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

/// <summary>
///     Pure decision logic for the monthly partitions backing <c>logs."LogEntries"</c> -- which
///     partitions must exist so writes never hit a missing-partition error, and which are safe to
///     drop under a given retention window. Deliberately has no Postgres/EF dependency so it can be
///     unit tested directly; <see cref="LogsSchemaInitializer"/> and <see cref="LogPersistenceService"/>
///     are what actually execute the DDL this decides on.
/// </summary>
public static class LogPartitioning
{
    /// <summary>
    ///     The half-open <c>[Start, End)</c> range a given month's partition covers -- Postgres range
    ///     partition bounds are exclusive on the upper end, so <paramref name="month"/>'s partition
    ///     spans from its first day up to (but not including) the first day of the next month.
    /// </summary>
    /// <returns>The partition's inclusive start and exclusive end date.</returns>
    public static (DateOnly Start, DateOnly End) Bounds(int year, int month)
    {
        var start = new DateOnly(year, month, 1);
        return (start, start.AddMonths(1));
    }

    /// <summary>
    ///     The physical partition table name for a given year/month, e.g. <c>LogEntries_202608</c>.
    /// </summary>
    /// <returns>The partition table name.</returns>
    public static string TableName(int year, int month) => $"LogEntries_{year:D4}{month:D2}";

    /// <summary>
    ///     Every (year, month) pair that must have an existing partition as of <paramref name="today"/>,
    ///     so that today's writes -- and writes for the next <paramref name="monthsAhead"/> months --
    ///     always land in a partition that already exists. A partitioned table has no "default"
    ///     partition here, so an INSERT with no matching partition fails outright; this is what keeps
    ///     that from ever happening as long as it's checked at least once within any given month.
    /// </summary>
    /// <returns>The (year, month) pairs required, from the current month through the lookahead.</returns>
    public static IReadOnlyList<(int Year, int Month)> RequiredPartitions(DateOnly today, int monthsAhead = 2)
    {
        var result = new List<(int Year, int Month)>(monthsAhead + 1);
        var cursor = new DateOnly(today.Year, today.Month, 1);

        for (var i = 0; i <= monthsAhead; i++)
        {
            var month = cursor.AddMonths(i);
            result.Add((month.Year, month.Month));
        }

        return result;
    }

    /// <summary>
    ///     True once a partition's entire range is older than <paramref name="cutoff"/> -- i.e. it can
    ///     no longer contain anything within the retention window, so dropping it (a fast, metadata-only
    ///     operation) can never discard a record that should have been kept. Retention is therefore
    ///     "at least N days, rounded up to the enclosing month" rather than an exact day cutoff -- a
    ///     deliberate trade for O(1) drops instead of an O(matching rows) DELETE at real log volume.
    /// </summary>
    /// <returns>True if the partition's entire range is older than <paramref name="cutoff"/>.</returns>
    public static bool IsExpired(int year, int month, DateOnly cutoff)
    {
        var (_, end) = Bounds(year, month);
        return end <= cutoff;
    }

    /// <summary>
    ///     Which of <paramref name="existingPartitionTableNames"/> (as returned by a catalog query --
    ///     see <see cref="LogPersistenceService"/>) are expired under <paramref name="retentionDays"/>
    ///     as of <paramref name="now"/>, and therefore safe to drop. Names that don't match the
    ///     expected <c>LogEntries_YYYYMM</c> shape are ignored rather than guessed at.
    /// </summary>
    /// <returns>The names of partitions safe to drop.</returns>
    public static IReadOnlyList<string> ExpiredPartitions(IEnumerable<string> existingPartitionTableNames, DateTime now, int retentionDays)
    {
        var cutoff = DateOnly.FromDateTime(now.AddDays(-retentionDays));
        var expired = new List<string>();

        foreach (var name in existingPartitionTableNames)
        {
            if (TryParsePartitionName(name, out var year, out var month) && IsExpired(year, month, cutoff))
            {
                expired.Add(name);
            }
        }

        return expired;
    }

    private static bool TryParsePartitionName(string name, out int year, out int month)
    {
        year = 0;
        month = 0;

        const string prefix = "LogEntries_";

        if (name is null || !name.StartsWith(prefix, StringComparison.Ordinal) || name.Length != prefix.Length + 6)
        {
            return false;
        }

        var digits = name.AsSpan(prefix.Length);

        return int.TryParse(digits[..4], out year)
            && int.TryParse(digits[4..], out month)
            && month is >= 1 and <= 12;
    }
}
