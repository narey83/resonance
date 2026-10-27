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
    using resonance.Common;
    using Serilog;

    /// <summary>
    ///     A small persistent record of which files have already been looked up online, keyed by path
    ///     relative to the configured music root. Automatic passes skip every prior attempt; only an
    ///     explicit full rescan or per-track lookup retries it. Moving a host or container mount must
    ///     not make an already-attempted track appear new.
    /// </summary>
    internal sealed class MetadataAttemptCache
    {
        /// <summary>The recorded outcome of an attempt that found no confident match.</summary>
        public const string OutcomeNoMatch = "nomatch";

        /// <summary>The recorded outcome of an attempt whose match was written to the file.</summary>
        public const string OutcomeWritten = "written";

        // Absolute music roots from before the shares migration to root-relative paths; entries
        // keyed under these are re-keyed to their relative form at load.
        private static readonly string[] LegacyAbsoluteRoots = ["/mnt/data/music/"];

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
        ///     Returns true when the file has already been attempted, in which case automatic passes
        ///     must not attempt it again. Any prior attempt disqualifies the file — regardless of
        ///     identity, provider set or age: mass re-attempts rewrite tags users already fixed, and
        ///     a file the providers couldn't fill once is very unlikely to be filled later. Only a
        ///     user-requested full re-scan (which bypasses this cache entirely) or the tag editor's
        ///     per-track lookup queries it again.
        /// </summary>
        /// <returns>A value indicating whether the file has already been attempted.</returns>
        public bool ShouldSkip(string path) => entries.ContainsKey(NormalizeKey(path));

        /// <summary>Records an attempt for the specified file, query identity, provider and outcome.</summary>
        public void Record(string path, string identity, string provider, string outcome = null)
        {
            entries[NormalizeKey(path)] = new Attempt(identity, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), provider, outcome);
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

        private static string NormalizeKey(string path)
        {
            var key = MusicPath.ToRelative(path);
            foreach (var root in LegacyAbsoluteRoots)
            {
                if (key.StartsWith(root, StringComparison.Ordinal))
                {
                    return key[root.Length..];
                }
            }

            return key;
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
                var migrated = 0;
                foreach (var (path, attempt) in loaded)
                {
                    // Normalize before checking existence: old mount paths may no longer exist,
                    // while the corresponding file is present under the current music root.
                    var key = NormalizeKey(path);
                    if (!string.Equals(key, path, StringComparison.Ordinal))
                    {
                        migrated++;
                    }

                    // Relative keys are storage identities, not paths relative to the process cwd.
                    // Without a configured root, retain them until the filesystem can be resolved.
                    var physicalPath = MusicPath.ToAbsolute(key);
                    if (Path.IsPathRooted(physicalPath) && !File.Exists(physicalPath) && DirectoryAccessible(physicalPath))
                    {
                        pruned++;
                        continue;
                    }

                    if (!entries.TryGetValue(key, out var existing) || existing.AttemptedAt < attempt.AttemptedAt)
                    {
                        entries[key] = attempt;
                    }
                }

                log.Debug("Loaded {Count} metadata lookup attempt(s) from cache ({Pruned} stale entries pruned, {Migrated} legacy paths re-keyed)", entries.Count, pruned, migrated);

                if (pruned > 0 || migrated > 0)
                {
                    Save();
                }
            }
            catch (Exception ex)
            {
                log.Warning("Could not load metadata attempt cache; starting fresh: {Error}", ex.Message);
            }
        }

        private sealed record Attempt(string Identity, long AttemptedAt, string Provider = null, string Outcome = null);
    }
}
