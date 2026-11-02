// <copyright file="SqliteShareRepository.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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

namespace resonance.Shares
{
    using System;
    using System.Collections.Generic;
    using System.Globalization;
    using System.Linq;
    using Dapper;
    using Microsoft.Data.Sqlite;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Persistent storage of shared files and metadata.
    /// </summary>
    public class SqliteShareRepository : IShareRepository
    {
        internal const string CountFilesPrefixSql = """SELECT COUNT(*) FROM files WHERE maskedFilename LIKE @prefix ESCAPE '\'""";
        internal const string CountDirectoriesPrefixSql = """SELECT COUNT(*) FROM directories WHERE name LIKE @prefix ESCAPE '\'""";

        /// <summary>
        ///     Initializes a new instance of the <see cref="SqliteShareRepository"/> class.
        /// </summary>
        /// <param name="connectionString"></param>
        public SqliteShareRepository(string connectionString)
        {
            ConnectionString = connectionString;
        }

        /// <summary>
        ///     Gets the connection string for this repository.
        /// </summary>
        public string ConnectionString { get; }

        private bool Disposed { get; set; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Shares.Cache);

        /// <summary>
        ///     Counts the number of directories in the database.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for counting subdirectories.</param>
        /// <returns>The number of directories.</returns>
        public int CountDirectories(string parentDirectory = null)
        {
            using var conn = GetConnection();

            SqliteCommand cmd = default;

            try
            {
                if (string.IsNullOrEmpty(parentDirectory))
                {
                    cmd = new SqliteCommand("SELECT COUNT(*) FROM directories;", conn);
                }
                else
                {
                    cmd = new SqliteCommand(CountDirectoriesPrefixSql, conn);
                    cmd.Parameters.AddWithValue("prefix", PrefixPattern(parentDirectory));
                }

                var reader = cmd.ExecuteReader();
                reader.Read();
                return reader.GetInt32(0);
            }
            finally
            {
                cmd?.Dispose();
            }
        }

        /// <summary>
        ///     Counts the number of files in the database.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for counting files in a subdirectory.</param>
        /// <returns>The number of files.</returns>
        public int CountFiles(string parentDirectory = null)
        {
            using var conn = GetConnection();

            SqliteCommand cmd = default;

            try
            {
                if (string.IsNullOrEmpty(parentDirectory))
                {
                    cmd = new SqliteCommand("SELECT COUNT(*) FROM files;", conn);
                }
                else
                {
                    cmd = new SqliteCommand(CountFilesPrefixSql, conn);
                    cmd.Parameters.AddWithValue("prefix", PrefixPattern(parentDirectory));
                }

                var reader = cmd.ExecuteReader();
                reader.Read();
                return reader.GetInt32(0);
            }
            finally
            {
                cmd?.Dispose();
            }
        }

        /// <summary>
        ///     Returns the count of files grouped by extension.
        /// </summary>
        /// <returns>A dictionary mapping extension (lowercase, no dot) to file count.</returns>
        public IReadOnlyDictionary<string, int> GetFileTypeCounts()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand(
                "SELECT LOWER(COALESCE(extension, '')), COUNT(*) FROM files GROUP BY LOWER(COALESCE(extension, '')) ORDER BY COUNT(*) DESC;",
                conn);

            var result = new Dictionary<string, int>();
            var reader = cmd.ExecuteReader();

            while (reader.Read())
            {
                result[reader.GetString(0)] = reader.GetInt32(1);
            }

            return result;
        }

