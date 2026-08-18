// <copyright file="LogFileReader.cs" company="John Narey">
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
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;

/// <summary>
///     Reads and filters application log entries out of the daily-rolling JSON Lines files that
///     back the log viewer, replacing what used to be a Postgres-backed query. There is no index
///     here -- every call scans every retained line -- which is fine at the log volume a single
///     self-hosted instance produces over a Retention.Logs-sized window, but it will get slow if
///     that window (or traffic) grows a lot. If that happens, revisit rather than let requests hang.
/// </summary>
public static class LogFileReader
{
    /// <summary>
    ///     Queries the daily log files in <paramref name="logDirectory"/>, newest day first.
    /// </summary>
    /// <returns>The matching page of records, and the total number of records that matched the filters.</returns>
    public static (List<LogRecord> Items, int Total) Query(
        string logDirectory,
        string[] levels,
        string[] contexts,
        string search,
        DateTime? from,
        DateTime? to,
        int offset,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var items = new List<LogRecord>(limit);
        var total = 0;

        if (string.IsNullOrEmpty(logDirectory) || !Directory.Exists(logDirectory))
        {
            return (items, total);
        }

        var files = Directory.GetFiles(logDirectory, $"{Program.AppName}-????????.jsonl")
            .OrderByDescending(f => f, StringComparer.Ordinal);

        foreach (var file in files)
        {
            cancellationToken.ThrowIfCancellationRequested();

            // a day's lines are written oldest-first; buffer the day so it can be walked newest-first,
            // keeping the overall newest-first order across days without a true reverse file read.
            var day = new List<LogRecord>();

            foreach (var line in File.ReadLines(file))
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                if (!TryParseLine(line, out var record))
                {
                    // partially-written line (e.g. process was killed mid-write) or unrelated content
                    continue;
                }

                if (levels?.Length > 0 && !levels.Contains(record.Level))
                {
                    continue;
                }

                if (contexts?.Length > 0 && !contexts.Contains(record.Context))
                {
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(search) && record.Message?.Contains(search, StringComparison.Ordinal) != true)
                {
                    continue;
                }

                if (from.HasValue && record.Timestamp < from.Value)
                {
                    continue;
                }

                if (to.HasValue && record.Timestamp > to.Value)
                {
                    continue;
                }

                day.Add(record);
            }

            for (var i = day.Count - 1; i >= 0; i--)
            {
                if (total >= offset && items.Count < limit)
                {
                    items.Add(day[i]);
                }

                total++;
            }
        }

        return (items, total);
    }

    private static bool TryParseLine(string line, out LogRecord record)
    {
        record = default;

        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;

            var properties = root.TryGetProperty("Properties", out var p) && p.ValueKind == JsonValueKind.Object
                ? p
                : default;

            string GetStringProperty(string name) =>
                properties.ValueKind == JsonValueKind.Object
                && properties.TryGetProperty(name, out var v)
                && v.ValueKind == JsonValueKind.String
                    ? v.GetString()
                    : null;

            record = new LogRecord
            {
                Timestamp = root.GetProperty("Timestamp").GetDateTimeOffset().UtcDateTime,
                Level = root.TryGetProperty("Level", out var level) ? level.GetString() : "Information",
                Context = GetStringProperty("SourceContext") ?? resonance.Logs.Application,
                SubContext = GetStringProperty("SubContext"),
                Message = root.TryGetProperty("RenderedMessage", out var message) ? message.GetString() : null,
                Exception = root.TryGetProperty("Exception", out var exception) ? exception.GetString() : null,
            };

            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
