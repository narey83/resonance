// <copyright file="ArtworkStore.cs" company="John Narey">
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

namespace resonance.MusicLibrary
{
    using System;
    using System.Data.Common;
    using Npgsql;
    using resonance.Common;
    using Serilog;

    /// <summary>
    ///     Persistent cache of resized album artwork, keyed by track and requested size.
    /// </summary>
    /// <remarks>
    ///     Producing a thumbnail means reading the file with TagLib, decoding the embedded image and
    ///     resizing it — measured at 0.6 to 1.5 seconds per cover. That was held only in memory, so
    ///     every backend restart threw the lot away and a library of 48k tracks paid it again, one
    ///     slow cover at a time. Here it survives restarts and each cover is produced exactly once.
    ///
    ///     Follows the same shape as <see cref="resonance.Analysis.AnalysisStore"/>: a masked
    ///     (library-relative) filename as the key, with the file's size stored alongside so that
    ///     re-tagging or replacing a track invalidates its artwork instead of serving the old cover
    ///     forever.
    /// </remarks>
    public class ArtworkStore
    {
        public ArtworkStore(string connectionString)
        {
            ConnectionString = connectionString;
            EnsureSchema();
        }

        private string ConnectionString { get; }

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Library);

        /// <summary>
        ///     Returns the cached artwork for a track at a given size, or null when it isn't cached
        ///     or the file has changed since it was.
        /// </summary>
        /// <param name="path">The absolute path of the track.</param>
        /// <param name="size">The requested size; 0 for the original, unresized image.</param>
        /// <param name="fileSize">The track's current size on disk, used to detect a changed file.</param>
        /// <returns>The cached bytes and mime type, or null.</returns>
        public (byte[] Bytes, string Mime)? Get(string path, int size, long fileSize)
        {
            try
            {
                using var conn = OpenConnection();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    SELECT bytes, mime FROM music.artwork_cache
                    WHERE masked_filename = @m AND size = @z AND file_size = @s";
                AddParam(cmd, "@m", Key(path));
                AddParam(cmd, "@z", size);
                AddParam(cmd, "@s", fileSize);

                using var reader = cmd.ExecuteReader();

                if (!reader.Read() || reader.IsDBNull(0))
                {
                    return null;
                }

                return ((byte[])reader.GetValue(0), reader.GetString(1));
            }
            catch (Exception ex)
            {
                // A cache is never worth failing a request over — fall through and regenerate.
                Log.Debug("Artwork cache read failed for {Path}: {Message}", path, ex.Message);
                return null;
            }
        }

        /// <summary>
        ///     Stores artwork for a track at a given size, replacing any previous entry.
        /// </summary>
        /// <param name="path">The absolute path of the track.</param>
        /// <param name="size">The size the image was rendered at; 0 for the original.</param>
        /// <param name="fileSize">The track's size on disk at the time of rendering.</param>
        /// <param name="bytes">The encoded image.</param>
        /// <param name="mime">The image's mime type.</param>
        public void Set(string path, int size, long fileSize, byte[] bytes, string mime)
        {
            try
            {
                using var conn = OpenConnection();
                using var cmd = conn.CreateCommand();

                // file_size is part of the update, not the key: a re-tagged track keeps one row and
                // replaces its artwork, rather than accumulating one per version of the file.
                cmd.CommandText = @"
                    INSERT INTO music.artwork_cache (masked_filename, size, file_size, mime, bytes, cached_at)
                    VALUES (@m, @z, @s, @t, @b, @c)
                    ON CONFLICT (masked_filename, size) DO UPDATE SET
                        file_size = excluded.file_size,
                        mime      = excluded.mime,
                        bytes     = excluded.bytes,
                        cached_at = excluded.cached_at";
                AddParam(cmd, "@m", Key(path));
                AddParam(cmd, "@z", size);
                AddParam(cmd, "@s", fileSize);
                AddParam(cmd, "@t", mime);
                AddParam(cmd, "@b", bytes);
                AddParam(cmd, "@c", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
                cmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Log.Debug("Artwork cache write failed for {Path}: {Message}", path, ex.Message);
            }
        }

        /// <summary>
        ///     Drops cached artwork for the given tracks, e.g. when they leave the library.
        /// </summary>
        /// <param name="paths">The absolute paths whose artwork should be forgotten.</param>
        public void Evict(System.Collections.Generic.IEnumerable<string> paths)
        {
            if (paths is null)
            {
                return;
            }

            try
            {
                using var conn = OpenConnection();

                foreach (var path in paths)
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = "DELETE FROM music.artwork_cache WHERE masked_filename = @m";
                    AddParam(cmd, "@m", Key(path));
                    cmd.ExecuteNonQuery();
                }
            }
            catch (Exception ex)
            {
                Log.Debug("Artwork cache eviction failed: {Message}", ex.Message);
            }
        }

        private static string Key(string path) => MusicPath.ToRelative(path);

        private static void AddParam(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }

        private DbConnection OpenConnection()
        {
            DbConnection conn = new NpgsqlConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private void EnsureSchema()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                CREATE SCHEMA IF NOT EXISTS music;
                CREATE TABLE IF NOT EXISTS music.artwork_cache (
                    masked_filename  TEXT NOT NULL,
                    size             INTEGER NOT NULL,
                    file_size        BIGINT NOT NULL,
                    mime             TEXT NOT NULL,
                    bytes            BYTEA NOT NULL,
                    cached_at        BIGINT NOT NULL,
                    PRIMARY KEY (masked_filename, size)
                )";
            cmd.ExecuteNonQuery();
        }
    }
}
