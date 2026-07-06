// <copyright file="MusicRepository.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Data;
    using System.Data.Common;
    using System.Linq;
    using Npgsql;
    using resonance.Common;

    public class MusicRepository
    {
        public MusicRepository(string connectionString, bool usePostgres = false)
        {
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
        }

        private string ConnectionString { get; }
        private bool UsePostgres { get; }

        // Schema-qualified table name: "music"."tracks" for Postgres, "tracks" for SQLite
        private string T => UsePostgres ? "music.tracks" : "tracks";

        // Case-insensitive LIKE operator
        private string Like => UsePostgres ? "ILIKE" : "LIKE";

        // Case-insensitive equality (used in WHERE)
        private string IEq(string col) => UsePostgres ? $"{col} ILIKE" : $"{col} =";

        // Case-insensitive GROUP BY expression for a column
        private string GrpBy(string col) => UsePostgres ? $"lower({col})" : $"{col} COLLATE NOCASE";

        // Case-insensitive ORDER BY expression for a column
        private string OrdBy(string col, string dir = "ASC") => UsePostgres ? $"lower({col}) {dir}" : $"{col} COLLATE NOCASE {dir}";

        public void Initialize()
        {
            using var conn = OpenConnection();

            if (!UsePostgres)
            {
                using var pragmaCmd = conn.CreateCommand();
                pragmaCmd.CommandText = "PRAGMA journal_mode=WAL;";
                pragmaCmd.ExecuteNonQuery();
            }
            else
            {
                using var schemaCmd = conn.CreateCommand();
                schemaCmd.CommandText = "CREATE SCHEMA IF NOT EXISTS music";
                schemaCmd.ExecuteNonQuery();
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = UsePostgres
                ? $@"CREATE TABLE IF NOT EXISTS {T} (
                    path         TEXT PRIMARY KEY,
                    filename     TEXT NOT NULL,
                    directory    TEXT NOT NULL,
                    extension    TEXT NOT NULL,
                    file_size    BIGINT NOT NULL,
                    file_modified BIGINT NOT NULL,
                    indexed_at   BIGINT NOT NULL,
                    duration     DOUBLE PRECISION,
                    title        TEXT,
                    artist       TEXT,
                    album_artist TEXT,
                    album        TEXT,
                    year         INTEGER,
                    track_number INTEGER,
                    disc_number  INTEGER,
                    genre        TEXT,
                    bpm          INTEGER,
                    key_sig      TEXT,
                    comment      TEXT,
                    has_artwork  INTEGER NOT NULL DEFAULT 0,
                    tag_types    TEXT,
                    bit_rate     INTEGER,
                    sample_rate  INTEGER,
                    bit_depth    INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_tracks_directory ON {T}(directory);
                CREATE INDEX IF NOT EXISTS idx_tracks_artist    ON {T}(lower(artist));
                CREATE INDEX IF NOT EXISTS idx_tracks_album     ON {T}(lower(album));"
                : $@"CREATE TABLE IF NOT EXISTS {T} (
                    path         TEXT PRIMARY KEY,
                    filename     TEXT NOT NULL,
                    directory    TEXT NOT NULL,
                    extension    TEXT NOT NULL,
                    file_size    INTEGER NOT NULL,
                    file_modified INTEGER NOT NULL,
                    indexed_at   INTEGER NOT NULL,
                    duration     REAL,
                    title        TEXT,
                    artist       TEXT,
                    album_artist TEXT,
                    album        TEXT,
                    year         INTEGER,
                    track_number INTEGER,
                    disc_number  INTEGER,
                    genre        TEXT,
                    bpm          INTEGER,
                    key_sig      TEXT,
                    comment      TEXT,
                    has_artwork  INTEGER NOT NULL DEFAULT 0,
                    tag_types    TEXT,
                    bit_rate     INTEGER,
                    sample_rate  INTEGER,
                    bit_depth    INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_tracks_directory ON {T}(directory);
                CREATE INDEX IF NOT EXISTS idx_tracks_artist    ON {T}(artist COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_tracks_album     ON {T}(album  COLLATE NOCASE);";
            cmd.ExecuteNonQuery();

            // Migration: add tag_types column if it doesn't exist yet
            try
            {
                using var alter = conn.CreateCommand();
                alter.CommandText = $"ALTER TABLE {T} ADD COLUMN tag_types TEXT";
                alter.ExecuteNonQuery();
            }
            catch (Exception)
            { /* column already exists */
            }

            // Migration: add bit_rate/sample_rate/bit_depth columns if they don't exist yet
            foreach (var column in new[] { "bit_rate", "sample_rate", "bit_depth" })
            {
                try
                {
                    using var alter = conn.CreateCommand();
                    alter.CommandText = $"ALTER TABLE {T} ADD COLUMN {column} INTEGER";
                    alter.ExecuteNonQuery();
                }
                catch (Exception)
                { /* column already exists */
                }
            }
        }

        // Shared by Upsert and UpsertMany so the column/conflict handling can't drift between them.
        private string UpsertSql => $@"
                INSERT INTO {T}
                    (path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                     title, artist, album_artist, album, year, track_number, disc_number,
                     genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth)
                VALUES
                    (@path, @filename, @dir, @ext, @size, @mod, @idx, @dur,
                     @title, @artist, @aartist, @album, @year, @track, @disc,
                     @genre, @bpm, @key, @comment, @art, @tagtypes, @bitrate, @samplerate, @bitdepth)
                ON CONFLICT(path) DO UPDATE SET
                    filename=excluded.filename, directory=excluded.directory, extension=excluded.extension,
                    file_size=excluded.file_size, file_modified=excluded.file_modified, indexed_at=excluded.indexed_at,
                    duration=excluded.duration, title=excluded.title, artist=excluded.artist,
                    album_artist=excluded.album_artist, album=excluded.album, year=excluded.year,
                    track_number=excluded.track_number, disc_number=excluded.disc_number,
                    genre=excluded.genre, bpm=excluded.bpm, key_sig=excluded.key_sig,
                    comment=excluded.comment, has_artwork=excluded.has_artwork, tag_types=excluded.tag_types,
                    bit_rate=excluded.bit_rate, sample_rate=excluded.sample_rate, bit_depth=excluded.bit_depth";

        public void Upsert(MusicTrack t)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = UpsertSql;

            AddParam(cmd, "@path", MusicPath.ToRelative(t.Path));
            AddParam(cmd, "@filename", t.Filename);
            AddParam(cmd, "@dir", MusicPath.ToRelative(t.Directory));
            AddParam(cmd, "@ext", t.Extension);
            AddParam(cmd, "@size", t.FileSize);
            AddParam(cmd, "@mod", t.FileModified);
            AddParam(cmd, "@idx", t.IndexedAt);
            AddParam(cmd, "@dur", (object)t.Duration ?? DBNull.Value);
            AddParam(cmd, "@title", (object)t.Title ?? DBNull.Value);
            AddParam(cmd, "@artist", (object)t.Artist ?? DBNull.Value);
            AddParam(cmd, "@aartist", (object)t.AlbumArtist ?? DBNull.Value);
            AddParam(cmd, "@album", (object)t.Album ?? DBNull.Value);
            AddParam(cmd, "@year", (object)t.Year ?? DBNull.Value);
            AddParam(cmd, "@track", (object)t.TrackNumber ?? DBNull.Value);
            AddParam(cmd, "@disc", (object)t.DiscNumber ?? DBNull.Value);
            AddParam(cmd, "@genre", (object)t.Genre ?? DBNull.Value);
            AddParam(cmd, "@bpm", (object)t.Bpm ?? DBNull.Value);
            AddParam(cmd, "@key", (object)t.Key ?? DBNull.Value);
            AddParam(cmd, "@comment", (object)t.Comment ?? DBNull.Value);
            AddParam(cmd, "@art", t.HasArtwork ? 1 : 0);
            AddParam(cmd, "@tagtypes", (object)t.TagTypes ?? DBNull.Value);
            AddParam(cmd, "@bitrate", (object)t.BitRate ?? DBNull.Value);
            AddParam(cmd, "@samplerate", (object)t.SampleRate ?? DBNull.Value);
            AddParam(cmd, "@bitdepth", (object)t.BitDepth ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }

        /// <summary>
        ///     Upserts many tracks over a single connection, committing in chunks. This replaces ~N
        ///     connection-opens + auto-commits (one per <see cref="Upsert"/> call) with ~N/chunkSize commits,
        ///     which is dramatically faster during a full/forced library scan — especially on Postgres,
        ///     where each single-row commit is a network round-trip.
        /// </summary>
        /// <param name="tracks">The tracks to upsert.</param>
        /// <param name="chunkSize">Rows committed per transaction.</param>
        public void UpsertMany(IReadOnlyList<MusicTrack> tracks, int chunkSize = 500)
        {
            if (tracks is null || tracks.Count == 0)
            {
                return;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = UpsertSql;

            // Parameters are created once and their values reset per row; mirrors the untyped-parameter
            // approach used by the single-row Upsert (Npgsql/Sqlite infer the type from the value).
            foreach (var name in new[]
            {
                "@path", "@filename", "@dir", "@ext", "@size", "@mod", "@idx", "@dur",
                "@title", "@artist", "@aartist", "@album", "@year", "@track", "@disc",
                "@genre", "@bpm", "@key", "@comment", "@art", "@tagtypes",
                "@bitrate", "@samplerate", "@bitdepth",
            })
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                cmd.Parameters.Add(p);
            }

            DbTransaction tx = null;

            try
            {
                for (var i = 0; i < tracks.Count; i++)
                {
                    if (i % chunkSize == 0)
                    {
                        tx?.Commit();
                        tx?.Dispose();
                        tx = conn.BeginTransaction();
                        cmd.Transaction = tx;
                    }

                    var t = tracks[i];
                    cmd.Parameters["@path"].Value = MusicPath.ToRelative(t.Path);
                    cmd.Parameters["@filename"].Value = t.Filename;
                    cmd.Parameters["@dir"].Value = MusicPath.ToRelative(t.Directory);
                    cmd.Parameters["@ext"].Value = t.Extension;
                    cmd.Parameters["@size"].Value = t.FileSize;
                    cmd.Parameters["@mod"].Value = t.FileModified;
                    cmd.Parameters["@idx"].Value = t.IndexedAt;
                    cmd.Parameters["@dur"].Value = (object)t.Duration ?? DBNull.Value;
                    cmd.Parameters["@title"].Value = (object)t.Title ?? DBNull.Value;
                    cmd.Parameters["@artist"].Value = (object)t.Artist ?? DBNull.Value;
                    cmd.Parameters["@aartist"].Value = (object)t.AlbumArtist ?? DBNull.Value;
                    cmd.Parameters["@album"].Value = (object)t.Album ?? DBNull.Value;
                    cmd.Parameters["@year"].Value = (object)t.Year ?? DBNull.Value;
                    cmd.Parameters["@track"].Value = (object)t.TrackNumber ?? DBNull.Value;
                    cmd.Parameters["@disc"].Value = (object)t.DiscNumber ?? DBNull.Value;
                    cmd.Parameters["@genre"].Value = (object)t.Genre ?? DBNull.Value;
                    cmd.Parameters["@bpm"].Value = (object)t.Bpm ?? DBNull.Value;
                    cmd.Parameters["@key"].Value = (object)t.Key ?? DBNull.Value;
                    cmd.Parameters["@comment"].Value = (object)t.Comment ?? DBNull.Value;
                    cmd.Parameters["@art"].Value = t.HasArtwork ? 1 : 0;
                    cmd.Parameters["@tagtypes"].Value = (object)t.TagTypes ?? DBNull.Value;
                    cmd.Parameters["@bitrate"].Value = (object)t.BitRate ?? DBNull.Value;
                    cmd.Parameters["@samplerate"].Value = (object)t.SampleRate ?? DBNull.Value;
                    cmd.Parameters["@bitdepth"].Value = (object)t.BitDepth ?? DBNull.Value;
                    cmd.ExecuteNonQuery();
                }

                tx?.Commit();
            }
            finally
            {
                tx?.Dispose();
            }
        }

        public void ClearAll()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {T}";
            cmd.ExecuteNonQuery();
        }

        public void DeletePaths(IEnumerable<string> paths)
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {T} WHERE path = @p";
            cmd.Transaction = tx;
            var p = cmd.CreateParameter();
            p.ParameterName = "@p";
            p.DbType = DbType.String;
            cmd.Parameters.Add(p);
            foreach (var path in paths)
            {
                p.Value = MusicPath.ToRelative(path);
                cmd.ExecuteNonQuery();
            }

            tx.Commit();
        }

        /// <summary>Returns (path → (size, modified)) for all rows — used for change detection.</summary>
        /// <returns></returns>
        public Dictionary<string, (long Size, long Modified)> GetAllFingerprints()
        {
            var result = new Dictionary<string, (long, long)>(StringComparer.Ordinal);
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT path, file_size, file_modified FROM {T}";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                result[MusicPath.ToAbsolute(r.GetString(0))] = (r.GetInt64(1), r.GetInt64(2));
            }

            return result;
        }

        public MusicLibraryQueryResult Query(
            string search, string artist, string album,
            string genre, int? year, string folder,
            bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork,
            int limit, int offset, string sort = null, bool descending = false)
        {
            using var conn = OpenConnection();

            var conditions = new System.Collections.Generic.List<string>();
            var hasSearch = !string.IsNullOrWhiteSpace(search);
            var hasArtist = !string.IsNullOrWhiteSpace(artist);
            var hasAlbum = !string.IsNullOrWhiteSpace(album);
            var hasGenre = !string.IsNullOrWhiteSpace(genre);
            var hasYear = year.HasValue;
            var hasFolder = !string.IsNullOrWhiteSpace(folder);

            if (hasSearch)
            {
                conditions.Add($"(title {Like} @s OR artist {Like} @s OR album {Like} @s OR key_sig {Like} @s)");
            }

            if (hasArtist)
            {
                conditions.Add($"{IEq("artist")} @artist");
            }

            if (hasAlbum)
            {
                conditions.Add($"{IEq("album")} @album");
            }

            if (hasGenre)
            {
                conditions.Add($"{IEq("genre")} @genre");
            }

            if (hasYear)
            {
                conditions.Add("year = @year");
            }

            if (hasFolder)
            {
                conditions.Add("(directory = @folder OR directory LIKE @folderPrefix)");
            }

            if (missingKey)
            {
                conditions.Add("(key_sig IS NULL OR key_sig = '')");
            }

            if (missingBpm)
            {
                conditions.Add("bpm IS NULL");
            }

            if (missingTitle)
            {
                conditions.Add("(title IS NULL OR title = '')");
            }

            if (missingArtist)
            {
                conditions.Add("(artist IS NULL OR artist = '')");
            }

            if (missingArtwork)
            {
                conditions.Add("has_artwork = 0");
            }

            var where = conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : string.Empty;
            var pattern = $"%{search?.Trim()}%";

            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = $"SELECT COUNT(*) FROM {T} {where}";
            if (hasSearch)
            {
                AddParam(countCmd, "@s", pattern);
            }

            if (hasArtist)
            {
                AddParam(countCmd, "@artist", artist);
            }

            if (hasAlbum)
            {
                AddParam(countCmd, "@album", album);
            }

            if (hasGenre)
            {
                AddParam(countCmd, "@genre", genre);
            }

            if (hasYear)
            {
                AddParam(countCmd, "@year", year.Value);
            }

            if (hasFolder)
            {
                AddParam(countCmd, "@folder", MusicPath.ToRelative(folder));
                AddParam(countCmd, "@folderPrefix", MusicPath.ToRelative(folder).TrimEnd('/') + "/%");
            }

            var total = Convert.ToInt32(countCmd.ExecuteScalar());

            // The sort key is mapped through a whitelist; user input never reaches the SQL directly
            var dir = descending ? "DESC" : "ASC";
            var orderBy = sort?.ToLowerInvariant() switch
            {
                "title" => $"{OrdBy("title", dir)}, {OrdBy("artist")}",
                "album" => $"{OrdBy("album", dir)}, disc_number, track_number",
                "year" => $"year {dir}, {OrdBy("artist")}, {OrdBy("album")}, track_number",
                "duration" => $"duration {dir}, {OrdBy("title")}",
                "bpm" => $"bpm {dir}, {OrdBy("title")}",
                "added" => $"indexed_at {dir}, {OrdBy("title")}",
                _ => $"{OrdBy("artist", dir)}, {OrdBy("album")}, disc_number, track_number, {OrdBy("title")}",
            };

            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth
                FROM {T} {where}
                ORDER BY {orderBy}
                LIMIT @limit OFFSET @offset";
            if (hasSearch)
            {
                AddParam(cmd, "@s", pattern);
            }

            if (hasArtist)
            {
                AddParam(cmd, "@artist", artist);
            }

            if (hasAlbum)
            {
                AddParam(cmd, "@album", album);
            }

            if (hasGenre)
            {
                AddParam(cmd, "@genre", genre);
            }

            if (hasYear)
            {
                AddParam(cmd, "@year", year.Value);
            }

            if (hasFolder)
            {
                AddParam(cmd, "@folder", MusicPath.ToRelative(folder));
                AddParam(cmd, "@folderPrefix", MusicPath.ToRelative(folder).TrimEnd('/') + "/%");
            }

            AddParam(cmd, "@limit", limit);
            AddParam(cmd, "@offset", offset);

            var tracks = new List<MusicTrack>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                tracks.Add(ReadRow(reader));
            }

            return new MusicLibraryQueryResult(total, offset, limit, tracks);
        }

        public IReadOnlyList<MusicGenre> GetGenres()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT MIN(genre) AS genre, COUNT(*) AS track_count, SUM(duration) AS total_dur
                FROM {T}
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY {GrpBy("genre")}
                ORDER BY {OrdBy("genre")}";
            var results = new List<MusicGenre>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicGenre(
                    Genre: r.GetString(0),
                    TrackCount: r.GetInt32(1),
                    TotalDuration: r.IsDBNull(2) ? null : r.GetDouble(2)));
            }

            return results;
        }

        public IReadOnlyList<MusicYear> GetYears()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT year,
                       COUNT(*) AS track_count,
                       COUNT(DISTINCT album || '|' || COALESCE(NULLIF(album_artist,''), artist)) AS album_count
                FROM {T}
                WHERE year IS NOT NULL
                GROUP BY year
                ORDER BY year DESC";
            var results = new List<MusicYear>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicYear(
                    Year: r.GetInt32(0),
                    TrackCount: r.GetInt32(1),
                    AlbumCount: r.GetInt32(2)));
            }

            return results;
        }

        public IReadOnlyList<MusicFolder> GetFolders()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT directory,
                       COUNT(*) AS track_count,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at) AS indexed_at
                FROM {T}
                GROUP BY directory
                ORDER BY directory";
            var results = new List<MusicFolder>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var path = MusicPath.ToAbsolute(r.GetString(0));
                var name = System.IO.Path.GetFileName(path);
                results.Add(new MusicFolder(
                    Path: path,
                    Name: string.IsNullOrEmpty(name) ? path : name,
                    TrackCount: r.GetInt32(1),
                    CoverPath: r.IsDBNull(2) ? null : MusicPath.ToAbsolute(r.GetString(2)),
                    HasArtwork: r.GetInt32(3) != 0,
                    IndexedAt: r.GetInt64(4)));
            }

            return results;
        }

        public (int Total, double TotalDuration) GetStats()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*), COALESCE(SUM(duration), 0.0) FROM {T}";
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                return (Convert.ToInt32(r.GetValue(0)), r.IsDBNull(1) ? 0.0 : r.GetDouble(1));
            }

            return (0, 0.0);
        }

        /// <summary>
        /// A cheap content version of the whole library: track count + the latest index timestamp.
        /// Changes on any add (count up + new indexed_at), update (re-index bumps indexed_at to the
        /// new max) or delete (count down). Lets a client skip the full list sync when unchanged.
        /// </summary>
        /// <returns>A stable <c>"{count}:{maxIndexedAt}"</c> token.</returns>
        public string GetLibraryVersion()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*), COALESCE(MAX(indexed_at), 0) FROM {T}";
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                return $"{Convert.ToInt64(r.GetValue(0))}:{Convert.ToInt64(r.GetValue(1))}";
            }

            return "0:0";
        }

        public IReadOnlyList<MusicAlbum> GetAlbums(string artistFilter = null)
        {
            using var conn = OpenConnection();
            var hasFilter = !string.IsNullOrWhiteSpace(artistFilter);
            var where = hasFilter
                ? $"WHERE {IEq("COALESCE(NULLIF(album_artist,''), artist)")} @artist"
                : string.Empty;
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT MIN(album) AS album,
                       CASE WHEN MAX(NULLIF(album_artist,'')) IS NOT NULL THEN MAX(NULLIF(album_artist,''))
                            WHEN COUNT(DISTINCT artist) > 1              THEN 'Various Artists'
                            ELSE MIN(artist) END AS artist,
                       MAX(NULLIF(album_artist,'')) AS album_artist,
                       MAX(year)          AS year,
                       COUNT(*)           AS track_count,
                       SUM(duration)      AS total_dur,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork)   AS has_art,
                       MIN(indexed_at)    AS indexed_at,
                       MIN(directory)     AS directory
                FROM {T} {where}
                GROUP BY {GrpBy("album")}, COALESCE(NULLIF(album_artist,''), directory)
                HAVING MIN(album) IS NOT NULL AND MIN(album) != ''
                ORDER BY {OrdBy("album")}";
            if (hasFilter)
            {
                AddParam(cmd, "@artist", artistFilter);
            }

            var results = new List<MusicAlbum>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicAlbum(
                    Album: r.IsDBNull(0) ? string.Empty : r.GetString(0),
                    Artist: r.IsDBNull(1) ? string.Empty : r.GetString(1),
                    AlbumArtist: r.IsDBNull(2) ? null : r.GetString(2),
                    Year: r.IsDBNull(3) ? null : (int?)r.GetInt32(3),
                    TrackCount: r.GetInt32(4),
                    TotalDuration: r.IsDBNull(5) ? null : (double?)r.GetDouble(5),
                    CoverPath: r.IsDBNull(6) ? null : MusicPath.ToAbsolute(r.GetString(6)),
                    HasArtwork: r.GetInt32(7) != 0,
                    IndexedAt: r.GetInt64(8),
                    Directory: r.IsDBNull(9) ? null : MusicPath.ToAbsolute(r.GetString(9))));
            }

            return results;
        }

        public IReadOnlyList<MusicArtist> GetArtists()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT MIN(COALESCE(NULLIF(album_artist,''), artist)) AS display_artist,
                       COUNT(DISTINCT {GrpBy("album")})               AS album_count,
                       COUNT(*)                                  AS track_count,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork)                          AS has_art,
                       MIN(indexed_at)                           AS indexed_at
                FROM {T}
                WHERE artist IS NOT NULL AND artist != ''
                GROUP BY {GrpBy("COALESCE(NULLIF(album_artist,''), artist)")}
                ORDER BY {OrdBy("COALESCE(NULLIF(album_artist,''), artist)")}";

            var results = new List<MusicArtist>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicArtist(
                    Artist: r.IsDBNull(0) ? string.Empty : r.GetString(0),
                    AlbumCount: r.GetInt32(1),
                    TrackCount: r.GetInt32(2),
                    CoverPath: r.IsDBNull(3) ? null : MusicPath.ToAbsolute(r.GetString(3)),
                    HasArtwork: r.GetInt32(4) != 0,
                    IndexedAt: r.GetInt64(5)));
            }

            return results;
        }

        public IReadOnlyList<MusicAlbum> GetRecentlyAdded(int limit)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT MIN(album) AS album,
                       CASE WHEN MAX(NULLIF(album_artist,'')) IS NOT NULL THEN MAX(NULLIF(album_artist,''))
                            WHEN COUNT(DISTINCT artist) > 1              THEN 'Various Artists'
                            ELSE MIN(artist) END AS artist,
                       MAX(NULLIF(album_artist,'')) AS album_artist,
                       MAX(year)        AS year,
                       COUNT(*)         AS track_count,
                       SUM(duration)    AS total_dur,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at)  AS indexed_at,
                       MIN(directory)   AS directory
                FROM {T}
                GROUP BY {GrpBy("album")}, COALESCE(NULLIF(album_artist,''), directory)
                HAVING MIN(album) IS NOT NULL AND MIN(album) != ''
                ORDER BY MAX(indexed_at) DESC
                LIMIT @limit";
            AddParam(cmd, "@limit", limit);

            var results = new List<MusicAlbum>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicAlbum(
                    Album: r.IsDBNull(0) ? string.Empty : r.GetString(0),
                    Artist: r.IsDBNull(1) ? string.Empty : r.GetString(1),
                    AlbumArtist: r.IsDBNull(2) ? null : r.GetString(2),
                    Year: r.IsDBNull(3) ? null : (int?)r.GetInt32(3),
                    TrackCount: r.GetInt32(4),
                    TotalDuration: r.IsDBNull(5) ? null : (double?)r.GetDouble(5),
                    CoverPath: r.IsDBNull(6) ? null : MusicPath.ToAbsolute(r.GetString(6)),
                    HasArtwork: r.GetInt32(7) != 0,
                    IndexedAt: r.GetInt64(8),
                    Directory: r.IsDBNull(9) ? null : MusicPath.ToAbsolute(r.GetString(9))));
            }

            return results;
        }

        public IReadOnlyList<MusicTrack> GetKeyedTracks()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth
                FROM {T}
                WHERE key_sig IS NOT NULL AND key_sig != ''
                ORDER BY {OrdBy("artist")}";

            var results = new List<MusicTrack>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(ReadRow(r));
            }

            return results;
        }

        public void RenameTrackPath(string oldPath, string newPath, string newFilename)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"UPDATE {T} SET path = @newPath, filename = @newFilename WHERE path = @oldPath";
            AddParam(cmd, "@oldPath", MusicPath.ToRelative(oldPath));
            AddParam(cmd, "@newPath", MusicPath.ToRelative(newPath));
            AddParam(cmd, "@newFilename", newFilename);
            cmd.ExecuteNonQuery();
        }

        /// <summary>Updates all track paths that live under <paramref name="oldDir"/> to use <paramref name="newDir"/> as their prefix.</summary>
        public void RenameDirectory(string oldDir, string newDir)
        {
            using var conn = OpenConnection();
            var relOldDir = MusicPath.ToRelative(oldDir);
            var relNewDir = MusicPath.ToRelative(newDir);
            var prefixStart = relOldDir.Length + 1; // substr is 1-indexed; +1 to skip the trailing slash
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                UPDATE {T} SET
                    path      = @newDir || substr(path,      @start),
                    directory = @newDir || substr(directory, @start)
                WHERE directory = @oldDir OR directory LIKE @prefix";
            AddParam(cmd, "@oldDir", relOldDir);
            AddParam(cmd, "@newDir", relNewDir);
            AddParam(cmd, "@start", prefixStart);
            AddParam(cmd, "@prefix", relOldDir.TrimEnd('/') + "/%");
            cmd.ExecuteNonQuery();
        }

        public MusicTrack? GetByPath(string path)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth
                FROM {T} WHERE path=@path";
            AddParam(cmd, "@path", MusicPath.ToRelative(path));
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadRow(r) : null;
        }

        /// <summary>
        /// Resolves many paths in one shot (chunked WHERE path IN (...)), preserving caller order and
        /// skipping paths no longer in the library. Replaces a per-path GetByPath N+1 for callers like
        /// loved-track resolution.
        /// </summary>
        /// <returns></returns>
        public IReadOnlyList<MusicTrack> GetByPaths(IReadOnlyList<string> paths)
        {
            if (paths == null || paths.Count == 0)
            {
                return System.Array.Empty<MusicTrack>();
            }

            using var conn = OpenConnection();
            var byPath = new Dictionary<string, MusicTrack>(StringComparer.Ordinal);

            // Relative form is both what's stored and what we key lookups by below — paths[i] may be
            // absolute (e.g. loved-track entries resolved back to absolute by their EF ValueConverter).
            var relativePaths = paths.Select(MusicPath.ToRelative).ToArray();

            // Chunk to stay well under SQLite's bound-parameter ceiling (PG allows far more).
            const int ChunkSize = 400;
            for (var start = 0; start < relativePaths.Length; start += ChunkSize)
            {
                var end = Math.Min(start + ChunkSize, relativePaths.Length);
                using var cmd = conn.CreateCommand();
                var names = new List<string>(end - start);
                for (var i = start; i < end; i++)
                {
                    var name = "@p" + i;
                    names.Add(name);
                    AddParam(cmd, name, relativePaths[i]);
                }

                cmd.CommandText = $@"
                    SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                           title, artist, album_artist, album, year, track_number, disc_number,
                           genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth
                    FROM {T} WHERE path IN ({string.Join(",", names)})";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    var row = ReadRow(r);
                    byPath[row.Path] = row;
                }
            }

            var result = new List<MusicTrack>(paths.Count);
            foreach (var p in relativePaths)
            {
                if (byPath.TryGetValue(p, out var track))
                {
                    result.Add(track);
                }
            }

            return result;
        }

        /// <summary>
        /// Finds a track that lives in the same directory and shares the same filename stem
        /// as <paramref name="path"/> but with a different extension — e.g. after a file is
        /// converted from <c>.opus</c> to <c>.mp3</c>. Returns <see langword="null"/> if none exists.
        /// </summary>
        /// <returns></returns>
        public MusicTrack? FindByPathIgnoringExtension(string path)
        {
            var directory = System.IO.Path.GetDirectoryName(path);
            var stem = System.IO.Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrEmpty(directory) || string.IsNullOrEmpty(stem))
            {
                return null;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth
                FROM {T} WHERE directory=@dir";
            AddParam(cmd, "@dir", MusicPath.ToRelative(directory));
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var row = ReadRow(r);
                if (!string.Equals(row.Path, path, StringComparison.Ordinal) &&
                    string.Equals(System.IO.Path.GetFileNameWithoutExtension(row.Filename), stem, StringComparison.OrdinalIgnoreCase))
                {
                    return row;
                }
            }

            return null;
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private DbConnection OpenConnection()
        {
            DbConnection conn = new NpgsqlConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private static void AddParam(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value;
            cmd.Parameters.Add(p);
        }

        private static MusicTrack ReadRow(DbDataReader r) => new(
            Path: MusicPath.ToAbsolute(r.GetString(0)),
            Filename: r.GetString(1),
            Directory: MusicPath.ToAbsolute(r.GetString(2)),
            Extension: r.GetString(3),
            FileSize: r.GetInt64(4),
            FileModified: r.GetInt64(5),
            IndexedAt: r.GetInt64(6),
            Duration: r.IsDBNull(7) ? null : r.GetDouble(7),
            Title: r.IsDBNull(8) ? null : r.GetString(8),
            Artist: r.IsDBNull(9) ? null : r.GetString(9),
            AlbumArtist: r.IsDBNull(10) ? null : r.GetString(10),
            Album: r.IsDBNull(11) ? null : r.GetString(11),
            Year: r.IsDBNull(12) ? null : r.GetInt32(12),
            TrackNumber: r.IsDBNull(13) ? null : r.GetInt32(13),
            DiscNumber: r.IsDBNull(14) ? null : r.GetInt32(14),
            Genre: r.IsDBNull(15) ? null : r.GetString(15),
            Bpm: r.IsDBNull(16) ? null : r.GetInt32(16),
            Key: r.IsDBNull(17) ? null : r.GetString(17),
            Comment: r.IsDBNull(18) ? null : r.GetString(18),
            HasArtwork: r.GetInt32(19) != 0,
            TagTypes: r.IsDBNull(20) ? null : r.GetString(20),
            BitRate: r.IsDBNull(21) ? null : r.GetInt32(21),
            SampleRate: r.IsDBNull(22) ? null : r.GetInt32(22),
            BitDepth: r.IsDBNull(23) ? null : r.GetInt32(23));
    }
}
