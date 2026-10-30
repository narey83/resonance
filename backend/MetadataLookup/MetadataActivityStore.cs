// <copyright file="MetadataActivityStore.cs" company="John Narey">
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

namespace resonance.MetadataLookup
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Text.Json;
    using resonance.Common;
    using Serilog;

    /// <summary>Append-only lookup evidence; retains the latest twenty events per track in memory.</summary>
    internal sealed class MetadataActivityStore
    {
        private readonly string filePath;
        private readonly ILogger log;
        private readonly object gate = new();
        private readonly Dictionary<string, List<MetadataActivityEvent>> entries = new(StringComparer.Ordinal);
        private readonly Dictionary<string, MetadataActivityEvent> lastUpdates = new(StringComparer.Ordinal);

        public MetadataActivityStore(string filePath, ILogger log)
        {
            this.filePath = filePath;
            this.log = log;
            if (!File.Exists(filePath))
            {
                return;
            }

            try
            {
                foreach (var line in File.ReadLines(filePath))
                {
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    try
                    {
                        var entry = JsonSerializer.Deserialize<StoredEvent>(line);
                        var activity = entry?.Activity;
                        if (string.IsNullOrWhiteSpace(entry?.Path) || string.IsNullOrWhiteSpace(activity?.Id)
                            || activity.Fields == null || activity.At == default
                            || activity.Status is not ("Updated" or "Unchanged" or "NoMatch" or "Failed" or "Preview")
                            || (activity.Status == "Updated" && activity.Fields.Count == 0))
                        {
                            Healthy = false;
                            log.Warning("Ignoring an invalid metadata activity record");
                            continue;
                        }

                        Add(entry.Path, activity);
                    }
                    catch (JsonException)
                    {
                        Healthy = false;
                        log.Warning("Ignoring an incomplete metadata activity record");
                    }
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Healthy = false;
                log.Warning(ex, "Could not load metadata activity history");
            }
        }

        public bool Healthy { get; private set; } = true;

        public void Record(string path, MetadataActivityEvent activity)
        {
            lock (gate)
            {
                Add(path, activity);
                try
                {
                    // A leading newline isolates a partially written final record after a crash.
                    File.AppendAllText(filePath, "\n" + JsonSerializer.Serialize(new StoredEvent(MusicPath.ToRelative(path), activity)));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Healthy = false;
                    log.Warning(ex, "Could not persist metadata activity history");
                }
            }
        }

        public (MetadataActivityEvent[] History, MetadataActivityEvent LastUpdate) Get(string path)
        {
            lock (gate)
            {
                var key = MusicPath.ToRelative(path);
                return (entries.TryGetValue(key, out var history) ? history.ToArray() : [], lastUpdates.GetValueOrDefault(key));
            }
        }

        public IReadOnlyDictionary<string, (MetadataActivityEvent Latest, MetadataActivityEvent LastUpdate)> Summaries()
        {
            lock (gate)
            {
                return entries.ToDictionary(pair => pair.Key, pair => (pair.Value[0], lastUpdates.GetValueOrDefault(pair.Key)), StringComparer.Ordinal);
            }
        }

        private void Add(string path, MetadataActivityEvent activity)
        {
            var key = MusicPath.ToRelative(path);
            if (!entries.TryGetValue(key, out var history))
            {
                entries[key] = history = [];
            }

            history.Insert(0, activity);
            if (history.Count > 20)
            {
                history.RemoveAt(history.Count - 1);
            }

            if (activity.Status == "Updated")
            {
                lastUpdates[key] = activity;
            }
        }

        private sealed record StoredEvent(string Path, MetadataActivityEvent Activity);
    }
}