        /// <summary>
        ///     Creates a new database.
        /// </summary>
        /// <remarks>
        ///     Creates tables using 'IF NOT EXISTS', so this is idempotent unless 'discardExisting` is specified, in which case
        ///     tables are explicitly dropped prior to creation.
        /// </remarks>
        /// <param name="discardExisting">An optional value that determines whether the existing database should be discarded.</param>
        public void Create(bool discardExisting = false)
        {
            using var conn = GetConnection();

            // warning: with synchronous=0, an operating system crash can leave the database corrupted.
            // if this occurs we should generate a new one, so this is _probably_ ok
            conn.ExecuteNonQuery("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");

            if (discardExisting)
            {
                conn.ExecuteNonQuery("DROP TABLE IF EXISTS version; DROP TABLE IF EXISTS scans; DROP TABLE IF EXISTS directories; DROP TABLE IF EXISTS filenames; DROP TABLE IF EXISTS files;");
            }

            conn.ExecuteNonQuery("CREATE TABLE IF NOT EXISTS version (a INTEGER PRIMARY KEY)");

            conn.ExecuteNonQuery("CREATE TABLE IF NOT EXISTS scans (timestamp INTEGER PRIMARY KEY, options TEXT NOT NULL, end INTEGER DEFAULT NULL, suspect INTEGER DEFAULT 0);");

            conn.ExecuteNonQuery("CREATE TABLE IF NOT EXISTS directories (name TEXT PRIMARY KEY, timestamp INTEGER NOT NULL);");

            conn.ExecuteNonQuery("CREATE VIRTUAL TABLE IF NOT EXISTS filenames USING fts5(maskedFilename);");

            conn.ExecuteNonQuery("CREATE TABLE IF NOT EXISTS files " +
                "(maskedFilename TEXT PRIMARY KEY, originalFilename TEXT NOT NULL, size BIGINT NOT NULL, touchedAt TEXT NOT NULL, code INTEGER DEFAULT 1 NOT NULL, " +
                "extension TEXT, attributeJson TEXT NOT NULL, tagsJson TEXT, timestamp INTEGER NOT NULL);");

            conn.ExecuteNonQuery("CREATE INDEX IF NOT EXISTS idx_files_timestamp ON files(timestamp)");
            conn.ExecuteNonQuery("CREATE INDEX IF NOT EXISTS idx_directories_timestamp ON directories(timestamp)");
            conn.ExecuteNonQuery("CREATE INDEX IF NOT EXISTS idx_scans_timestamp ON scans(timestamp DESC)");
            EnsureCountIndexes(conn);

            // migration: add tagsJson column to existing databases that predate this feature
            var hasTagsColumn = false;
            using (var cmd = new SqliteCommand("SELECT COUNT(*) FROM pragma_table_info('files') WHERE name='tagsJson';", conn))
            {
                hasTagsColumn = (long)cmd.ExecuteScalar() > 0;
            }

            if (!hasTagsColumn)
            {
                conn.ExecuteNonQuery("ALTER TABLE files ADD COLUMN tagsJson TEXT;");
            }
        }

        /// <summary>
        ///     Disposes this object.
        /// </summary>
        public void Dispose()
        {
            Dispose(disposing: true);
            GC.SuppressFinalize(this);
        }

        /// <summary>
        ///     Dumps the contents of the database to a file.
        /// </summary>
        /// <param name="filename">The destination file.</param>
        public void DumpTo(string filename)
        {
            using var sourceConn = GetConnection(ConnectionString);

            // very important! don't use pooling for the backup connection or the file will remain locked
            using var backupConn = GetConnection($"Data Source={filename};Pooling=False");
            sourceConn.BackupDatabase(backupConn);
        }

        /// <summary>
        ///     Finds the filename of the file matching the specified <paramref name="maskedFilename"/>.
        /// </summary>
        /// <param name="maskedFilename">The fully qualified remote path of the file.</param>
        /// <returns>The filename, if found.</returns>
        public (string Filename, long Size) FindFileInfo(string maskedFilename)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT originalFilename, size FROM files WHERE maskedFilename = @maskedFilename;", conn);
            cmd.Parameters.AddWithValue("maskedFilename", maskedFilename);

            var reader = cmd.ExecuteReader();

            if (!reader.Read())
            {
                Log.Debug("Failed to resolve shared file {Filename}", maskedFilename);
                return default;
            }

