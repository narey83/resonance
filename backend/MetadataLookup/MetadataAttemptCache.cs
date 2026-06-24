// <copyright file="MetadataAttemptCache.cs" company="John Narey">
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
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.IO;
    using System.Text.Json;
    using Serilog;

    /// <summary>
    ///     A small persistent record of which files have already been looked up online, keyed by path
    ///     and file fingerprint (size + last-modified). Lets the enrichment service skip tracks it has
    ///     already attempted, so unmatchable files aren't re-queried on every pass. An attempt is retried
    ///     only if the file changes (new fingerprint) or after the configured retry window elapses.
    /// </summary>
    internal sealed class MetadataAttemptCache
    {
        private readonly string filePath;
        private readonly ConcurrentDictionary<string, Attempt> entries = new(StringComparer.Ordinal);
        private readonly object saveLock = new();
        private readonly ILogger log;

        public MetadataAttemptCache(string filePath, ILogger logger)
        {
            this.filePath = filePath;
            log = logger;
            Load();
        }

        /// <summary>
        ///     Returns true when the file has already been attempted with the same fingerprint and the
        ///     retry window has not yet elapsed.
        /// </summary>
        public bool ShouldSkip(string path, long size, long modified, string provider, TimeSpan retryAfter)
        {
            if (!entries.TryGetValue(path, out var attempt))
            {
                return false;
            }

            if (attempt.Size != size || attempt.Modified != modified)
            {
                return false; // file changed since the last attempt — look it up again
            }

            // a different provider hasn't tried this file yet — give it a chance. Entries written
            // before providers were configurable are treated as "musicbrainz".
            var attemptedProvider = string.IsNullOrEmpty(attempt.Provider) ? "musicbrainz" : attempt.Provider;
            if (!string.Equals(attemptedProvider, provider, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var ageSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - attempt.AttemptedAt;
            return ageSeconds < retryAfter.TotalSeconds;
        }

        /// <summary>Records an attempt for the specified file, fingerprint and provider.</summary>
        public void Record(string path, long size, long modified, string provider)
        {
            entries[path] = new Attempt(size, modified, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), provider);
        }

        /// <summary>Persists the cache to disk (atomic write via a temp file).</summary>
        public void Save()
        {
            lock (saveLock)
            {
                try
                {
                    var snapshot = new Dictionary<string, Attempt>(entries);
                    var tmp = filePath + ".tmp";
                    File.WriteAllText(tmp, JsonSerializer.Serialize(snapshot));
                    File.Move(tmp, filePath, overwrite: true);
                }
                catch (Exception ex)
                {
                    log.Warning("Could not persist metadata attempt cache: {Error}", ex.Message);
                }
            }
        }

        private void Load()
        {
            try
            {
                if (!File.Exists(filePath))
                {
                    return;
                }

                var loaded = JsonSerializer.Deserialize<Dictionary<string, Attempt>>(File.ReadAllText(filePath));
                if (loaded == null)
                {
                    return;
                }

                var pruned = 0;
                foreach (var (path, attempt) in loaded)
                {
                    // drop entries for deleted files, but only when the containing directory is
                    // present — so an unmounted/unavailable share doesn't wipe valid entries
                    if (!File.Exists(path) && DirectoryAccessible(path))
                    {
                        pruned++;
                        continue;
                    }

                    entries[path] = attempt;
                }

                log.Debug("Loaded {Count} metadata lookup attempt(s) from cache ({Pruned} stale entries pruned)", entries.Count, pruned);

                if (pruned > 0)
                {
                    Save();
                }
            }
            catch (Exception ex)
            {
                log.Warning("Could not load metadata attempt cache; starting fresh: {Error}", ex.Message);
            }
        }

        private static bool DirectoryAccessible(string path)
        {
            try
            {
                var dir = Path.GetDirectoryName(path);
                return !string.IsNullOrEmpty(dir) && Directory.Exists(dir);
            }
            catch
            {
                return false;
            }
        }

        private sealed record Attempt(long Size, long Modified, long AttemptedAt, string Provider = null);
    }
}
