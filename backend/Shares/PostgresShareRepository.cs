// <copyright file="PostgresShareRepository.cs" company="John Narey">
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

namespace resonance.Shares
{
    using System;
    using System.Collections.Generic;
    using System.Globalization;
    using System.Linq;
    using System.Text;
    using Npgsql;
    using resonance.Common;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     PostgreSQL-backed storage of shared files and metadata. Relies on Postgres' MVCC so scans
    ///     (writers) and searches (readers) never block one another. One physical schema (<c>shares</c>)
    ///     holds all hosts, distinguished by a <c>host</c> column.
    /// </summary>
    public sealed class PostgresShareRepository : IShareRepository
    {
        // Audio extensions eligible for tag enrichment (mirrors the SQLite repository).
        private const string AudioExtensionsInClause =
            "('mp3','flac','aac','ogg','oga','wav','wma','m4a','m4b','m4p','ape','aiff','wv','mpc','mpp','dsf','aa','aax')";

        public PostgresShareRepository(string connectionString, string host)
        {
            ConnectionString = connectionString;
            Host = host;
        }

        public string ConnectionString { get; }

        private string Host { get; }

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Shares.Cache);

        public int CountDirectories(string parentDirectory = null)
        {
            using var conn = GetConnection();
            var sql = "SELECT COUNT(*) FROM shares.directories WHERE host = @host"
                + (string.IsNullOrEmpty(parentDirectory) ? string.Empty : " AND starts_with(name, @prefix)");
            using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("host", Host);
            if (!string.IsNullOrEmpty(parentDirectory))
            {
                cmd.Parameters.AddWithValue("prefix", parentDirectory);
            }

            return Convert.ToInt32(cmd.ExecuteScalar());
        }

        public int CountFiles(string parentDirectory = null)
        {
            using var conn = GetConnection();
            var sql = "SELECT COUNT(*) FROM shares.files WHERE host = @host"
                + (string.IsNullOrEmpty(parentDirectory) ? string.Empty : " AND starts_with(masked_filename, @prefix)");
            using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("host", Host);
            if (!string.IsNullOrEmpty(parentDirectory))
            {
                cmd.Parameters.AddWithValue("prefix", parentDirectory);
            }

            return Convert.ToInt32(cmd.ExecuteScalar());
        }

