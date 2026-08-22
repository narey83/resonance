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
using System.Text;
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
    // Caches the parsed lines of the single most-recently-written ("hot") log file -- i.e. the
    // current day's file, always the first entry once Query()'s file list is sorted newest-first
    // -- so that the live-tail poll (GET /logs?from=<last-seen>, called every few seconds for as
    // long as the Logs page is open) doesn't re-read and re-parse the whole, ever-growing file
    // from byte 0 on every request. Only ever holds one file's records: older, already-rolled
    // files are immutable and read fresh each time (see ReadFileRecords), so this can't grow into
    // "the whole retention window in memory" -- it's replaced wholesale the moment a different
    // file becomes hot (day rollover) or is asked for as the hot file.
    private static readonly object HotFileLock = new();
    private static HotFileCache hotFile;

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
            .OrderByDescending(f => f, StringComparer.Ordinal)
            .ToList();

        for (var fileIndex = 0; fileIndex < files.Count; fileIndex++)
        {
            var file = files[fileIndex];

            cancellationToken.ThrowIfCancellationRequested();

            // A file that hasn't been written to since before `from` cannot contain any line
            // timestamped >= from (a record's Timestamp can never exceed its file's last-write
            // time), so it can be skipped without opening it -- this is what keeps the live-tail
            // poll (always from-bounded, no `to`) cheap: once a day's file stops being the one
            // actively written to, this check turns it into a single stat() call instead of a
            // full read. Safe regardless of `to` or the file's rolling-boundary semantics, since
            // it only ever skips files that provably cannot match.
            if (from.HasValue && File.GetLastWriteTimeUtc(file) < from.Value)
            {
                continue;
            }

            // a day's lines are written oldest-first; the record lists below keep that order so
            // they can be walked newest-first, preserving the overall newest-first order across
            // days without a true reverse file read.
            var day = fileIndex == 0
                ? GetHotFileRecords(file, from, cancellationToken)
                : ReadFileRecords(file);

            for (var i = day.Count - 1; i >= 0; i--)
            {
                var record = day[i];

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

                if (total >= offset && items.Count < limit)
                {
                    items.Add(record);
                }

                total++;
            }
        }

        return (items, total);
    }

    /// <summary>
    ///     Fully reads and parses a rolled-over (no longer written to) log file. No caching: it's
    ///     immutable once rolled, so there's no repeated-reread cost to save, and caching it would
    ///     only grow memory use unbounded as more days accumulate.
    /// </summary>
    private static List<LogRecord> ReadFileRecords(string file)
    {
        var records = new List<LogRecord>();

        foreach (var line in File.ReadLines(file))
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (TryParseLine(line, out var record))
            {
                records.Add(record);
            }

            // else: partially-written line (e.g. process was killed mid-write) or unrelated content
        }

        return records;
    }

    /// <summary>
    ///     Returns the parsed records in the hot (current day's, actively-written) log file that
    ///     are at or after <paramref name="from"/> (or every record, if <paramref name="from"/> is
    ///     null), reading only the bytes appended since the last call rather than the whole file.
    /// </summary>
    private static List<LogRecord> GetHotFileRecords(string file, DateTime? from, CancellationToken cancellationToken)
    {
        lock (HotFileLock)
        {
            if (hotFile is null || hotFile.Path != file)
            {
                // A different file is now hot (day rollover, or the first call this run) --
                // drop whatever was cached for the old one; nothing else references it.
                hotFile = new HotFileCache { Path = file };
            }

            long length;

            try
            {
                length = new FileInfo(file).Length;
            }
            catch (IOException)
            {
                // file briefly missing/locked (e.g. mid-rollover) -- fall back to whatever is cached
                return RecordsSince(hotFile.Records, from);
            }

            if (length < hotFile.Position)
            {
                // shouldn't happen under normal day-rotation (files only ever grow), but don't
                // wedge on stale state if it's ever truncated or replaced out from under us
                hotFile = new HotFileCache { Path = file };
            }

            if (length > hotFile.Position)
            {
                cancellationToken.ThrowIfCancellationRequested();

                using var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                stream.Seek(hotFile.Position, SeekOrigin.Begin);

                var chunk = new byte[length - hotFile.Position];
                var read = 0;

                while (read < chunk.Length)
                {
                    var n = stream.Read(chunk, read, chunk.Length - read);

                    if (n == 0)
                    {
                        break; // file shrank/was replaced mid-read; use what we got, retry the rest next call
                    }

                    read += n;
                }

                // Only consume up through the last complete line -- a line still being written
                // by the file sink has no trailing '\n' yet. '\n' is always a single UTF-8 byte
                // and never part of a multi-byte sequence, so cutting here is always a safe,
                // character-boundary-correct place to resume from on the next call.
                var lastNewline = Array.LastIndexOf(chunk, (byte)'\n', read - 1 >= 0 ? read - 1 : 0);

                if (read > 0 && lastNewline >= 0)
                {
                    // TrimEnd('\r') matches File.ReadLines/StreamReader.ReadLine, which strip both
                    // \n and \r\n line endings -- without it, a CRLF-written file (the default on
                    // Windows) would leave a trailing \r on every parsed line.
                    foreach (var line in Encoding.UTF8.GetString(chunk, 0, lastNewline + 1).Split('\n'))
                    {
                        var trimmed = line.TrimEnd('\r');

                        if (string.IsNullOrWhiteSpace(trimmed))
                        {
                            continue;
                        }

                        if (TryParseLine(trimmed, out var record))
                        {
                            hotFile.Records.Add(record);
                        }
                    }

                    hotFile.Position += lastNewline + 1;
                }
            }

            return RecordsSince(hotFile.Records, from);
        }
    }

    /// <summary>
    ///     Copies out the suffix of <paramref name="records"/> (chronological, oldest-first) at or
    ///     after <paramref name="from"/>, or the whole list if <paramref name="from"/> is null.
    ///     Every call to Query() has to hand back its own copy rather than <paramref name="records"/>
    ///     itself -- the cache is mutated under lock by later calls, and List&lt;T&gt; isn't safe to
    ///     read from concurrently with that. Scoping the copy to just the matching suffix (found by
    ///     walking backward from the newest entry, since the list is already in that order) is what
    ///     keeps a live-tail poll's per-request cost proportional to what's new since its `from`,
    ///     rather than to how many records the current day has accumulated in total.
    /// </summary>
    private static List<LogRecord> RecordsSince(List<LogRecord> records, DateTime? from)
    {
        if (!from.HasValue)
        {
            return new List<LogRecord>(records);
        }

        var startIndex = records.Count;

        while (startIndex > 0 && records[startIndex - 1].Timestamp >= from.Value)
        {
            startIndex--;
        }

        return records.GetRange(startIndex, records.Count - startIndex);
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

    private sealed class HotFileCache
    {
        public List<LogRecord> Records { get; } = new();

        public string Path { get; init; }

        public long Position { get; set; }
    }
}
