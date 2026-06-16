// <copyright file="MusicRepository.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.MusicLibrary
{
    using System;
    using System.Collections.Generic;
    using Microsoft.Data.Sqlite;

    public class MusicRepository
    {
        public MusicRepository(string connectionString)
        {
            ConnectionString = connectionString;
        }

        private string ConnectionString { get; }

        public void Initialize()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS tracks (
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
                    tag_types    TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_tracks_directory ON tracks(directory);
                CREATE INDEX IF NOT EXISTS idx_tracks_artist    ON tracks(artist COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_tracks_album     ON tracks(album  COLLATE NOCASE);", conn);
            cmd.ExecuteNonQuery();

            // Migration: add tag_types column if it doesn't exist yet
            try
            {
                using var alter = new SqliteCommand("ALTER TABLE tracks ADD COLUMN tag_types TEXT", conn);
                alter.ExecuteNonQuery();
            }
            catch (SqliteException)
            { /* column already exists */
            }
        }

        public void Upsert(MusicTrack t)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                INSERT INTO tracks
                    (path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                     title, artist, album_artist, album, year, track_number, disc_number,
                     genre, bpm, key_sig, comment, has_artwork, tag_types)
                VALUES
                    (@path, @filename, @dir, @ext, @size, @mod, @idx, @dur,
                     @title, @artist, @aartist, @album, @year, @track, @disc,
                     @genre, @bpm, @key, @comment, @art, @tagtypes)
                ON CONFLICT(path) DO UPDATE SET
                    filename=excluded.filename, directory=excluded.directory, extension=excluded.extension,
                    file_size=excluded.file_size, file_modified=excluded.file_modified, indexed_at=excluded.indexed_at,
                    duration=excluded.duration, title=excluded.title, artist=excluded.artist,
                    album_artist=excluded.album_artist, album=excluded.album, year=excluded.year,
                    track_number=excluded.track_number, disc_number=excluded.disc_number,
                    genre=excluded.genre, bpm=excluded.bpm, key_sig=excluded.key_sig,
                    comment=excluded.comment, has_artwork=excluded.has_artwork, tag_types=excluded.tag_types", conn);

            cmd.Parameters.AddWithValue("@path", t.Path);
            cmd.Parameters.AddWithValue("@filename", t.Filename);
            cmd.Parameters.AddWithValue("@dir", t.Directory);
            cmd.Parameters.AddWithValue("@ext", t.Extension);
            cmd.Parameters.AddWithValue("@size", t.FileSize);
            cmd.Parameters.AddWithValue("@mod", t.FileModified);
            cmd.Parameters.AddWithValue("@idx", t.IndexedAt);
            cmd.Parameters.AddWithValue("@dur", (object)t.Duration ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@title", (object)t.Title ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@artist", (object)t.Artist ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@aartist", (object)t.AlbumArtist ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@album", (object)t.Album ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@year", (object)t.Year ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@track", (object)t.TrackNumber ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@disc", (object)t.DiscNumber ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@genre", (object)t.Genre ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@bpm", (object)t.Bpm ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@key", (object)t.Key ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@comment", (object)t.Comment ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@art", t.HasArtwork ? 1 : 0);
            cmd.Parameters.AddWithValue("@tagtypes", (object)t.TagTypes ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }

        public void DeletePaths(IEnumerable<string> paths)
        {
            using var conn = GetConnection();
            using var tx = conn.BeginTransaction();
            using var cmd = new SqliteCommand("DELETE FROM tracks WHERE path = @p", conn, tx);
            cmd.Parameters.Add(new SqliteParameter("@p", SqliteType.Text));
            foreach (var p in paths)
            {
                cmd.Parameters["@p"].Value = p;
                cmd.ExecuteNonQuery();
            }

            tx.Commit();
        }

        /// <summary>Returns (path → (size, modified)) for all rows — used for change detection.</summary>
        /// <returns></returns>
        public Dictionary<string, (long Size, long Modified)> GetAllFingerprints()
        {
            var result = new Dictionary<string, (long, long)>(StringComparer.Ordinal);
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT path, file_size, file_modified FROM tracks", conn);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                result[r.GetString(0)] = (r.GetInt64(1), r.GetInt64(2));
            }

            return result;
        }

        public MusicLibraryQueryResult Query(
            string search, string artist, string album,
            string genre, int? year, string folder,
            bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork,
            int limit, int offset, string sort = null, bool descending = false)
        {
            using var conn = GetConnection();

            var conditions = new System.Collections.Generic.List<string>();
            var hasSearch = !string.IsNullOrWhiteSpace(search);
            var hasArtist = !string.IsNullOrWhiteSpace(artist);
            var hasAlbum = !string.IsNullOrWhiteSpace(album);
            var hasGenre = !string.IsNullOrWhiteSpace(genre);
            var hasYear = year.HasValue;
            var hasFolder = !string.IsNullOrWhiteSpace(folder);

            if (hasSearch)
            {
                conditions.Add("(title LIKE @s OR artist LIKE @s OR album LIKE @s OR key_sig LIKE @s)");
            }

            if (hasArtist)
            {
                conditions.Add("artist = @artist COLLATE NOCASE");
            }

            if (hasAlbum)
            {
                conditions.Add("album  = @album  COLLATE NOCASE");
            }

            if (hasGenre)
            {
                conditions.Add("genre  = @genre  COLLATE NOCASE");
            }

            if (hasYear)
            {
                conditions.Add("year   = @year");
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

            using var countCmd = new SqliteCommand($"SELECT COUNT(*) FROM tracks {where}", conn);
            if (hasSearch)
            {
                countCmd.Parameters.AddWithValue("@s", pattern);
            }

            if (hasArtist)
            {
                countCmd.Parameters.AddWithValue("@artist", artist);
            }

            if (hasAlbum)
            {
                countCmd.Parameters.AddWithValue("@album", album);
            }

            if (hasGenre)
            {
                countCmd.Parameters.AddWithValue("@genre", genre);
            }

            if (hasYear)
            {
                countCmd.Parameters.AddWithValue("@year", year.Value);
            }

            if (hasFolder)
            {
                countCmd.Parameters.AddWithValue("@folder", folder);
                countCmd.Parameters.AddWithValue("@folderPrefix", folder.TrimEnd('/') + "/%");
            }

            var total = (int)(long)countCmd.ExecuteScalar();

            // The sort key is mapped through a whitelist; user input never reaches the SQL directly
            var dir = descending ? "DESC" : "ASC";
            var orderBy = sort?.ToLowerInvariant() switch
            {
                "title" => $"title COLLATE NOCASE {dir}, artist COLLATE NOCASE",
                "album" => $"album COLLATE NOCASE {dir}, disc_number, track_number",
                "year" => $"year {dir}, artist COLLATE NOCASE, album COLLATE NOCASE, track_number",
                "duration" => $"duration {dir}, title COLLATE NOCASE",
                "bpm" => $"bpm {dir}, title COLLATE NOCASE",
                "added" => $"indexed_at {dir}, title COLLATE NOCASE",
                _ => $"artist COLLATE NOCASE {dir}, album COLLATE NOCASE, disc_number, track_number, title COLLATE NOCASE",
            };

            using var cmd = new SqliteCommand($@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types
                FROM tracks {where}
                ORDER BY {orderBy}
                LIMIT @limit OFFSET @offset", conn);
            if (hasSearch)
            {
                cmd.Parameters.AddWithValue("@s", pattern);
            }

            if (hasArtist)
            {
                cmd.Parameters.AddWithValue("@artist", artist);
            }

            if (hasAlbum)
            {
                cmd.Parameters.AddWithValue("@album", album);
            }

            if (hasGenre)
            {
                cmd.Parameters.AddWithValue("@genre", genre);
            }

            if (hasYear)
            {
                cmd.Parameters.AddWithValue("@year", year.Value);
            }

            if (hasFolder)
            {
                cmd.Parameters.AddWithValue("@folder", folder);
                cmd.Parameters.AddWithValue("@folderPrefix", folder.TrimEnd('/') + "/%");
            }

            cmd.Parameters.AddWithValue("@limit", limit);
            cmd.Parameters.AddWithValue("@offset", offset);

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
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT genre, COUNT(*) AS track_count, SUM(duration) AS total_dur
                FROM tracks
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY genre COLLATE NOCASE
                ORDER BY genre COLLATE NOCASE", conn);
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
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT year,
                       COUNT(*) AS track_count,
                       COUNT(DISTINCT album || '|' || COALESCE(NULLIF(album_artist,''), artist)) AS album_count
                FROM tracks
                WHERE year IS NOT NULL
                GROUP BY year
                ORDER BY year DESC", conn);
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
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT directory,
                       COUNT(*) AS track_count,
                       MIN(CASE WHEN has_artwork = 1 THEN path ELSE NULL END) AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at) AS indexed_at
                FROM tracks
                GROUP BY directory
                ORDER BY directory", conn);
            var results = new List<MusicFolder>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var path = r.GetString(0);
                var name = System.IO.Path.GetFileName(path);
                results.Add(new MusicFolder(
                    Path: path,
                    Name: string.IsNullOrEmpty(name) ? path : name,
                    TrackCount: r.GetInt32(1),
                    CoverPath: r.IsDBNull(2) ? null : r.GetString(2),
                    HasArtwork: r.GetInt32(3) != 0,
                    IndexedAt: r.GetInt64(4)));
            }

            return results;
        }

        public (int Total, double TotalDuration) GetStats()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT COUNT(*), COALESCE(SUM(duration), 0.0) FROM tracks", conn);
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                return ((int)(long)r.GetValue(0), r.IsDBNull(1) ? 0.0 : r.GetDouble(1));
            }

            return (0, 0.0);
        }

        public IReadOnlyList<MusicAlbum> GetAlbums(string artistFilter = null)
        {
            using var conn = GetConnection();
            var hasFilter = !string.IsNullOrWhiteSpace(artistFilter);
            var where = hasFilter ? "WHERE artist = @artist COLLATE NOCASE" : string.Empty;
            using var cmd = new SqliteCommand($@"
                SELECT album, artist, album_artist,
                       MAX(year)          AS year,
                       COUNT(*)           AS track_count,
                       SUM(duration)      AS total_dur,
                       MIN(path)          AS cover_path,
                       MAX(has_artwork)   AS has_art,
                       MIN(indexed_at)    AS indexed_at
                FROM tracks {where}
                GROUP BY album COLLATE NOCASE, COALESCE(NULLIF(album_artist,''), artist) COLLATE NOCASE
                HAVING album IS NOT NULL AND album != ''
                ORDER BY album COLLATE NOCASE", conn);
            if (hasFilter)
            {
                cmd.Parameters.AddWithValue("@artist", artistFilter);
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
                    CoverPath: r.IsDBNull(6) ? null : r.GetString(6),
                    HasArtwork: r.GetInt32(7) != 0,
                    IndexedAt: r.GetInt64(8)));
            }

            return results;
        }

        public IReadOnlyList<MusicArtist> GetArtists()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT COALESCE(NULLIF(album_artist,''), artist) AS display_artist,
                       COUNT(DISTINCT album COLLATE NOCASE)      AS album_count,
                       COUNT(*)                                  AS track_count,
                       MIN(path)                                 AS cover_path,
                       MAX(has_artwork)                          AS has_art,
                       MIN(indexed_at)                           AS indexed_at
                FROM tracks
                WHERE artist IS NOT NULL AND artist != ''
                GROUP BY display_artist COLLATE NOCASE
                ORDER BY display_artist COLLATE NOCASE", conn);

            var results = new List<MusicArtist>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                results.Add(new MusicArtist(
                    Artist: r.IsDBNull(0) ? string.Empty : r.GetString(0),
                    AlbumCount: r.GetInt32(1),
                    TrackCount: r.GetInt32(2),
                    CoverPath: r.IsDBNull(3) ? null : r.GetString(3),
                    HasArtwork: r.GetInt32(4) != 0,
                    IndexedAt: r.GetInt64(5)));
            }

            return results;
        }

        public IReadOnlyList<MusicAlbum> GetRecentlyAdded(int limit)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT album, artist, album_artist,
                       MAX(year)        AS year,
                       COUNT(*)         AS track_count,
                       SUM(duration)    AS total_dur,
                       MIN(path)        AS cover_path,
                       MAX(has_artwork) AS has_art,
                       MIN(indexed_at)  AS indexed_at
                FROM tracks
                GROUP BY album COLLATE NOCASE, COALESCE(NULLIF(album_artist,''), artist) COLLATE NOCASE
                HAVING album IS NOT NULL AND album != ''
                ORDER BY MAX(indexed_at) DESC
                LIMIT @limit", conn);
            cmd.Parameters.AddWithValue("@limit", limit);

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
                    CoverPath: r.IsDBNull(6) ? null : r.GetString(6),
                    HasArtwork: r.GetInt32(7) != 0,
                    IndexedAt: r.GetInt64(8)));
            }

            return results;
        }

        public IReadOnlyList<MusicTrack> GetKeyedTracks()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types
                FROM tracks
                WHERE key_sig IS NOT NULL AND key_sig != ''
                ORDER BY artist COLLATE NOCASE", conn);

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
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "UPDATE tracks SET path = @newPath, filename = @newFilename WHERE path = @oldPath", conn);
            cmd.Parameters.AddWithValue("@oldPath", oldPath);
            cmd.Parameters.AddWithValue("@newPath", newPath);
            cmd.Parameters.AddWithValue("@newFilename", newFilename);
            cmd.ExecuteNonQuery();
        }

        /// <summary>Updates all track paths that live under <paramref name="oldDir"/> to use <paramref name="newDir"/> as their prefix.</summary>
        public void RenameDirectory(string oldDir, string newDir)
        {
            using var conn = GetConnection();
            var prefixStart = oldDir.Length + 1; // SQLite substr is 1-indexed; +1 to skip the trailing slash
            using var cmd = new SqliteCommand(@"
                UPDATE tracks SET
                    path      = @newDir || substr(path,      @start),
                    directory = @newDir || substr(directory, @start)
                WHERE directory = @oldDir OR directory LIKE @prefix", conn);
            cmd.Parameters.AddWithValue("@oldDir", oldDir);
            cmd.Parameters.AddWithValue("@newDir", newDir);
            cmd.Parameters.AddWithValue("@start", prefixStart);
            cmd.Parameters.AddWithValue("@prefix", oldDir.TrimEnd('/') + "/%");
            cmd.ExecuteNonQuery();
        }

        public MusicTrack? GetByPath(string path)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(@"
                SELECT path, filename, directory, extension, file_size, file_modified, indexed_at, duration,
                       title, artist, album_artist, album, year, track_number, disc_number,
                       genre, bpm, key_sig, comment, has_artwork, tag_types
                FROM tracks WHERE path=@path", conn);
            cmd.Parameters.AddWithValue("@path", path);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadRow(r) : null;
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private SqliteConnection GetConnection()
        {
            var conn = new SqliteConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private static MusicTrack ReadRow(SqliteDataReader r) => new(
            Path: r.GetString(0),
            Filename: r.GetString(1),
            Directory: r.GetString(2),
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
            TagTypes: r.IsDBNull(20) ? null : r.GetString(20));
    }
}