            var filename = (string)reader["originalFilename"];
            var size = (long)reader["size"];
            Log.Debug($"Resolved requested shared file {maskedFilename} to {filename} ({size} bytes)");
            return (filename, size);
        }

        /// <summary>
        ///     Finds and returns the most recent scan record.
        /// </summary>
        /// <returns>The most recent scan record, or default if no scan was found.</returns>
        public Scan FindLatestScan()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT timestamp, options, COALESCE(end, -1), suspect FROM scans ORDER BY timestamp DESC LIMIT 1", conn);

            var reader = cmd.ExecuteReader();

            if (!reader.Read())
            {
                return default;
            }

            var timestamp = reader.GetInt64(0);
            var optionsJson = reader.GetString(1);

            var endRaw = reader.GetInt64(2);
            long? end = endRaw == -1 ? null : endRaw;

            var suspect = reader.GetInt32(3) > 0;

            return new Scan { StartedAt = timestamp, OptionsJson = optionsJson, EndedAt = end, Suspect = suspect };
        }

        /// <summary>
        ///     Flags the latest scan as suspect, indicating that the cached contents may have diverged from physical storage.
        /// </summary>
        public void FlagLatestScanAsSuspect()
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("UPDATE scans SET suspect = 1 WHERE timestamp = (SELECT timestamp FROM scans ORDER BY timestamp DESC LIMIT 1)", conn);

            cmd.ExecuteNonQuery();
        }

        /// <summary>
        ///     Lists the files that are direct children of the specified <paramref name="maskedDirectoryName"/>.
        /// </summary>
        /// <param name="maskedDirectoryName">The fully qualified remote path of the directory.</param>
        /// <returns>The cached file records, keyed by masked filename.</returns>
        public IReadOnlyDictionary<string, CachedShareFile> ListDirectoryFiles(string maskedDirectoryName)
        {
            var results = new Dictionary<string, CachedShareFile>();

            using var conn = GetConnection();

            // range scan on the primary key; ']' is the character following the '\' separator in binary
            // collation, so [prefix + '\', prefix + ']') covers exactly the strings below this directory.
            // the instr() check drops files in subdirectories, leaving only direct children.
            using var cmd = new SqliteCommand(
                "SELECT maskedFilename, originalFilename, size, touchedAt FROM files " +
                "WHERE maskedFilename >= @low AND maskedFilename < @high " +
                "AND instr(substr(maskedFilename, @prefixLength + 1), '\\') = 0;", conn);

            var prefix = maskedDirectoryName + '\\';
            cmd.Parameters.AddWithValue("low", prefix);
            cmd.Parameters.AddWithValue("high", maskedDirectoryName + ']');
            cmd.Parameters.AddWithValue("prefixLength", prefix.Length);

            var reader = cmd.ExecuteReader();

            while (reader.Read())
            {
                // legacy records stored touchedAt in a non-round-trip format; they fail to parse and are
                // treated as changed, forcing a one-time re-read
                DateTime? touchedAt = DateTime.TryParseExact(reader.GetString(3), "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
                    ? parsed
                    : null;

                var record = new CachedShareFile(
                    MaskedFilename: reader.GetString(0),
                    OriginalFilename: reader.GetString(1),
                    Size: reader.GetInt64(2),
                    TouchedAt: touchedAt);

                results[record.MaskedFilename] = record;
            }

            return results;
        }

        /// <summary>
        ///     Upserts a directory record along with its files in a single transaction.
        /// </summary>
        /// <param name="maskedDirectoryName">The fully qualified remote path of the directory.</param>
        /// <param name="timestamp">The timestamp to assign to the records.</param>
        /// <param name="upserts">Files to insert or update.</param>
        /// <param name="touchedFilenames">Masked filenames of unchanged files whose record timestamps should be refreshed.</param>
        public void UpsertDirectoryContents(string maskedDirectoryName, long timestamp, IReadOnlyCollection<ShareFileUpsert> upserts, IReadOnlyCollection<string> touchedFilenames)
        {
            using var conn = GetConnection();
            using var txn = conn.BeginTransaction();

            conn.ExecuteNonQuery("INSERT INTO directories VALUES(@name, @timestamp) ON CONFLICT DO UPDATE SET timestamp = excluded.timestamp;", cmd =>
            {
                cmd.Transaction = txn;
                cmd.Parameters.AddWithValue("name", maskedDirectoryName);
                cmd.Parameters.AddWithValue("timestamp", timestamp);
            });

            if (upserts.Count > 0)
            {
                using var cmd = new SqliteCommand(
                    "INSERT INTO files (maskedFilename, originalFilename, size, touchedAt, code, extension, attributeJson, tagsJson, timestamp) " +
                    "VALUES(@maskedFilename, @originalFilename, @size, @touchedAt, @code, @extension, @attributeJson, @tagsJson, @timestamp) " +
                    "ON CONFLICT DO UPDATE SET originalFilename = excluded.originalFilename, size = excluded.size, touchedAt = excluded.touchedAt, " +
                    "code = excluded.code, extension = excluded.extension, attributeJson = excluded.attributeJson, tagsJson = excluded.tagsJson, timestamp = excluded.timestamp;", conn, txn);

                var maskedFilename = cmd.Parameters.Add("maskedFilename", SqliteType.Text);
                var originalFilename = cmd.Parameters.Add("originalFilename", SqliteType.Text);
                var size = cmd.Parameters.Add("size", SqliteType.Integer);
                var touchedAt = cmd.Parameters.Add("touchedAt", SqliteType.Text);
                var code = cmd.Parameters.Add("code", SqliteType.Integer);
                var extension = cmd.Parameters.Add("extension", SqliteType.Text);
                var attributeJson = cmd.Parameters.Add("attributeJson", SqliteType.Text);
                var tagsJson = cmd.Parameters.Add("tagsJson", SqliteType.Text);
                cmd.Parameters.AddWithValue("timestamp", timestamp);

                foreach (var upsert in upserts)
                {
                    maskedFilename.Value = upsert.MaskedFilename;
                    originalFilename.Value = upsert.OriginalFilename;
                    size.Value = upsert.File.Size;
                    touchedAt.Value = upsert.TouchedAt.ToString("O", CultureInfo.InvariantCulture);
                    code.Value = upsert.File.Code;
                    extension.Value = upsert.File.Extension;
                    attributeJson.Value = upsert.File.Attributes.ToJson();
                    tagsJson.Value = upsert.Tags != null ? upsert.Tags.ToJson() : (object)DBNull.Value;

                    cmd.ExecuteNonQuery();
                }
            }

            if (touchedFilenames.Count > 0)
            {
                using var cmd = new SqliteCommand("UPDATE files SET timestamp = @timestamp WHERE maskedFilename = @maskedFilename;", conn, txn);

                var maskedFilename = cmd.Parameters.Add("maskedFilename", SqliteType.Text);
                cmd.Parameters.AddWithValue("timestamp", timestamp);

                foreach (var filename in touchedFilenames)
                {
                    maskedFilename.Value = filename;
                    cmd.ExecuteNonQuery();
                }
            }

            txn.Commit();
        }

        public FileTags FindTags(string maskedFilename)
        {
            using var connection = GetConnection();
            var json = connection.QuerySingleOrDefault<string>("SELECT tagsJson FROM files WHERE maskedFilename=@maskedFilename", new { maskedFilename });
            return json?.FromJson<FileTags>();
        }

        public IEnumerable<string> FindMaskedFilenames(IEnumerable<string> originalFilenames)
        {
            using var connection = GetConnection();

            // SQLite share caches may contain absolute paths from scans or relative paths
            // from migrations. Resolve both representations of the same library file.
            return originalFilenames.SelectMany(path => new[] { path, resonance.Common.MusicPath.ToAbsolute(path), resonance.Common.MusicPath.ToRelative(path) })
                .Distinct(StringComparer.OrdinalIgnoreCase).Chunk(200)
                .SelectMany(paths => connection.Query<string>("SELECT maskedFilename FROM files WHERE originalFilename COLLATE NOCASE IN @paths ORDER BY CASE WHEN originalFilename COLLATE BINARY IN @paths THEN 0 ELSE 1 END", new { paths })).ToList();
        }

        public IEnumerable<(string MaskedFilename, string OriginalFilename, FileTags Tags)> FindFiles(IEnumerable<string> maskedFilenames)
        {
            using var connection = GetConnection();
            return maskedFilenames.Distinct().Chunk(200).SelectMany(paths =>
                connection.Query<(string Masked, string Original, string Json)>("SELECT maskedFilename,originalFilename,tagsJson FROM files WHERE maskedFilename IN @paths", new { paths }))
                .Select(row => (row.Masked, row.Original, row.Json?.FromJson<FileTags>())).ToList();
        }

        public void UpdateFileTags(string maskedFilename, FileTags tags, long size, DateTime touchedAt)
        {
            using var connection = GetConnection();
            connection.Execute("UPDATE files SET tagsJson=@json,size=@size,touchedAt=@touched WHERE maskedFilename=@maskedFilename",
                new { json = tags?.ToJson(), size, touched = touchedAt.ToString("O", System.Globalization.CultureInfo.InvariantCulture), maskedFilename });
        }

        public IEnumerable<(string MaskedFilename, FileTags Tags)> ListTags()
        {
            var results = new List<(string, FileTags)>();
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT maskedFilename, tagsJson FROM files WHERE tagsJson IS NOT NULL ORDER BY maskedFilename ASC;", conn);
            var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var fn = reader.GetString(0);
                var json = reader.GetString(1);
                var t = json.FromJson<FileTags>();
                if (t != null)
                {
                    results.Add((fn, t));
                }
            }

            return results;
        }

        public IEnumerable<(string MaskedFilename, string OriginalFilename, FileTags Tags)> ListTaggedFiles()
        {
            var results = new List<(string, string, FileTags)>();
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT maskedFilename, originalFilename, tagsJson FROM files WHERE tagsJson IS NOT NULL AND extension IN ('mp3','flac','aac','ogg','oga','wav','wma','m4a','m4b','m4p','ape','aiff','wv','mpc','mpp','dsf','aa','aax') ORDER BY maskedFilename ASC;", conn);
            var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var tags = reader.GetString(2).FromJson<FileTags>();
                if (tags != null)
                {
                    results.Add((reader.GetString(0), reader.GetString(1), tags));
                }
            }

            return results;
        }

        /// <summary>
        ///     Lists files that have no tag data.
        /// </summary>
        /// <returns>Tuples of (maskedFilename, originalFilename) for files without tags.</returns>
        public IEnumerable<(string MaskedFilename, string OriginalFilename)> ListUntaggedFiles()
        {
            var results = new List<(string, string)>();
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT maskedFilename, originalFilename FROM files WHERE tagsJson IS NULL AND extension IN ('mp3','flac','aac','ogg','oga','wav','wma','m4a','m4b','m4p','ape','aiff','wv','mpc','mpp','dsf','aa','aax') ORDER BY maskedFilename ASC;", conn);
            var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add((reader.GetString(0), reader.GetString(1)));
            }

            return results;
        }

        /// <summary>
        ///     Updates tag metadata for the file with the specified <paramref name="maskedFilename"/>.
        /// </summary>
        /// <param name="maskedFilename">The masked filename of the file to update.</param>
        /// <param name="tags">The new tag data.</param>
        public void UpdateFileTags(string maskedFilename, FileTags tags)
        {
            using var conn = GetConnection();
            conn.ExecuteNonQuery("UPDATE files SET tagsJson = @tagsJson WHERE maskedFilename = @maskedFilename;", cmd =>
            {
                cmd.Parameters.AddWithValue("maskedFilename", maskedFilename);
                cmd.Parameters.AddWithValue("tagsJson", tags != null ? tags.ToJson() : (object)DBNull.Value);
            });
        }

        /// <summary>
        ///     Returns the physical directory path for any file in the specified <paramref name="maskedDirectory"/>.
        /// </summary>
        /// <returns></returns>
        public string GetDirectoryOriginalPath(string maskedDirectory)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand("SELECT originalFilename FROM files WHERE maskedFilename LIKE @prefix || '\\%' LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("prefix", maskedDirectory);
            var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                return null;
            }

            return System.IO.Path.GetDirectoryName(reader.GetString(0));
        }

        /// <summary>
        ///     Renames a directory, updating all file and directory records in the database.
        /// </summary>
        public void RenameDirectory(string oldMaskedDirectory, string newMaskedDirectory, string oldOriginalDirectory, string newOriginalDirectory)
        {
            using var conn = GetConnection();

            conn.ExecuteNonQuery(
                "UPDATE files SET maskedFilename = @newMasked || substr(maskedFilename, @oldMaskedLen + 1), originalFilename = @newOrig || substr(originalFilename, @oldOrigLen + 1) WHERE maskedFilename LIKE @oldMasked || '\\%';",
                cmd =>
                {
                    cmd.Parameters.AddWithValue("newMasked", newMaskedDirectory);
                    cmd.Parameters.AddWithValue("oldMaskedLen", oldMaskedDirectory.Length);
                    cmd.Parameters.AddWithValue("newOrig", newOriginalDirectory);
                    cmd.Parameters.AddWithValue("oldOrigLen", oldOriginalDirectory.Length);
                    cmd.Parameters.AddWithValue("oldMasked", oldMaskedDirectory);
                });

            conn.ExecuteNonQuery(
                "UPDATE directories SET name = @newMasked || substr(name, @oldMaskedLen + 1) WHERE name LIKE @oldMasked || '\\%' OR name = @oldMasked;",
                cmd =>
                {
                    cmd.Parameters.AddWithValue("newMasked", newMaskedDirectory);
                    cmd.Parameters.AddWithValue("oldMaskedLen", oldMaskedDirectory.Length);
                    cmd.Parameters.AddWithValue("oldMasked", oldMaskedDirectory);
                });

            RebuildFilenameIndex();
        }

        /// <summary>
        ///     Inserts a scan record at the specified <paramref name="timestamp"/>.
        /// </summary>
        /// <param name="timestamp">The timestamp associated with the scan.</param>
        /// <param name="options">The options snapshot at the start of the scan.</param>
        public void InsertScan(long timestamp, Options.SharesOptions options)
        {
            using var conn = GetConnection();

            conn.ExecuteNonQuery("INSERT INTO scans (timestamp, options) VALUES(@timestamp, @options)", cmd =>
            {
                cmd.Parameters.AddWithValue("timestamp", timestamp);
                cmd.Parameters.AddWithValue("options", options.ToJson());
            });
        }

        /// <summary>
        ///     Lists all directories.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for listing subdirectories.</param>
        /// <returns>The list of directories.</returns>
        public IEnumerable<string> ListDirectories(string parentDirectory = null)
        {
            var results = new List<string>();

            using var conn = GetConnection();

            SqliteCommand cmd = default;

            try
            {
                if (string.IsNullOrEmpty(parentDirectory))
                {
                    cmd = new SqliteCommand("SELECT name FROM directories ORDER BY name ASC;", conn);
                }
                else
                {
                    cmd = new SqliteCommand("SELECT name from directories WHERE name LIKE @prefix || '%' ORDER BY name ASC;", conn);
                    cmd.Parameters.AddWithValue("prefix", parentDirectory);
                }

                var reader = cmd.ExecuteReader();

                while (reader.Read())
                {
                    results.Add(reader.GetString(0));
                }

                return results;
            }
            finally
            {
                cmd?.Dispose();
            }
        }

        /// <summary>
        ///     Lists all files.
        /// </summary>
        /// <param name="parentDirectory">The optional parent directory.</param>
        /// <param name="includeFullPath">A value indicating whether the fully qualified path should be returned.</param>
        /// <returns>The list of files.</returns>
        public IEnumerable<Soulseek.File> ListFiles(string parentDirectory = null, bool includeFullPath = false)
        {
            var results = new List<Soulseek.File>();

            SqliteCommand cmd = default;
            using var conn = GetConnection();

            try
            {
                if (string.IsNullOrEmpty(parentDirectory))
                {
                    cmd = new SqliteCommand("SELECT maskedFilename, code, size, extension, attributeJson FROM files ORDER BY maskedFilename ASC;", conn);
                }
                else
                {
                    cmd = new SqliteCommand("SELECT maskedFilename, code, size, extension, attributeJson FROM files WHERE maskedFilename LIKE @match ORDER BY maskedFilename ASC;", conn);
                    cmd.Parameters.AddWithValue("match", parentDirectory + '%');
                }

                var reader = cmd.ExecuteReader();

                while (reader.Read())
                {
                    var filename = reader.GetString(0);
                    var code = reader.GetInt32(1);
                    var size = reader.GetInt64(2);
                    var extension = reader.GetString(3);
                    var attributeJson = reader.GetString(4);

                    var attributeList = attributeJson.FromJson<List<FileAttribute>>();

                    filename = includeFullPath ? filename : filename.GetNormalizedFileName();

                    var file = new Soulseek.File(code, filename, size, extension, attributeList);

                    results.Add(file);
                }

                return results;
            }
            finally
            {
                cmd?.Dispose();
            }
        }

        /// <summary>
        ///     Returns the list of all <see cref="Scan"/> started at or after the specified <paramref name="startedAtOrAfter"/>
        ///     unix timestamp.
        /// </summary>
        /// <param name="startedAtOrAfter">A unix timestamp that serves as the lower bound of the time-based listing.</param>
        /// <returns>The operation context, including the list of found scans.</returns>
        public IEnumerable<Scan> ListScans(long startedAtOrAfter = 0)
        {
            using var conn = GetConnection();
            using var cmd = new SqliteCommand($"SELECT timestamp, options, COALESCE(end, -1), suspect FROM scans WHERE timestamp >= {startedAtOrAfter}", conn);

            var reader = cmd.ExecuteReader();
            var scans = new List<Scan>();

            while (reader.Read())
            {
                var timestamp = reader.GetInt64(0);
                var optionsJson = reader.GetString(1);

                var endRaw = reader.GetInt64(2);
                long? end = endRaw == -1 ? null : endRaw;

                var suspect = reader.GetInt32(3) > 0;

                scans.Add(new Scan { StartedAt = timestamp, OptionsJson = optionsJson, EndedAt = end, Suspect = suspect });
            }

            return scans;
        }

        /// <summary>
        ///     Deletes file and directory records matching the specified path prefixes.
        /// </summary>
        /// <param name="originalPathPrefix">The original (local) path prefix for which to delete records.</param>
        /// <param name="maskedPathPrefix">The masked path prefix for which to delete records.</param>
        public void DeleteEntriesByPaths(string originalPathPrefix, string maskedPathPrefix)
        {
            using var conn = GetConnection();

            // Remove files by original (local) path — exact match or any child path.
            conn.ExecuteNonQuery(
                "DELETE FROM files WHERE originalFilename = @orig OR originalFilename LIKE @origPrefix",
                cmd =>
                {
                    cmd.Parameters.AddWithValue("orig", originalPathPrefix);
                    cmd.Parameters.AddWithValue("origPrefix", originalPathPrefix.TrimEnd('/') + "/%");
                });

            // Remove directory entries by masked path — exact match or any child.
            conn.ExecuteNonQuery(
                "DELETE FROM directories WHERE name = @masked OR name LIKE @maskedPrefix",
                cmd =>
                {
                    cmd.Parameters.AddWithValue("masked", maskedPathPrefix);
                    cmd.Parameters.AddWithValue("maskedPrefix", maskedPathPrefix.TrimEnd('\\') + "\\%");
                });

            RebuildFilenameIndex();
        }

        public long PruneDirectories(long olderThanTimestamp)
        {
            using var conn = GetConnection();

            using var cmd = new SqliteCommand("DELETE FROM directories WHERE timestamp < @timestamp; SELECT changes()", conn);
            cmd.Parameters.AddWithValue("timestamp", olderThanTimestamp);

            var reader = cmd.ExecuteReader();
            reader.Read();

            return reader.GetInt64(0);
        }

        /// <summary>
        ///     Deletes file records with a timestamp prior to the specified <paramref name="olderThanTimestamp"/>.
        /// </summary>
        /// <param name="olderThanTimestamp">The timestamp before which to delete files.</param>
        /// <returns>The number of records deleted.</returns>
        public long PruneFiles(long olderThanTimestamp)
        {
            using var conn = GetConnection();

            using var cmd = new SqliteCommand("DELETE FROM files WHERE timestamp < @timestamp; SELECT changes()", conn);
            cmd.Parameters.AddWithValue("timestamp", olderThanTimestamp);

            var reader = cmd.ExecuteReader();
            reader.Read();

            return reader.GetInt64(0);
        }

        /// <summary>
        ///     Rebuilds the filename index table using the data in the files table.
        /// </summary>
        public void RebuildFilenameIndex()
        {
            using var conn = GetConnection();

            conn.ExecuteNonQuery("DELETE from filenames; INSERT INTO filenames SELECT maskedFilename FROM files;");
        }

        /// <summary>
        ///     Restores the current database from the database at the specified <paramref name="repository"/>.
        /// </summary>
        /// <param name="repository">The destination repository.</param>
        public void RestoreFrom(IShareRepository repository)
        {
            using var sourceConn = GetConnection(repository.ConnectionString);
            using var restoreConn = GetConnection();
            sourceConn.BackupDatabase(restoreConn);

            // re-apply schema migrations after restore — the backup may predate new columns
            Create();
        }

        /// <summary>
        ///     Searches the database for files matching the specified <paramref name="query"/>.
        /// </summary>
        /// <param name="query">The search query.</param>
        /// <param name="limit">An optional row limit.</param>
        /// <returns>The list of matching files.</returns>
        public IEnumerable<Soulseek.File> Search(SearchQuery query, int? limit = null)
        {
            string Clean(string str) => str.Replace("/", " ")
                .Replace("\\", " ")
                .Replace(":", " ")
                .Replace("\"", " ")
                .Replace("'", "''");

            var match = string.Join(" AND ", query.Terms.Select(token => $"\"{Clean(token)}\""));
            var exclusions = string.Join(" OR ", query.Exclusions.Select(exclusion => $"\"{Clean(exclusion)}\""));

            var sql = $"SELECT files.maskedFilename, files.code, files.size, files.extension, files.attributeJson FROM filenames " +
                "INNER JOIN files ON filenames.maskedFilename = files.maskedFilename " +
                $"WHERE filenames MATCH '({match}) {(query.Exclusions.Any() ? $"NOT ({exclusions})" : string.Empty)}' " +
                $"ORDER BY filenames.maskedFilename ASC {(limit.HasValue ? $"LIMIT {limit.Value}" : string.Empty)};";

            var results = new List<Soulseek.File>();

            try
            {
                using var conn = GetConnection();
                using var cmd = new SqliteCommand(sql, conn);
                using var reader = cmd.ExecuteReader();

                while (reader.Read())
                {
                    var filename = reader.GetString(0);

                    // SQLite takes care of matching on tokens, but unfortunately doesn't work in cases where an exclusion appears as a substring.
                    // example: the token matching works to exclude the result "foo bar baz" given a "bar" exclusion, but does not exclude "foo xbarx baz"
                    // for this reason we must iterate over the exclusion list and ensure none appear as substrings
                    // **CAUTION** performance of this will degrade exponentially as the list of exclusions grows
                    if (query.Exclusions.Any(x => filename.Contains(x, StringComparison.OrdinalIgnoreCase)))
                    {
                        Log.Debug("Dropping excluded filename {File}", filename);
                        continue;
                    }

                    var code = reader.GetInt32(1);
                    var size = reader.GetInt64(2);
                    var extension = reader.GetString(3);
                    var attributeJson = reader.GetString(4);

                    var attributeList = attributeJson.FromJson<List<FileAttribute>>();

                    var file = new Soulseek.File(code, filename, size, extension, attributeList);
                    results.Add(file);
                }

                return results;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to execute shared file query '{Query}': {Message}", query, ex.Message);
                return Enumerable.Empty<Soulseek.File>();
            }
        }

        /// <summary>
        ///     Attempts to validate the backing database.
        /// </summary>
        /// <returns>A value indicating whether the database is valid.</returns>
        public bool TryValidate()
        {
            return TryValidate(out _);
        }

        /// <summary>
        ///     Attempts to validate the backing database.
        /// </summary>
        /// <param name="problems">The list of problems, if the database is invalid.</param>
        /// <returns>A value indicating whether the database is valid.</returns>
        public bool TryValidate(out IEnumerable<string> problems)
        {
            var list = new List<string>();
            problems = list;

            // to update this schema map, run the following query against a valid, up-to-date database and paste the output below:
            // select '{ "' || name || '", "' || sql || '" },' from sqlite_master where type = 'table'
            var schema = new Dictionary<string, string>()
            {
                { "version", "CREATE TABLE version (a INTEGER PRIMARY KEY)" },
                { "scans", "CREATE TABLE scans (timestamp INTEGER PRIMARY KEY, options TEXT NOT NULL, end INTEGER DEFAULT NULL, suspect INTEGER DEFAULT 0)" },
                { "directories", "CREATE TABLE directories (name TEXT PRIMARY KEY, timestamp INTEGER NOT NULL)" },
                { "filenames", "CREATE VIRTUAL TABLE filenames USING fts5(maskedFilename)" },
                { "filenames_data", "CREATE TABLE 'filenames_data'(id INTEGER PRIMARY KEY, block BLOB)" },
                { "filenames_idx", "CREATE TABLE 'filenames_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID" },
                { "filenames_content", "CREATE TABLE 'filenames_content'(id INTEGER PRIMARY KEY, c0)" },
                { "filenames_docsize", "CREATE TABLE 'filenames_docsize'(id INTEGER PRIMARY KEY, sz BLOB)" },
                { "filenames_config", "CREATE TABLE 'filenames_config'(k PRIMARY KEY, v) WITHOUT ROWID" },
                { "files", "CREATE TABLE files (maskedFilename TEXT PRIMARY KEY, originalFilename TEXT NOT NULL, size BIGINT NOT NULL, touchedAt TEXT NOT NULL, code INTEGER DEFAULT 1 NOT NULL, extension TEXT, attributeJson TEXT NOT NULL, tagsJson TEXT, timestamp INTEGER NOT NULL)" },
            };

            try
            {
                Log.Debug("Validating shares database with connection string {String}", ConnectionString);

                using var conn = new SqliteConnection(ConnectionString);
                conn.Open();
                EnsureCountIndexes(conn);

                using var cmd = new SqliteCommand("SELECT name, sql from sqlite_master WHERE type = 'table';", conn);

                var reader = cmd.ExecuteReader();
                var rows = 0;

                while (reader.Read())
                {
                    var table = reader.GetString(0);
                    var expectedSql = reader.GetString(1);

                    if (schema.TryGetValue(table, out var actualSql))
                    {
                        if (actualSql != expectedSql)
                        {
                            list.Add($"Expected {table} schema to be {expectedSql}, found {actualSql}");
                        }
                        else
                        {
                            Log.Debug("Shares database table {Table} is valid: {Actual}", table, actualSql);
                        }
                    }

                    rows++;
                }

                if (rows != schema.Count)
                {
                    list.Add($"Expected {schema.Count} tables, found {rows}");
                }

                return !problems.Any();
            }
            catch (Exception ex)
            {
                Log.Debug(ex, $"Failed to validate database: {ex.Message}");
                list.Add($"Failed to validate database: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        ///     Updates the scan started at the specified <paramref name="timestamp"/> to set the <paramref name="end"/>.
        /// </summary>
        /// <param name="timestamp">The timestamp associated with the scan.</param>
        /// <param name="end">The timestamp at the conclusion of the scan.</param>
        public void UpdateScan(long timestamp, long end)
        {
            using var conn = GetConnection();

            conn.ExecuteNonQuery("UPDATE scans SET end = @end WHERE timestamp = @timestamp;", cmd =>
            {
                cmd.Parameters.AddWithValue("end", end);
                cmd.Parameters.AddWithValue("timestamp", timestamp);
            });
        }

        /// <summary>
        ///     Reclaims unused space.
        /// </summary>
        public void Vacuum()
        {
            using var conn = GetConnection();
            conn.ExecuteNonQuery("VACUUM;");
        }

        /// <summary>
        ///     Disposes this object.
        /// </summary>
        /// <param name="disposing"></param>
        protected virtual void Dispose(bool disposing)
        {
            if (!Disposed)
            {
                Disposed = true;
            }
        }

        private static string PrefixPattern(string prefix) =>
            prefix.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

        private static void EnsureCountIndexes(SqliteConnection connection)
        {
            connection.ExecuteNonQuery("CREATE INDEX IF NOT EXISTS idx_files_prefix_nocase ON files(maskedFilename COLLATE NOCASE)");
            connection.ExecuteNonQuery("CREATE INDEX IF NOT EXISTS idx_directories_prefix_nocase ON directories(name COLLATE NOCASE)");
        }

        private SqliteConnection GetConnection(string connectionString = null)
        {
            connectionString ??= ConnectionString;

            var conn = new SqliteConnection(connectionString);
            conn.Open();

            // Wait up to 5s for a lock instead of immediately failing with "database is locked"
            // when a scan and a query briefly contend.
            using (var pragma = conn.CreateCommand())
            {
                pragma.CommandText = "PRAGMA busy_timeout=5000;";
                pragma.ExecuteNonQuery();
            }

            return conn;
        }
    }
}