        public IReadOnlyDictionary<string, int> GetFileTypeCounts()
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT LOWER(COALESCE(extension, '')), COUNT(*) FROM shares.files WHERE host = @host "
                + "GROUP BY LOWER(COALESCE(extension, '')) ORDER BY COUNT(*) DESC;", conn);
            cmd.Parameters.AddWithValue("host", Host);

            var result = new Dictionary<string, int>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                result[reader.GetString(0)] = reader.GetInt32(1);
            }

            return result;
        }

        public void Create(bool discardExisting = false)
        {
            using var conn = GetConnection();

            Execute(conn, "CREATE SCHEMA IF NOT EXISTS shares;");

            if (discardExisting)
            {
                var drop = "DROP TABLE IF EXISTS shares.files; DROP TABLE IF EXISTS shares.directories; "
                    + "DROP TABLE IF EXISTS shares.scans; DROP TABLE IF EXISTS shares.version;";

                Execute(conn, drop);
            }

            Execute(conn, "CREATE TABLE IF NOT EXISTS shares.version (host text NOT NULL, a integer, PRIMARY KEY (host, a));");

            var createScans = "CREATE TABLE IF NOT EXISTS shares.scans "
                + "(host text NOT NULL, timestamp bigint NOT NULL, options text NOT NULL, \"end\" bigint, suspect boolean NOT NULL DEFAULT false, "
                + "PRIMARY KEY (host, timestamp));";

            Execute(conn, createScans);

            var createDirectories = "CREATE TABLE IF NOT EXISTS shares.directories "
                + "(host text NOT NULL, name text COLLATE \"C\" NOT NULL, timestamp bigint NOT NULL, PRIMARY KEY (host, name));";

            Execute(conn, createDirectories);

            // search_vector is generated from the masked filename, so it stays current on every
            // upsert with no separate index table to maintain (RebuildFilenameIndex is a no-op).
            var createFiles = "CREATE TABLE IF NOT EXISTS shares.files "
                + "(host text NOT NULL, masked_filename text COLLATE \"C\" NOT NULL, original_filename text NOT NULL, size bigint NOT NULL, "
                + "touched_at text NOT NULL, code integer NOT NULL DEFAULT 1, extension text, attribute_json text NOT NULL, tags_json text, "
                + "timestamp bigint NOT NULL, "
                + "search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', masked_filename)) STORED, "
                + "PRIMARY KEY (host, masked_filename));";

            Execute(conn, createFiles);

            Execute(conn, "CREATE INDEX IF NOT EXISTS idx_files_search ON shares.files USING gin (search_vector);");
            Execute(conn, "CREATE INDEX IF NOT EXISTS idx_files_timestamp ON shares.files (host, timestamp);");
            Execute(conn, "CREATE INDEX IF NOT EXISTS idx_directories_timestamp ON shares.directories (host, timestamp);");
        }

        public void Dispose() => GC.SuppressFinalize(this);

        // Backup/restore is a SQLite-file feature; not supported by the Postgres repository.
        public void DumpTo(string filename)
            => Log.Warning("Share cache DumpTo is not supported by the PostgreSQL repository; skipping.");

        public void RestoreFrom(IShareRepository repository)
            => Log.Warning("Share cache RestoreFrom is not supported by the PostgreSQL repository; skipping.");

        public (string Filename, long Size) FindFileInfo(string maskedFilename)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT original_filename, size FROM shares.files WHERE host = @host AND masked_filename = @masked;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("masked", maskedFilename);

            using var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                Log.Debug("Failed to resolve shared file {Filename}", maskedFilename);
                return default;
            }

            return (MusicPath.ToAbsolute(reader.GetString(0)), reader.GetInt64(1));
        }

        public Scan FindLatestScan()
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT timestamp, options, COALESCE(\"end\", -1), suspect FROM shares.scans WHERE host = @host ORDER BY timestamp DESC LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("host", Host);

            using var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                return default;
            }

            return ReadScan(reader);
        }

        public void FlagLatestScanAsSuspect()
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "UPDATE shares.scans SET suspect = true WHERE host = @host AND timestamp = "
                + "(SELECT timestamp FROM shares.scans WHERE host = @host ORDER BY timestamp DESC LIMIT 1);", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.ExecuteNonQuery();
        }

        public IReadOnlyDictionary<string, CachedShareFile> ListDirectoryFiles(string maskedDirectoryName)
        {
            var results = new Dictionary<string, CachedShareFile>();
            var prefix = maskedDirectoryName + '\\';

            using var conn = GetConnection();

            // Direct children only: rows under the prefix with no further '\' separator.
            using var cmd = new NpgsqlCommand(
                "SELECT masked_filename, original_filename, size, touched_at FROM shares.files "
                + "WHERE host = @host AND starts_with(masked_filename, @prefix) "
                + "AND position(E'\\\\' in substr(masked_filename, @prefixLength + 1)) = 0;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("prefix", prefix);
            cmd.Parameters.AddWithValue("prefixLength", prefix.Length);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                DateTime? touchedAt = DateTime.TryParseExact(reader.GetString(3), "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
                    ? parsed
                    : null;

                var record = new CachedShareFile(
                    MaskedFilename: reader.GetString(0),
                    OriginalFilename: MusicPath.ToAbsolute(reader.GetString(1)),
                    Size: reader.GetInt64(2),
                    TouchedAt: touchedAt);

                results[record.MaskedFilename] = record;
            }

            return results;
        }

        public void UpsertDirectoryContents(string maskedDirectoryName, long timestamp, IReadOnlyCollection<ShareFileUpsert> upserts, IReadOnlyCollection<string> touchedFilenames)
        {
            using var conn = GetConnection();
            using var txn = conn.BeginTransaction();

            using (var cmd = new NpgsqlCommand(
                "INSERT INTO shares.directories (host, name, timestamp) VALUES (@host, @name, @timestamp) "
                + "ON CONFLICT (host, name) DO UPDATE SET timestamp = excluded.timestamp;", conn, txn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("name", maskedDirectoryName);
                cmd.Parameters.AddWithValue("timestamp", timestamp);
                cmd.ExecuteNonQuery();
            }

            // Insert in multi-row batches (one round-trip per ~500 files) rather than one statement
            // per file — a full populate of tens of thousands of files is otherwise dominated by
            // per-row round-trip latency, which also delays shares-ready (and Soulseek login).
            const int batchSize = 500;
            foreach (var batch in upserts.Chunk(batchSize))
            {
                var sql = new StringBuilder(
                    "INSERT INTO shares.files (host, masked_filename, original_filename, size, touched_at, code, extension, attribute_json, tags_json, timestamp) VALUES ");

                using var cmd = new NpgsqlCommand { Connection = conn, Transaction = txn };
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("ts", timestamp);

                for (var i = 0; i < batch.Length; i++)
                {
                    var u = batch[i];
                    if (i > 0)
                    {
                        sql.Append(',');
                    }

                    sql.Append($"(@host,@m{i},@o{i},@s{i},@t{i},@c{i},@e{i},@a{i},@g{i},@ts)");
                    cmd.Parameters.AddWithValue($"m{i}", u.MaskedFilename);
                    cmd.Parameters.AddWithValue($"o{i}", MusicPath.ToRelative(u.OriginalFilename));
                    cmd.Parameters.AddWithValue($"s{i}", u.File.Size);
                    cmd.Parameters.AddWithValue($"t{i}", u.TouchedAt.ToString("O", CultureInfo.InvariantCulture));
                    cmd.Parameters.AddWithValue($"c{i}", u.File.Code);
                    cmd.Parameters.AddWithValue($"e{i}", (object)u.File.Extension ?? DBNull.Value);
                    cmd.Parameters.AddWithValue($"a{i}", u.File.Attributes.ToJson());
                    cmd.Parameters.AddWithValue($"g{i}", u.Tags != null ? u.Tags.ToJson() : (object)DBNull.Value);
                }

                sql.Append(" ON CONFLICT (host, masked_filename) DO UPDATE SET original_filename = excluded.original_filename, "
                    + "size = excluded.size, touched_at = excluded.touched_at, code = excluded.code, extension = excluded.extension, "
                    + "attribute_json = excluded.attribute_json, tags_json = excluded.tags_json, timestamp = excluded.timestamp;");

                cmd.CommandText = sql.ToString();
                cmd.ExecuteNonQuery();
            }

            // Refresh unchanged files' timestamps in one statement via an array match.
            if (touchedFilenames.Count > 0)
            {
                using var cmd = new NpgsqlCommand(
                    "UPDATE shares.files SET timestamp = @timestamp WHERE host = @host AND masked_filename = ANY(@names);", conn, txn);
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("timestamp", timestamp);
                cmd.Parameters.AddWithValue("names", touchedFilenames.ToArray());
                cmd.ExecuteNonQuery();
            }

            txn.Commit();
        }

        public FileTags FindTags(string maskedFilename)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT tags_json FROM shares.files WHERE host = @host AND masked_filename = @masked AND tags_json IS NOT NULL;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("masked", maskedFilename);

            using var reader = cmd.ExecuteReader();
            return reader.Read() ? reader.GetString(0).FromJson<FileTags>() : null;
        }

        public IEnumerable<(string MaskedFilename, FileTags Tags)> ListTags()
        {
            var results = new List<(string, FileTags)>();
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT masked_filename, tags_json FROM shares.files WHERE host = @host AND tags_json IS NOT NULL ORDER BY masked_filename ASC;", conn);
            cmd.Parameters.AddWithValue("host", Host);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var tags = reader.GetString(1).FromJson<FileTags>();
                if (tags != null)
                {
                    results.Add((reader.GetString(0), tags));
                }
            }

            return results;
        }

        public IEnumerable<(string MaskedFilename, string OriginalFilename, FileTags Tags)> ListTaggedFiles()
        {
            var results = new List<(string, string, FileTags)>();
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT masked_filename, original_filename, tags_json FROM shares.files WHERE host = @host AND tags_json IS NOT NULL "
                + "AND extension IN " + AudioExtensionsInClause + " ORDER BY masked_filename ASC;", conn);
            cmd.Parameters.AddWithValue("host", Host);

            using var reader = cmd.ExecuteReader();
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

        public IEnumerable<(string MaskedFilename, string OriginalFilename)> ListUntaggedFiles()
        {
            var results = new List<(string, string)>();
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT masked_filename, original_filename FROM shares.files WHERE host = @host AND tags_json IS NULL "
                + "AND extension IN " + AudioExtensionsInClause + " ORDER BY masked_filename ASC;", conn);
            cmd.Parameters.AddWithValue("host", Host);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add((reader.GetString(0), reader.GetString(1)));
            }

            return results;
        }

        public void UpdateFileTags(string maskedFilename, FileTags tags, long size, DateTime touchedAt)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "UPDATE shares.files SET tags_json = @tags, size = @size, touched_at = @touched "
                + "WHERE host = @host AND masked_filename = @masked;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("masked", maskedFilename);
            cmd.Parameters.AddWithValue("tags", tags != null ? tags.ToJson() : (object)DBNull.Value);
            cmd.Parameters.AddWithValue("size", size);

            // must round-trip through the same "O" format ListDirectoryFiles parses, otherwise the
            // scanner's unchanged-file fast path can't match this row and re-reads its tags forever.
            cmd.Parameters.AddWithValue("touched", touchedAt.ToString("O", CultureInfo.InvariantCulture));
            cmd.ExecuteNonQuery();
        }

        public string GetDirectoryOriginalPath(string maskedDirectory)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT original_filename FROM shares.files WHERE host = @host AND starts_with(masked_filename, @prefix) LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("prefix", maskedDirectory + '\\');

            using var reader = cmd.ExecuteReader();
            return reader.Read() ? System.IO.Path.GetDirectoryName(MusicPath.ToAbsolute(reader.GetString(0))) : null;
        }

        public void RenameDirectory(string oldMaskedDirectory, string newMaskedDirectory, string oldOriginalDirectory, string newOriginalDirectory)
        {
            using var conn = GetConnection();

            // original_filename is stored relative to the music root; convert both sides so the
            // substring offset matches the stored (relative) length.
            var relOldOriginal = MusicPath.ToRelative(oldOriginalDirectory);
            var relNewOriginal = MusicPath.ToRelative(newOriginalDirectory);

            using (var cmd = new NpgsqlCommand(
                "UPDATE shares.files SET masked_filename = @newMasked || substr(masked_filename, @oldMaskedLen + 1), "
                + "original_filename = @newOrig || substr(original_filename, @oldOrigLen + 1) "
                + "WHERE host = @host AND starts_with(masked_filename, @oldPrefix);", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("newMasked", newMaskedDirectory);
                cmd.Parameters.AddWithValue("oldMaskedLen", oldMaskedDirectory.Length);
                cmd.Parameters.AddWithValue("newOrig", relNewOriginal);
                cmd.Parameters.AddWithValue("oldOrigLen", relOldOriginal.Length);
                cmd.Parameters.AddWithValue("oldPrefix", oldMaskedDirectory + '\\');
                cmd.ExecuteNonQuery();
            }

            using (var cmd = new NpgsqlCommand(
                "UPDATE shares.directories SET name = @newMasked || substr(name, @oldMaskedLen + 1) "
                + "WHERE host = @host AND (starts_with(name, @oldPrefix) OR name = @oldMasked);", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("newMasked", newMaskedDirectory);
                cmd.Parameters.AddWithValue("oldMaskedLen", oldMaskedDirectory.Length);
                cmd.Parameters.AddWithValue("oldPrefix", oldMaskedDirectory + '\\');
                cmd.Parameters.AddWithValue("oldMasked", oldMaskedDirectory);
                cmd.ExecuteNonQuery();
            }
        }

        public void InsertScan(long timestamp, Options.SharesOptions options)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "INSERT INTO shares.scans (host, timestamp, options) VALUES (@host, @timestamp, @options);", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("timestamp", timestamp);
            cmd.Parameters.AddWithValue("options", options.ToJson());
            cmd.ExecuteNonQuery();
        }

        public IEnumerable<string> ListDirectories(string parentDirectory = null)
        {
            var results = new List<string>();
            using var conn = GetConnection();
            var sql = "SELECT name FROM shares.directories WHERE host = @host"
                + (string.IsNullOrEmpty(parentDirectory) ? string.Empty : " AND starts_with(name, @prefix)")
                + " ORDER BY name ASC;";
            using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("host", Host);
            if (!string.IsNullOrEmpty(parentDirectory))
            {
                cmd.Parameters.AddWithValue("prefix", parentDirectory);
            }

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add(reader.GetString(0));
            }

            return results;
        }

        public IEnumerable<File> ListFiles(string parentDirectory = null, bool includeFullPath = false)
        {
            var results = new List<File>();
            using var conn = GetConnection();
            var sql = "SELECT masked_filename, code, size, extension, attribute_json FROM shares.files WHERE host = @host"
                + (string.IsNullOrEmpty(parentDirectory) ? string.Empty : " AND starts_with(masked_filename, @prefix)")
                + " ORDER BY masked_filename ASC;";
            using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("host", Host);
            if (!string.IsNullOrEmpty(parentDirectory))
            {
                cmd.Parameters.AddWithValue("prefix", parentDirectory);
            }

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                results.Add(ReadFile(reader, includeFullPath));
            }

            return results;
        }

        public IEnumerable<Scan> ListScans(long startedAtOrAfter = 0)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "SELECT timestamp, options, COALESCE(\"end\", -1), suspect FROM shares.scans WHERE host = @host AND timestamp >= @start;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("start", startedAtOrAfter);

            var scans = new List<Scan>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                scans.Add(ReadScan(reader));
            }

            return scans;
        }

        public void DeleteEntriesByPaths(string originalPathPrefix, string maskedPathPrefix)
        {
            using var conn = GetConnection();

            // original_filename is stored relative to the music root.
            var relOriginalPrefix = MusicPath.ToRelative(originalPathPrefix);

            using (var cmd = new NpgsqlCommand(
                "DELETE FROM shares.files WHERE host = @host AND (original_filename = @orig OR starts_with(original_filename, @origPrefix));", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("orig", relOriginalPrefix);
                cmd.Parameters.AddWithValue("origPrefix", relOriginalPrefix.TrimEnd('/') + "/");
                cmd.ExecuteNonQuery();
            }

            using (var cmd = new NpgsqlCommand(
                "DELETE FROM shares.directories WHERE host = @host AND (name = @masked OR starts_with(name, @maskedPrefix));", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("masked", maskedPathPrefix);
                cmd.Parameters.AddWithValue("maskedPrefix", maskedPathPrefix.TrimEnd('\\') + "\\");
                cmd.ExecuteNonQuery();
            }
        }

        public void DeleteByMaskedPrefix(string maskedDirectory)
        {
            using var conn = GetConnection();
            var prefix = maskedDirectory.TrimEnd('\\') + "\\";

            using (var cmd = new NpgsqlCommand(
                "DELETE FROM shares.files WHERE host = @host AND (masked_filename = @masked OR starts_with(masked_filename, @prefix));", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("masked", maskedDirectory);
                cmd.Parameters.AddWithValue("prefix", prefix);
                cmd.ExecuteNonQuery();
            }

            using (var cmd = new NpgsqlCommand(
                "DELETE FROM shares.directories WHERE host = @host AND (name = @masked OR starts_with(name, @prefix));", conn))
            {
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("masked", maskedDirectory);
                cmd.Parameters.AddWithValue("prefix", prefix);
                cmd.ExecuteNonQuery();
            }
        }

        public long PruneDirectories(long olderThanTimestamp)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "DELETE FROM shares.directories WHERE host = @host AND timestamp < @timestamp;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("timestamp", olderThanTimestamp);
            return cmd.ExecuteNonQuery();
        }

        public long PruneFiles(long olderThanTimestamp)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "DELETE FROM shares.files WHERE host = @host AND timestamp < @timestamp;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("timestamp", olderThanTimestamp);
            return cmd.ExecuteNonQuery();
        }

        // The search vector is a generated column, always current — nothing to rebuild.
        public void RebuildFilenameIndex()
        {
        }

        public IEnumerable<File> Search(SearchQuery query, int? limit = null)
        {
            var terms = string.Join(" ", query.Terms ?? Enumerable.Empty<string>()).Trim();
            if (string.IsNullOrWhiteSpace(terms))
            {
                return Enumerable.Empty<File>();
            }

            // Positive term match uses the GIN-indexed tsvector (plainto_tsquery ANDs the lexemes and
            // safely sanitizes input). Exclusions are applied as a substring post-filter below, which
            // is stricter than token matching (catches "xbarx" for a "bar" exclusion).
            var sql = "SELECT masked_filename, code, size, extension, attribute_json FROM shares.files "
                + "WHERE host = @host AND search_vector @@ plainto_tsquery('simple', @terms) "
                + "ORDER BY masked_filename ASC" + (limit.HasValue ? " LIMIT @limit" : string.Empty) + ";";

            var results = new List<File>();

            try
            {
                using var conn = GetConnection();
                using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("host", Host);
                cmd.Parameters.AddWithValue("terms", terms);
                if (limit.HasValue)
                {
                    cmd.Parameters.AddWithValue("limit", limit.Value);
                }

                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var maskedFilename = reader.GetString(0);

                    if (query.Exclusions.Any(x => maskedFilename.Contains(x, StringComparison.OrdinalIgnoreCase)))
                    {
                        Log.Debug("Dropping excluded filename {File}", maskedFilename);
                        continue;
                    }

                    results.Add(ReadFile(reader, includeFullPath: true));
                }

                return results;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to execute shared file query '{Query}': {Message}", query, ex.Message);
                return Enumerable.Empty<File>();
            }
        }

        public bool TryValidate() => TryValidate(out _);

        public bool TryValidate(out IEnumerable<string> problems)
        {
            var list = new List<string>();
            problems = list;

            try
            {
                using var conn = GetConnection();
                using var cmd = new NpgsqlCommand(
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'shares' "
                    + "AND table_name IN ('files','directories','scans','version');", conn);
                var count = Convert.ToInt32(cmd.ExecuteScalar());
                if (count < 4)
                {
                    list.Add($"Expected 4 shares tables, found {count}");
                }

                return !list.Any();
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Failed to validate database: {Message}", ex.Message);
                list.Add($"Failed to validate database: {ex.Message}");
                return false;
            }
        }

        public void UpdateScan(long timestamp, long end)
        {
            using var conn = GetConnection();
            using var cmd = new NpgsqlCommand(
                "UPDATE shares.scans SET \"end\" = @end WHERE host = @host AND timestamp = @timestamp;", conn);
            cmd.Parameters.AddWithValue("host", Host);
            cmd.Parameters.AddWithValue("end", end);
            cmd.Parameters.AddWithValue("timestamp", timestamp);
            cmd.ExecuteNonQuery();
        }

        // Postgres reclaims space via autovacuum; an explicit VACUUM can't run inside Npgsql's
        // implicit transaction, so this is intentionally a no-op.
        public void Vacuum()
        {
        }

        private static Scan ReadScan(NpgsqlDataReader reader)
        {
            var endRaw = reader.GetInt64(2);
            return new Scan
            {
                StartedAt = reader.GetInt64(0),
                OptionsJson = reader.GetString(1),
                EndedAt = endRaw == -1 ? null : endRaw,
                Suspect = reader.GetBoolean(3),
            };
        }

        private static File ReadFile(NpgsqlDataReader reader, bool includeFullPath)
        {
            var filename = reader.GetString(0);
            var code = reader.GetInt32(1);
            var size = reader.GetInt64(2);
            var extension = reader.IsDBNull(3) ? null : reader.GetString(3);
            var attributeList = reader.GetString(4).FromJson<List<FileAttribute>>();

            filename = includeFullPath ? filename : filename.GetNormalizedFileName();
            return new File(code, filename, size, extension, attributeList);
        }

        private static void Execute(NpgsqlConnection conn, string sql)
        {
            using var cmd = new NpgsqlCommand(sql, conn);
            cmd.ExecuteNonQuery();
        }

        private NpgsqlConnection GetConnection()
        {
            var conn = new NpgsqlConnection(ConnectionString);
            conn.Open();
            return conn;
        }
    }
}
