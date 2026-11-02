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
    using Microsoft.Data.Sqlite;
    using Npgsql;
    using resonance.Common;

    /// <summary>Queries and indexes the music library.</summary>
    public partial class MusicRepository
    {
        // The A-Z rail buckets a row by the first character of its trimmed value, uppercased;
        // anything outside A-Z falls under '#'. Spelled out as an IN list rather than
        // BETWEEN 'A' AND 'Z' so the bucketing does not shift with the database collation
        // (en_US.utf8 sorts accented letters inside the A-Z range; the client's alphaKey does not).
        private const string AlphaLetters = "'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'";

        public MusicRepository(string connectionString, bool usePostgres = false)
        {
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
        }

        private string ConnectionString { get; }
        private bool UsePostgres { get; }

        // Schema-qualified table name: "music"."tracks" for Postgres, "tracks" for SQLite
        private string T => UsePostgres ? "music.tracks" : "tracks";

        // The analysis cache, which keys on the same relative path this table stores and carries
        // the same file_size guard — so "does this track have a waveform?" is answerable here as
        // a join, with none of the filesystem work the analysis endpoint has to do per request.
        private string TA => UsePostgres ? "analysis.track_analysis" : "track_analysis";

        // Preserve explicit tags; expose no-tag-write analysis in normal library rows.
        private string CachedBpm => $"COALESCE(NULLIF({T}.bpm, 0), (SELECT c.detected_bpm FROM {CacheSource("c")} WHERE {CacheMatch("c")}), CAST(ROUND(CAST({SummaryFact("bpm")} AS DOUBLE PRECISION)) AS INTEGER))";
        private string CachedKey => $"COALESCE(NULLIF({T}.key_sig, ''), (SELECT c.detected_key FROM {CacheSource("c")} WHERE {CacheMatch("c")}), {SummaryFact("key")})";

        // Case-insensitive LIKE operator
        private string Like => UsePostgres ? "ILIKE" : "LIKE";

        // "Every metric this track could have, it has." Key and BPM are tags on the track row;
        // waveform and loudness live in the analysis cache row. Written once, as a predicate over a
        // named cache alias, so the list filter (correlated subquery) and the stats count (join)
        // apply the identical rule.
        private string FullyAnalysedExists =>
            $"EXISTS (SELECT 1 FROM {CacheSource("fa")} WHERE {CacheMatch("fa")} AND {FullyAnalysed("fa")})";

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
                    file_size=excluded.file_size, file_modified=excluded.file_modified,
                    duration=excluded.duration, title=excluded.title, artist=excluded.artist,
                    album_artist=excluded.album_artist, album=excluded.album, year=excluded.year,
                    track_number=excluded.track_number, disc_number=excluded.disc_number,
                    genre=excluded.genre, bpm=excluded.bpm, key_sig=excluded.key_sig,
                    comment=excluded.comment, has_artwork=excluded.has_artwork, tag_types=excluded.tag_types,
                    bit_rate=excluded.bit_rate, sample_rate=excluded.sample_rate, bit_depth=excluded.bit_depth";

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
                CREATE INDEX IF NOT EXISTS idx_tracks_album     ON {T}(lower(album));

                -- The list is paged, so its ORDER BY runs once per page rather than once per
                -- session. These match the two orderings the library opens in, column for column
                -- (including the path tiebreaker), so a page is an index walk instead of a seq
                -- scan and top-N sort of all 48k rows — which cost ~500ms of every page fetch.
                CREATE INDEX IF NOT EXISTS idx_tracks_sort_title ON {T}(lower(title), lower(artist), path);
                CREATE INDEX IF NOT EXISTS idx_tracks_sort_artist ON {T}(lower(artist), lower(album), disc_number, track_number, lower(title), path);"
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

            // Migrations. IF NOT EXISTS rather than catching the failure: a failed statement is
            // logged as an ERROR by the server whether or not we swallow it, and four of them on
            // every startup buried the errors worth reading.
            if (!UsePostgres)
            {
                foreach (var column in new[] { ("tag_types", "TEXT"), ("bit_rate", "INTEGER"), ("sample_rate", "INTEGER"), ("bit_depth", "INTEGER") })
                {
                    using var check = conn.CreateCommand();
                    check.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='{column.Item1}'";
                    if (Convert.ToInt64(check.ExecuteScalar()) == 0)
                    {
                        using var add = conn.CreateCommand();
                        add.CommandText = $"ALTER TABLE tracks ADD COLUMN {column.Item1} {column.Item2}";
                        add.ExecuteNonQuery();
                    }
                }

                return;
            }

            using var alter = conn.CreateCommand();
            alter.CommandText = $@"
                ALTER TABLE {T} ADD COLUMN IF NOT EXISTS tag_types   TEXT;
                ALTER TABLE {T} ADD COLUMN IF NOT EXISTS bit_rate    INTEGER;
                ALTER TABLE {T} ADD COLUMN IF NOT EXISTS sample_rate INTEGER;
                ALTER TABLE {T} ADD COLUMN IF NOT EXISTS bit_depth   INTEGER;";
            alter.ExecuteNonQuery();
        }

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

        public IReadOnlyList<MusicExportTrack> GetExportTracks(IReadOnlyList<string> paths = null)
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            var where = string.Empty;
            if (paths != null)
            {
                if (paths.Count == 0)
                {
                    return Array.Empty<MusicExportTrack>();
                }

                if (paths.Count > 10000)
                {
                    throw new ArgumentException("Select at most 10000 tracks.", nameof(paths));
                }

                var parameters = paths.Select((path, index) => "@path" + index).ToArray();
                where = " WHERE path IN (" + string.Join(",", parameters) + ")";
                for (var index = 0; index < paths.Count; index++)
                {
                    AddParam(command, parameters[index], MusicPath.ToRelative(paths[index]));
                }
            }

            // Export selection needs indexed labels, not waveform blobs or full tag JSON.
            command.CommandText = $"SELECT path, COALESCE(NULLIF(title, ''), filename), artist, album, {CachedBpm}, {CachedKey} FROM {T}{where} ORDER BY path";
            using var reader = command.ExecuteReader();
            var tracks = new List<MusicExportTrack>();
            while (reader.Read())
            {
                tracks.Add(new MusicExportTrack(reader.GetString(0), reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(4) ? null : reader.GetDouble(4), reader.IsDBNull(5) ? null : reader.GetString(5)));
            }

            return tracks;
        }

        public MusicLibraryQueryResult Query(
            string search, string artist, string album,
            string genre, int? year, string folder,
            bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork,
            int limit, int offset, string sort = null, bool descending = false, string startsWith = null,
            string key = null, string analysis = null, DjLibraryFilters dj = null, bool recursive = true)
        {
            using var conn = OpenConnection();

            var conditions = new System.Collections.Generic.List<string>();
            var hasSearch = !string.IsNullOrWhiteSpace(search);
            var hasArtist = !string.IsNullOrWhiteSpace(artist);
            var hasAlbum = !string.IsNullOrWhiteSpace(album);
            var hasGenre = !string.IsNullOrWhiteSpace(genre);
            var hasYear = year.HasValue;
            var hasFolder = !string.IsNullOrWhiteSpace(folder);
            var hasKey = !string.IsNullOrWhiteSpace(key);

            if (hasSearch)
            {
                conditions.Add($"(title {Like} @s OR artist {Like} @s OR album {Like} @s OR {CachedKey} {Like} @s)");
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
                conditions.Add(UsePostgres ? $"(LOWER(TRIM(genre)) = LOWER(TRIM(@genre)) OR LOWER(TRIM((SELECT c.dj_summary::jsonb->>'genre' FROM {CacheSource("c")} WHERE {CacheMatch("c")}))) = LOWER(TRIM(@genre)))" : $"(LOWER(TRIM(genre)) = LOWER(TRIM(@genre)) OR LOWER(TRIM((SELECT json_extract(c.dj_summary,'$.genre') FROM {CacheSource("c")} WHERE {CacheMatch("c")}))) = LOWER(TRIM(@genre)))");
            }

            if (hasYear)
            {
                conditions.Add("year = @year");
            }

            if (hasFolder)
            {
                conditions.Add(recursive ? "(directory = @folder OR directory LIKE @folderPrefix ESCAPE '\\')" : "directory = @folder");
            }

            if (missingKey)
            {
                conditions.Add($"({CachedKey} IS NULL OR {CachedKey} = '')");
            }

            if (missingBpm)
            {
                conditions.Add($"{CachedBpm} IS NULL");
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

            if (hasKey)
            {
                conditions.Add($"{IEq(CachedKey)} @key");
            }

            if (dj?.AnalysedOnly == true)
            {
                conditions.Add(CrateAnalysisExists);
            }

            var summary = $"(SELECT c.dj_summary FROM {CacheSource("c")} WHERE {CacheMatch("c")})";
            if (dj?.AddedAfter.HasValue == true)
            {
                conditions.Add("indexed_at >= @addedAfter");
            }

            var history = UsePostgres ? "library_activity.\"PlayHistory\"" : "PlayHistory";
            var loved = UsePostgres ? "library_activity.\"LovedTracks\"" : "LovedTracks";
            if (dj?.NeverPlayed == true || dj?.NotPlayedSince.HasValue == true)
            {
                conditions.Add($"{T}.path NOT IN (SELECT h.\"Path\" FROM {history} h WHERE h.\"Path\" IS NOT NULL AND h.\"Username\"=@crateUsername" +
                    (dj.NeverPlayed ? ")" : " AND h.\"PlayedAt\">=@notPlayedSince)"));
            }

            if (dj?.LovedOnly == true)
            {
                conditions.Add($"EXISTS (SELECT 1 FROM {loved} l WHERE l.\"Path\"={T}.path AND l.\"Username\"=@crateUsername)");
            }

            if (dj?.Paths?.Length > 0)
            {
                conditions.Add("path IN (" + string.Join(",", dj.Paths.Select((_, index) => "@path" + index)) + ")");
            }

            if (dj?.BpmMin is double min)
            {
                conditions.Add($"{CachedBpm} >= @bpmMin");
            }

            if (dj?.BpmMax is double max)
            {
                conditions.Add($"{CachedBpm} {(dj.BpmMaxExclusive ? "<" : "<=")} @bpmMax");
            }

            if (dj?.Keys?.Length > 0)
            {
                conditions.Add($"LOWER({CachedKey}) IN (" + string.Join(",", dj.Keys.Select((_, index) => "@compatibleKey" + index)) + ")");
            }

            if (dj?.Vocals is "yes" or "no")
            {
                conditions.Add(UsePostgres ? $"(({summary})::jsonb->>'vocals')::boolean = @vocals" : $"json_extract({summary},'$.vocals') = @vocals");
            }

            if (dj?.Energy is "low" or "medium" or "high")
            {
                var energy = UsePostgres ? $"(({summary})::jsonb->>'energy')::double precision" : $"json_extract({summary},'$.energy')";
                conditions.Add(dj.Energy == "low" ? $"{energy} < 0.15" : dj.Energy == "high" ? $"{energy} >= 0.3" : $"{energy} >= 0.15 AND {energy} < 0.3");
            }

            // The analysis page filters on "has all four metrics" rather than on one of them, which
            // no missing* flag can express. Same predicate the stats count uses, so the list and the
            // headline number can't disagree.
            var readiness = AnalysisCondition(analysis);
            if (readiness != null)
            {
                conditions.Add(readiness);
            }

            // A-Z rail: narrow to one letter bucket of the column the list is sorted by, so a
            // letter jump works across the whole library rather than only the rows already paged in.
            // Bucket by whatever the list is actually ordered by, so the rail agrees with the
            // visible order. Sorts with no alphabet (bpm, duration, ...) fall back to the
            // default ordering column, artist.
            var alphaColumn = sort?.ToLowerInvariant() switch
            {
                "title" => "COALESCE(NULLIF(title, ''), filename)",
                "album" => "album",
                _ => "artist",
            };

            var alphaLetter = startsWith?.Trim().ToUpperInvariant();
            var hasAlpha = !string.IsNullOrEmpty(alphaLetter);
            if (hasAlpha)
            {
                conditions.Add(alphaLetter == "#"
                    ? $"({alphaColumn} IS NULL OR {FirstChar(alphaColumn)} NOT IN ({AlphaLetters}))"
                    : $"{FirstChar(alphaColumn)} = @sw");
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
                AddParam(countCmd, "@folderPrefix", MusicPath.ToRelative(folder).TrimEnd('/').Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "/%");
            }

            if (hasKey)
            {
                AddParam(countCmd, "@key", key);
            }

            if (hasAlpha && alphaLetter != "#")
            {
                AddParam(countCmd, "@sw", alphaLetter);
            }

            void BindDj(DbCommand command)
            {
                if (dj?.AddedAfter is long addedAfter)
                {
                    AddParam(command, "@addedAfter", addedAfter);
                }

                if (dj?.NotPlayedSince is long notPlayedSince && !dj.NeverPlayed)
                {
                    AddParam(command, "@notPlayedSince", notPlayedSince);
                }

                if (dj?.NeverPlayed == true || dj?.NotPlayedSince.HasValue == true || dj?.LovedOnly == true)
                {
                    AddParam(command, "@crateUsername", dj.Username ?? string.Empty);
                }

                if (dj?.Paths?.Length > 0)
                {
                    for (var index = 0; index < dj.Paths.Length; index++)
                    {
                        AddParam(command, "@path" + index, MusicPath.ToRelative(dj.Paths[index]));
                    }
                }

                if (dj?.BpmMin is double min)
                {
                    AddParam(command, "@bpmMin", min);
                }

                if (dj?.BpmMax is double max)
                {
                    AddParam(command, "@bpmMax", max);
                }

                if (dj?.Keys?.Length > 0)
                {
                    for (var index = 0; index < dj.Keys.Length; index++)
                    {
                        AddParam(command, "@compatibleKey" + index, dj.Keys[index].ToLowerInvariant());
                    }
                }

                if (dj?.Vocals is "yes" or "no")
                {
                    AddParam(command, "@vocals", dj.Vocals == "yes");
                }
            }

            BindDj(countCmd);
            var total = Convert.ToInt32(countCmd.ExecuteScalar());

            // The sort key is mapped through a whitelist; user input never reaches the SQL directly
            var dir = descending ? "DESC" : "ASC";
            var orderBy = sort?.ToLowerInvariant() switch
            {
                "title" => $"{OrdBy("title", dir)}, {OrdBy("artist")}",
                "album" => $"{OrdBy("album", dir)}, disc_number, track_number",

                // A folder's running order — how the CD (or release) it was ripped from plays.
                // Untagged discs count as disc 1 so a lone missing tag doesn't push its track to
                // the end; untagged track numbers fall back to path (i.e. "01 - …" filenames).
                "track" => $"{OrdBy("album", dir)}, COALESCE(disc_number, 1) {dir}, track_number {dir}",
                "year" => $"year {dir}, {OrdBy("artist")}, {OrdBy("album")}, track_number",
                "duration" => $"duration {dir}, {OrdBy("title")}",
                "bpm" => $"{CachedBpm} {dir}, {OrdBy("title")}",
                "lufs" => $"lufs {dir}, {OrdBy("title")}",
                "ext" => $"{OrdBy("extension", dir)}, {OrdBy("title")}",
                "quality" => $"bit_rate {dir}, sample_rate {dir}, {OrdBy("title")}",

                // Group tracks of the same musical key together (tracks with no detected key sort last).
                "key" => $"CASE WHEN {CachedKey} IS NULL OR {CachedKey} = '' THEN 1 ELSE 0 END, {OrdBy(CachedKey, dir)}, {OrdBy("title")}",
                "added" => $"indexed_at {dir}, {OrdBy("title")}",

                // Shuffle: let the database pick the sample. Clients queue a bounded window
                // (a few hundred tracks), so without this a shuffle over a 25k-track folder
                // would either drag the whole folder over the wire or only ever draw from
                // the alphabetical head of it.
                "random" => "RANDOM()",
                _ => $"{OrdBy("artist", dir)}, {OrdBy("album")}, disc_number, track_number, {OrdBy("title")}",
            };

            // Every sort key above has heavy ties (thousands of rows share a title, an artist, a
            // null bpm). Ties break arbitrarily between statements, so under LIMIT/OFFSET paging
            // the same row can land on two pages while another is skipped entirely. path is
            // unique, so appending it makes the total order deterministic across page requests.
            // RANDOM() is deliberately exempt — a stable shuffle is not a shuffle.
            if (orderBy != "RANDOM()")
            {
                orderBy += ", path";
            }

            using var cmd = conn.CreateCommand();

            // has_waveform and lufs are appended AFTER the columns ReadRow expects, so the shared
            // row reader keeps working for every other query that doesn't select them.
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, {CachedBpm} AS bpm, {CachedKey} AS key_sig, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth,
                       EXISTS (SELECT 1 FROM {CacheSource("a")}
                               WHERE a.masked_filename = {T}.path
                                 AND a.file_size = {T}.file_size
                                 AND {HasWaveform("a")}) AS has_waveform,
                       (SELECT a.lufs FROM {CacheSource("a")}
                        WHERE a.masked_filename = {T}.path
                          AND a.file_size = {T}.file_size) AS lufs,
                       {$"(SELECT c.dj_summary FROM {CacheSource("c")} WHERE {CacheMatch("c")})"} AS dj_summary
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
                AddParam(cmd, "@folderPrefix", MusicPath.ToRelative(folder).TrimEnd('/').Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "/%");
            }

            if (hasKey)
            {
                AddParam(cmd, "@key", key);
            }

            if (hasAlpha && alphaLetter != "#")
            {
                AddParam(cmd, "@sw", alphaLetter);
            }

            AddParam(cmd, "@limit", limit);
            AddParam(cmd, "@offset", offset);

            BindDj(cmd);
            var tracks = new List<MusicTrack>();
            using var reader = cmd.ExecuteReader();
            const int hasWaveformOrdinal = 24;
            const int lufsOrdinal = 25;
            while (reader.Read())
            {
                tracks.Add(ReadRow(reader) with
                {
                    HasWaveform = !reader.IsDBNull(hasWaveformOrdinal) && Convert.ToBoolean(reader.GetValue(hasWaveformOrdinal)),
                    Lufs = reader.IsDBNull(lufsOrdinal) ? null : reader.GetDouble(lufsOrdinal),
                    DjSummary = reader.IsDBNull(26) ? null : reader.GetString(26),
                });
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

        /// <summary>
        ///     Returns the distinct musical keys present in the library, with track counts.
        /// </summary>
        /// <remarks>
        ///     The analysis page's key filter matches a stored value exactly, so it has to offer the
        ///     values that are actually stored: detection writes canonical short forms ("Am", "F#"),
        ///     but a key inherited from a downloaded file's own tags can be spelled any number of
        ///     ways, and offering a fixed list of 24 would silently never match those.
        /// </remarks>
        /// <returns>One entry per distinct key.</returns>
        public IReadOnlyList<MusicKey> GetKeys()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT MIN({CachedKey}) AS key_sig, COUNT(*) AS track_count
                FROM {T}
                WHERE {CachedKey} IS NOT NULL AND {CachedKey} != ''
                GROUP BY {GrpBy(CachedKey)}
                ORDER BY {OrdBy(CachedKey)}";
            var results = new List<MusicKey>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicKey(Key: r.GetString(0), TrackCount: r.GetInt32(1)));
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

        public IReadOnlyList<MusicFolder> GetFolders(string search = null, string analysis = null)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            var conditions = new List<string>();
            if (!string.IsNullOrWhiteSpace(search))
            {
                conditions.Add($"(title {Like} @s OR artist {Like} @s OR album {Like} @s OR {CachedKey} {Like} @s)");
                AddParam(cmd, "@s", $"%{search.Trim()}%");
            }

            var readiness = AnalysisCondition(analysis);
            if (readiness != null)
            {
                conditions.Add(readiness);
            }

            var where = conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : string.Empty;
            cmd.CommandText = $@"
                SELECT directory,
                       COUNT(*) AS track_count,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at) AS indexed_at
                FROM {T} {where}
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
        ///     Counts how much of the library carries each analysis metric.
        /// </summary>
        /// <remarks>
        ///     One join over the library, not a walk of it: the analysis page used to derive these
        ///     six numbers client-side from a dump of every track (25MB, 27 seconds), which is the
        ///     whole reason that page was slow to open.
        /// </remarks>
        /// <returns>The per-metric counts for the whole library.</returns>
        public MusicAnalysisStats GetAnalysisStats()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();

            // Reuse the matched row. Correlated cache lookups here repeatedly read the
            // same (potentially large) waveform row for each missing tag in the library.
            var summaryKey = UsePostgres ? "a.dj_summary::jsonb->>'key'" : "json_extract(a.dj_summary,'$.key')";
            var summaryBpm = UsePostgres ? "a.dj_summary::jsonb->>'bpm'" : "json_extract(a.dj_summary,'$.bpm')";
            var key = $"COALESCE(NULLIF({T}.key_sig, ''), a.detected_key, {summaryKey})";
            var bpm = $"COALESCE(NULLIF({T}.bpm, 0), a.detected_bpm, CAST(ROUND(CAST({summaryBpm} AS DOUBLE PRECISION)) AS INTEGER))";
            var cacheTable = CacheSource("a");
            var hasWaveform = HasWaveform("a");
            cmd.CommandText = $@"
                SELECT COUNT(*),
                       SUM(CASE WHEN {key} IS NOT NULL AND {key} <> '' THEN 1 ELSE 0 END),
                       SUM(CASE WHEN {bpm} IS NOT NULL THEN 1 ELSE 0 END),
                       SUM(CASE WHEN {hasWaveform} THEN 1 ELSE 0 END),
                       SUM(CASE WHEN a.lufs IS NOT NULL THEN 1 ELSE 0 END),
                       SUM(CASE WHEN {key} IS NOT NULL AND {key} <> '' AND {bpm} IS NOT NULL
                           AND {hasWaveform} AND a.lufs IS NOT NULL THEN 1 ELSE 0 END)
                FROM {T}
                LEFT JOIN {cacheTable} ON {CacheMatch("a")}";

            MusicAnalysisStats basic;
            using (var r = cmd.ExecuteReader())
            {
                int At(int i) => r.IsDBNull(i) ? 0 : Convert.ToInt32(r.GetValue(i));
                basic = r.Read() ? new MusicAnalysisStats(At(0), At(1), At(2), At(3), At(4), At(5)) : new MusicAnalysisStats(0, 0, 0, 0, 0, 0);
            }

            // Read only saved enhanced summaries with the same indexed content guard.
            // This streams compact rows, without parsing audio or allocating a library dump.
            cmd.CommandText = $@"SELECT a.dj_summary FROM {CacheSource("a")}
                JOIN {T} ON {CacheMatch("a")} WHERE a.dj_summary IS NOT NULL";
            using var reader = cmd.ExecuteReader();
            IEnumerable<string> Summaries()
            {
                while (reader.Read())
                {
                    yield return reader.GetString(0);
                }
            }

            return basic with { Enhanced = EnhancedCoverage.Count(Summaries()) };
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

            // Filtered inside the CTE so the album_artist backfill below only considers
            // tracks that survive the filter, matching the pre-CTE behaviour.
            var whereInner = hasFilter
                ? $" WHERE {IEq("COALESCE(NULLIF(album_artist,''), artist)")} @artist"
                : string.Empty;
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                -- A folder whose tracks disagree about album_artist (set on some, blank on
                -- others) used to split into two groups: the tagged half keyed on the artist
                -- name, the untagged half on the directory. Both then projected the same
                -- album/artist/directory, so they rendered as two identical albums. Fill a
                -- blank album_artist from its siblings in the same (album, directory) before
                -- grouping so those halves land in one group.
                --
                -- Only when the siblings agree, hence the MIN = MAX guard: a compilation
                -- folder can hold one album name over dozens of different album_artists, and
                -- backfilling those blanks with an arbitrary one (MAX picks whatever sorts
                -- last -- in this library, once a URL) would sweep every untagged track into
                -- one unrelated artist's album. Where the siblings disagree, MIN <> MAX
                -- leaves the value NULL and the blanks keep grouping by directory as before.
                WITH t AS (
                    SELECT *,
                           COALESCE(
                               NULLIF(album_artist,''),
                               CASE WHEN MIN(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                                       = MAX(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                                    THEN MAX(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                               END
                           ) AS eff_album_artist
                    FROM {T}{whereInner}
                )
                SELECT MIN(album) AS album,
                       CASE WHEN COUNT(DISTINCT LOWER(NULLIF(TRIM(artist),''))) > 1 THEN 'Various Artists'
                            WHEN MAX(NULLIF(album_artist,'')) IS NOT NULL THEN MAX(NULLIF(album_artist,''))
                            ELSE MIN(NULLIF(TRIM(artist),'')) END AS artist,
                       MAX(NULLIF(album_artist,'')) AS album_artist,
                       MAX(year)          AS year,
                       COUNT(*)           AS track_count,
                       SUM(duration)      AS total_dur,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork)   AS has_art,
                       MIN(indexed_at)    AS indexed_at,
                       MIN(directory)     AS directory
                FROM t
                GROUP BY {GrpBy("album")}, COALESCE(eff_album_artist, directory)
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
                -- A folder whose tracks disagree about album_artist (set on some, blank on
                -- others) used to split into two groups: the tagged half keyed on the artist
                -- name, the untagged half on the directory. Both then projected the same
                -- album/artist/directory, so they rendered as two identical albums. Fill a
                -- blank album_artist from its siblings in the same (album, directory) before
                -- grouping so those halves land in one group.
                --
                -- Only when the siblings agree, hence the MIN = MAX guard: a compilation
                -- folder can hold one album name over dozens of different album_artists, and
                -- backfilling those blanks with an arbitrary one (MAX picks whatever sorts
                -- last -- in this library, once a URL) would sweep every untagged track into
                -- one unrelated artist's album. Where the siblings disagree, MIN <> MAX
                -- leaves the value NULL and the blanks keep grouping by directory as before.
                WITH t AS (
                    SELECT *,
                           COALESCE(
                               NULLIF(album_artist,''),
                               CASE WHEN MIN(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                                       = MAX(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                                    THEN MAX(NULLIF(album_artist,'')) OVER (
                                            PARTITION BY {GrpBy("album")}, directory)
                               END
                           ) AS eff_album_artist
                    FROM {T}
                )
                SELECT MIN(album) AS album,
                       CASE WHEN COUNT(DISTINCT LOWER(NULLIF(TRIM(artist),''))) > 1 THEN 'Various Artists'
                            WHEN MAX(NULLIF(album_artist,'')) IS NOT NULL THEN MAX(NULLIF(album_artist,''))
                            ELSE MIN(NULLIF(TRIM(artist),'')) END AS artist,
                       MAX(NULLIF(album_artist,'')) AS album_artist,
                       MAX(year)        AS year,
                       COUNT(*)         AS track_count,
                       SUM(duration)    AS total_dur,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at)  AS indexed_at,
                       MIN(directory)   AS directory
                FROM t
                GROUP BY {GrpBy("album")}, COALESCE(eff_album_artist, directory)
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
                    // ReadRow hands back an absolute Path; the lookup below is by relative, so key it
                    // that way — keying by row.Path made every lookup miss and the result always empty.
                    var row = ReadRow(r);
                    byPath[MusicPath.ToRelative(row.Path)] = row;
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

        /// <summary>Walks the library by its indexed path without sorting or counting every page.</summary>
        /// <param name="afterPath">The last relative path from the preceding page, or null for the first page.</param>
        /// <param name="limit">The maximum number of tracks to read.</param>
        /// <returns>Current tags and fingerprint-matched analysis, in path order.</returns>
        internal IReadOnlyList<MusicTrack> GetPreparationPage(string afterPath = null, int limit = 500)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
            ArgumentOutOfRangeException.ThrowIfGreaterThan(limit, 2000);
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, {CachedBpm}, {CachedKey}, comment, has_artwork, tag_types, bit_rate, sample_rate, bit_depth,
                       EXISTS (SELECT 1 FROM {CacheSource("a")} WHERE {CacheMatch("a")} AND {HasWaveform("a")}),
                       (SELECT a.lufs FROM {CacheSource("a")} WHERE {CacheMatch("a")}),
                       (SELECT c.dj_summary FROM {CacheSource("c")} WHERE {CacheMatch("c")})
                FROM {T} {(afterPath == null ? string.Empty : "WHERE path > @after")}
                ORDER BY path LIMIT @limit";
            if (afterPath != null)
            {
                AddParam(cmd, "@after", MusicPath.ToRelative(afterPath));
            }

            AddParam(cmd, "@limit", limit);
            var tracks = new List<MusicTrack>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                tracks.Add(ReadRow(reader) with
                {
                    HasWaveform = !reader.IsDBNull(24) && Convert.ToBoolean(reader.GetValue(24)),
                    Lufs = reader.IsDBNull(25) ? null : reader.GetDouble(25),
                    DjSummary = reader.IsDBNull(26) ? null : reader.GetString(26),
                });
            }

            return tracks;
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

        private string AnalysisCondition(string analysis)
        {
            var summary = $"(SELECT c.dj_summary FROM {CacheSource("c")} WHERE {CacheMatch("c")})";
            return analysis?.Trim().ToLowerInvariant() switch
            {
                "enhanced" => UsePostgres ? $"({summary})::jsonb->>'complete' = 'true'" : $"json_extract({summary},'$.complete') = 1",
                "pending" => $"{summary} IS NULL",
                "complete" => FullyAnalysedExists,
                "incomplete" => $"NOT {FullyAnalysedExists}",
                _ => null,
            };
        }

        // SQLite otherwise prefers the unique path index, which fetches the large
        // waveform row even for a small metadata lookup.
        private string CacheSource(string alias) => UsePostgres
            ? $"{TA} {alias}"
            : $"{TA} {alias} INDEXED BY IX_TrackAnalysis_Coverage";

        // Joins an analysis-cache row to its track. The file_size guard is what makes a stale
        // cache entry (file replaced since it was analysed) not count as analysed.
        private string CacheMatch(string cache) =>
            $"{cache}.masked_filename = {T}.path AND {cache}.file_size = {T}.file_size";

        private string HasWaveform(string cache) => UsePostgres
            ? $"{cache}.overall_peaks IS NOT NULL"
            : $"({cache}.overall_peaks IS NOT NULL) = 1";

        // See FullyAnalysedExists. `cache` names an analysis row already matched by CacheMatch.
        private string FullyAnalysed(string cache) =>
            $"({CachedKey} IS NOT NULL AND {CachedKey} <> '' AND {CachedBpm} IS NOT NULL "
            + $"AND {HasWaveform(cache)} AND {cache}.lufs IS NOT NULL)";

        // Case-insensitive equality (used in WHERE)
        private string IEq(string col) => UsePostgres ? $"{col} ILIKE" : $"{col} =";

        // Case-insensitive GROUP BY expression for a column
        private string GrpBy(string col) => UsePostgres ? $"lower({col})" : $"{col} COLLATE NOCASE";

        // Case-insensitive ORDER BY expression for a column
        private string OrdBy(string col, string dir = "ASC") => UsePostgres ? $"lower({col}) {dir}" : $"{col} COLLATE NOCASE {dir}";

        // First character of a value, uppercased — the A-Z rail's bucket key. Mirrors the
        // client's alphaKey() so a letter jump lands on the same rows the rail is labelled with.
        private string FirstChar(string col) => $"upper(substr(trim({col}), 1, 1))";

        // ── Helpers ───────────────────────────────────────────────────────────
        private DbConnection OpenConnection()
        {
            DbConnection conn = UsePostgres ? new NpgsqlConnection(ConnectionString) : new SqliteConnection(ConnectionString);
            conn.Open();
            return conn;
        }
    }
}
