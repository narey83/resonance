// <copyright file="AnalysisStore.cs" company="John Narey">
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

namespace resonance.Analysis
{
    using System;
    using System.Collections.Generic;
    using System.Data.Common;
    using System.IO;
    using System.Linq;
    using System.Text.Json;
    using System.Text.Json.Nodes;
    using Npgsql;
    using resonance.Common;
    using Serilog;

    /// <summary>
    ///     One table holding every cached analysis metric, replacing the separate
    ///     <c>waveform.waveform_cache</c> and <c>loudness.loudness_cache</c> tables.
    /// </summary>
    /// <remarks>
    ///     Detected BPM and key are cached so disabling tag writes does not discard them.
    ///     Library queries prefer explicit file tags, then use cache values guarded by file size.
    /// </remarks>
    public class AnalysisStore
    {
        public AnalysisStore(string connectionString, bool usePostgres = true)
        {
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
            EnsureSchema();
        }

        private bool UsePostgres { get; }
        private string Table => UsePostgres ? "analysis.track_analysis" : "track_analysis";
        private string MetadataIndex => UsePostgres ? string.Empty : " INDEXED BY IX_TrackAnalysis_Coverage";
        private string ConnectionString { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

        // Compact, content-guarded DJ metadata for paged collection queries.
        public bool SaveDjSummary(string path, string json)
        {
            var size = new FileInfo(MusicPath.ToAbsolute(path)).Length;
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();

            // A failed optional feature must not erase its last successful fact for the same file.
            using (var previous = conn.CreateCommand())
            {
                previous.CommandText = $"SELECT dj_summary FROM {Table} WHERE masked_filename=@path AND file_size=@size";
                AddParam(previous, "@path", Key(path));
                AddParam(previous, "@size", size);
                if (previous.ExecuteScalar() is string priorJson)
                {
                    var prior = JsonNode.Parse(priorJson);
                    var next = JsonNode.Parse(json);
                    foreach (var fact in new[] { "bpm", "key", "genre", "energy", "vocals" })
                    {
                        if (next[fact] == null && prior[fact] != null)
                        {
                            next[fact] = prior[fact].DeepClone();
                        }
                    }

                    json = next.ToJsonString();
                }
            }

            // Enhanced analysis can finish before the separate native analysis queue.
            // Keep the native metric columns empty; their readiness checks still apply.
            cmd.CommandText = $@"INSERT INTO {Table} (masked_filename, file_size, analysed_at, dj_summary)
                VALUES (@path, @size, @at, @json)
                ON CONFLICT (masked_filename) DO UPDATE SET dj_summary = excluded.dj_summary
                WHERE {Table}.file_size = excluded.file_size AND {Table}.dj_summary IS DISTINCT FROM excluded.dj_summary";
            AddParam(cmd, "@at", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            AddParam(cmd, "@json", json);
            AddParam(cmd, "@path", Key(path));
            AddParam(cmd, "@size", size);
            return cmd.ExecuteNonQuery() > 0;
        }

        public IReadOnlyList<(string Path, string AnalysisId)> ExportReferences()
        {
            var result = new List<(string, string)>();
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = $"SELECT masked_filename, dj_summary FROM {Table} WHERE dj_summary IS NOT NULL ORDER BY masked_filename";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var id = ExportReference(reader.GetString(1));
                if (id != null)
                {
                    result.Add((reader.GetString(0), id));
                }
            }

            return result;
        }

        public string ExportReferenceFor(string path)
        {
            var row = Read(path, "dj_summary");
            return row is { Length: > 0 } && row[0] is string json ? ExportReference(json) : null;
        }

        public WaveformData GetWaveform(string path)
        {
            var row = Read(
                path,
                "num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks, waveform_duration_seconds, sample_rate, waveform_version");
            if (row == null || row[0] is DBNull || row[1] is DBNull)
            {
                return null;
            }

            var numBars = Convert.ToInt32(row[0]);

            // A row analysed before waveform_duration_seconds existed has no stored value —
            // recover a close estimate from num_bars rather than leaving callers with nothing to
            // lay the waveform out against but a media element's own (possibly unstable) duration.
            var durationSeconds = row[5] is DBNull
                ? AudioAnalyzer.EstimateDurationFromBars(numBars)
                : Convert.ToDouble(row[5]);

            return new WaveformData(
                OverallPeaks: BlobToFloats((byte[])row[1]),
                LowPeaks: BlobToFloats((byte[])row[2]),
                MidPeaks: BlobToFloats((byte[])row[3]),
                HighPeaks: BlobToFloats((byte[])row[4]),
                NumBars: numBars,
                DurationSeconds: durationSeconds,
                SampleRate: row[6] is DBNull ? null : Convert.ToInt32(row[6]),
                WaveformVersion: row[7] is DBNull ? null : Convert.ToInt32(row[7]));
        }

        /// <summary>
        ///     Everything the beat detector produced — the grid anchor, the raw detections, and
        ///     the downbeat heuristic — read independently of <see cref="GetWaveform"/> because it
        ///     comes from the BPM detector, not the waveform generator, and a track can have one
        ///     without the other (e.g. a BPM-only rescan of a track whose waveform was already
        ///     cached).
        /// </summary>
        /// <returns>The beat info; every member is null if BPM has never been detected.</returns>
        public BeatAnalysis GetBeatInfo(string path)
        {
            var row = Read(path, "beat_offset_seconds, beats, downbeat_offset_seconds, downbeat_confidence");
            if (row == null)
            {
                return new BeatAnalysis(null, null, null, null);
            }

            return new BeatAnalysis(
                row[0] is DBNull ? null : Convert.ToDouble(row[0]),
                row[1] is DBNull ? null : BlobToFloats((byte[])row[1]),
                row[2] is DBNull ? null : Convert.ToDouble(row[2]),
                row[3] is DBNull ? null : Convert.ToDouble(row[3]));
        }

        public LoudnessData GetLoudness(string path)
        {
            var row = Read(path, "lufs, true_peak, lra");
            if (row == null || row[0] is DBNull)
            {
                return null;
            }

            return new LoudnessData(
                Convert.ToDouble(row[0]), Convert.ToDouble(row[1]), Convert.ToDouble(row[2]));
        }

        /// <summary>
        ///     Returns which metrics are already cached for every analysed track, keyed by masked
        ///     filename. One query rather than a per-track round trip, because the library listing
        ///     needs this for every row at once.
        /// </summary>
        /// <param name="paths">Optional library paths; an empty selection reads no rows.</param>
        /// <returns>A map of masked filename to its cached waveform, beat grid and loudness state.</returns>
        public Dictionary<string, (bool HasWaveform, bool HasBeatGrid, double? Lufs)> GetStatusMap(IEnumerable<string> paths = null)
        {
            var map = new Dictionary<string, (bool, bool, double?)>(StringComparer.OrdinalIgnoreCase);
            using var conn = OpenConnection();
            foreach (var batch in paths?.Select(Key).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(200) ?? new string[][] { null })
            {
                using var cmd = conn.CreateCommand();
                var beatBytes = UsePostgres ? "octet_length(beats)" : "length(beats)";
                cmd.CommandText = $"SELECT masked_filename, num_bars IS NOT NULL, {beatBytes} >= 8, lufs FROM {Table}{MetadataIndex}";
                RestrictPaths(cmd, "masked_filename", batch);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    map[reader.GetString(0)] = (
                        reader.GetBoolean(1),
                        !reader.IsDBNull(2) && reader.GetBoolean(2),
                        reader.IsDBNull(3) ? null : reader.GetDouble(3));
                }
            }

            return map;
        }

        /// <summary>
        ///     Upserts whichever metrics this pass produced, leaving the others untouched so a
        ///     waveform-only scan does not wipe a previously measured loudness.
        /// </summary>
        public void Save(string path, AnalysisResult result)
        {
            long fileSize;
            try
            {
                fileSize = new FileInfo(MusicPath.ToAbsolute(path)).Length;
            }
            catch
            {
                return;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                INSERT INTO {Table}
                    (masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks,
                     waveform_duration_seconds, sample_rate, waveform_version, lufs, true_peak, lra,
                     beat_offset_seconds, beats, downbeat_offset_seconds, downbeat_confidence, detected_bpm, detected_key, analysed_at)
                VALUES (@m, @s, @n, @op, @lp, @mp, @hp, @wd, @sr, @wv, @lufs, @tp, @lra, @bo, @bts, @dbo, @dbc, @bpm, @key, @t)
                ON CONFLICT(masked_filename) DO UPDATE SET
                    file_size            = EXCLUDED.file_size,
                    num_bars             = COALESCE(EXCLUDED.num_bars, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.num_bars END),
                    overall_peaks        = COALESCE(EXCLUDED.overall_peaks, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.overall_peaks END),
                    low_peaks            = COALESCE(EXCLUDED.low_peaks, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.low_peaks END),
                    mid_peaks            = COALESCE(EXCLUDED.mid_peaks, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.mid_peaks END),
                    high_peaks           = COALESCE(EXCLUDED.high_peaks, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.high_peaks END),
                    waveform_duration_seconds = COALESCE(EXCLUDED.waveform_duration_seconds, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.waveform_duration_seconds END),
                    sample_rate          = COALESCE(EXCLUDED.sample_rate, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.sample_rate END),
                    waveform_version     = COALESCE(EXCLUDED.waveform_version, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.waveform_version END),
                    lufs                 = COALESCE(EXCLUDED.lufs, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.lufs END),
                    true_peak            = COALESCE(EXCLUDED.true_peak, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.true_peak END),
                    lra                  = COALESCE(EXCLUDED.lra, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.lra END),
                    beat_offset_seconds  = COALESCE(EXCLUDED.beat_offset_seconds, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.beat_offset_seconds END),
                    beats                = COALESCE(EXCLUDED.beats, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.beats END),
                    downbeat_offset_seconds = COALESCE(EXCLUDED.downbeat_offset_seconds, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.downbeat_offset_seconds END),
                    downbeat_confidence  = COALESCE(EXCLUDED.downbeat_confidence, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.downbeat_confidence END),
                    detected_bpm         = COALESCE(EXCLUDED.detected_bpm, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.detected_bpm END),
                    detected_key         = COALESCE(EXCLUDED.detected_key, CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.detected_key END),
                    dj_summary           = CASE WHEN {Table}.file_size = EXCLUDED.file_size THEN {Table}.dj_summary END,
                    analysed_at          = EXCLUDED.analysed_at";

            var w = result.Waveform;
            var l = result.Loudness;
            AddParam(cmd, "@m", Key(path));
            AddParam(cmd, "@s", fileSize);
            AddParam(cmd, "@n", (object)w?.NumBars ?? DBNull.Value);
            AddParam(cmd, "@op", (object)(w == null ? null : FloatsToBlob(w.OverallPeaks)) ?? DBNull.Value);
            AddParam(cmd, "@lp", (object)(w == null ? null : FloatsToBlob(w.LowPeaks)) ?? DBNull.Value);
            AddParam(cmd, "@mp", (object)(w == null ? null : FloatsToBlob(w.MidPeaks)) ?? DBNull.Value);
            AddParam(cmd, "@hp", (object)(w == null ? null : FloatsToBlob(w.HighPeaks)) ?? DBNull.Value);
            AddParam(cmd, "@wd", (object)w?.DurationSeconds ?? DBNull.Value);
            AddParam(cmd, "@sr", (object)w?.SampleRate ?? DBNull.Value);
            AddParam(cmd, "@wv", (object)w?.WaveformVersion ?? DBNull.Value);
            AddParam(cmd, "@lufs", (object)l?.IntegratedLufs ?? DBNull.Value);
            AddParam(cmd, "@tp", (object)l?.TruePeak ?? DBNull.Value);
            AddParam(cmd, "@lra", (object)l?.LoudnessRange ?? DBNull.Value);
            AddParam(cmd, "@bo", (object)result.BeatOffsetSeconds ?? DBNull.Value);
            AddParam(cmd, "@bts", (object)(result.Beats == null ? null : FloatsToBlob(result.Beats)) ?? DBNull.Value);
            AddParam(cmd, "@dbo", (object)result.DownbeatOffsetSeconds ?? DBNull.Value);
            AddParam(cmd, "@dbc", (object)result.DownbeatConfidence ?? DBNull.Value);
            AddParam(cmd, "@bpm", result.Bpm.HasValue ? (object)checked((int)result.Bpm.Value) : DBNull.Value);
            AddParam(cmd, "@key", (object)result.Key ?? DBNull.Value);
            AddParam(cmd, "@t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            cmd.ExecuteNonQuery();
        }

        public Dictionary<string, (uint? Bpm, string Key)> GetDetectedTags(IEnumerable<string> paths = null)
        {
            var values = new Dictionary<string, (uint?, string)>(StringComparer.OrdinalIgnoreCase);
            using var conn = OpenConnection();
            foreach (var batch in paths?.Select(Key).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(200) ?? new string[][] { null })
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = $@"SELECT a.masked_filename, a.detected_bpm, a.detected_key
                    FROM {Table} a{MetadataIndex} JOIN {(UsePostgres ? "music.tracks" : "tracks")} t
                    ON a.masked_filename = t.path AND a.file_size = t.file_size";
                RestrictPaths(cmd, "a.masked_filename", batch);
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    values[reader.GetString(0)] = (
                        reader.IsDBNull(1) ? null : Convert.ToUInt32(reader.GetValue(1)),
                        reader.IsDBNull(2) ? null : reader.GetString(2));
                }
            }

            return values;
        }

        public void ClearDetectedValue(string path, bool bpm)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = bpm
                ? "UPDATE {Table} SET detected_bpm = NULL WHERE masked_filename = @path"
                : "UPDATE {Table} SET detected_key = NULL WHERE masked_filename = @path";
            AddParam(cmd, "@path", Key(path));
            cmd.ExecuteNonQuery();
        }

        public void Clear()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {Table}";

            // The app-wide 30s default (see the other commands in this file) is tuned for
            // per-track reads/writes, not a full-table admin wipe — on this shared, resource-
            // constrained host a DELETE with no rows to remove even blocked past it once
            // (contention from concurrent Soulseek transfer traffic, not data volume). This is
            // a rare, manually-triggered operation, so a generous ceiling costs nothing day to
            // day but avoids a false timeout under load.
            cmd.CommandTimeout = 300;
            cmd.ExecuteNonQuery();
        }

        /// <summary>Drops the cached rows for just these tracks.</summary>
        public void Remove(IEnumerable<string> paths)
        {
            var keys = paths.Select(Key).ToArray();
            if (keys.Length == 0)
            {
                return;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            if (UsePostgres)
            {
                cmd.CommandText = $"DELETE FROM {Table} WHERE masked_filename = ANY(@m)";
                AddParam(cmd, "@m", keys);
            }
            else
            {
                cmd.CommandText = $"DELETE FROM {Table} WHERE masked_filename = @m";
                foreach (var key in keys)
                {
                    cmd.Parameters.Clear();
                    AddParam(cmd, "@m", key);
                    cmd.ExecuteNonQuery();
                }

                return;
            }

            cmd.ExecuteNonQuery();
        }

        private static string ExportReference(string json)
        {
            try
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (root.TryGetProperty("exportReady", out var ready) && ready.ValueKind == JsonValueKind.False)
                {
                    return null;
                }

                return root.TryGetProperty("complete", out var complete) && complete.ValueKind == JsonValueKind.True
                    && root.TryGetProperty("analysisId", out var id) && id.ValueKind == JsonValueKind.String
                    && Guid.TryParseExact(id.GetString(), "N", out _) ? id.GetString() : null;
            }
            catch (Exception exception) when (exception is JsonException or InvalidOperationException)
            {
                return null;
            }
        }

        private static void RestrictPaths(DbCommand command, string column, string[] paths)
        {
            if (paths == null)
            {
                return;
            }

            var names = Enumerable.Range(0, paths.Length).Select(index => $"@path{index}").ToArray();
            command.CommandText += $" WHERE {column} IN ({string.Join(",", names)})";
            for (var index = 0; index < paths.Length; index++)
            {
                AddParam(command, names[index], paths[index]);
            }
        }

        /// <summary>
        ///     The canonical cache key: a path relative to the music root.
        /// </summary>
        /// <remarks>
        ///     Callers arrive holding one of two different things — the scan has an absolute
        ///     filesystem path, the share layer has a masked name like <c>downloads\Foo\bar.mp3</c>.
        ///     Keying on whichever one turned up wrote the same track under two keys, so a scanned
        ///     waveform was never the one the player looked up. Everything is reduced to the stored
        ///     relative form here instead.
        /// </remarks>
        /// <returns>The root-relative path.</returns>
        private static string Key(string path) => MusicPath.ToRelative(path);

        private static byte[] FloatsToBlob(float[] arr)
        {
            var bytes = new byte[arr.Length * 4];
            Buffer.BlockCopy(arr, 0, bytes, 0, bytes.Length);
            return bytes;
        }

        private static float[] BlobToFloats(byte[] blob)
        {
            var arr = new float[blob.Length / 4];
            Buffer.BlockCopy(blob, 0, arr, 0, blob.Length);
            return arr;
        }

        private static void AddParam(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value;
            cmd.Parameters.Add(p);
        }

        private DbConnection OpenConnection()
        {
            DbConnection conn = UsePostgres ? new NpgsqlConnection(ConnectionString) : new Microsoft.Data.Sqlite.SqliteConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private object[] Read(string path, string columns)
        {
            long fileSize;
            try
            {
                fileSize = new FileInfo(MusicPath.ToAbsolute(path)).Length;
            }
            catch
            {
                return null;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();

            // file_size guards against a file being replaced in place: a different size means the
            // cached peaks describe audio that is no longer there.
            cmd.CommandText = $"SELECT {columns} FROM {Table} WHERE masked_filename = @m AND file_size = @s";
            AddParam(cmd, "@m", Key(path));
            AddParam(cmd, "@s", fileSize);

            using var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                return null;
            }

            var values = new object[reader.FieldCount];
            reader.GetValues(values);
            return values;
        }

        private void EnsureSchema()
        {
            using var conn = OpenConnection();
            if (!UsePostgres)
            {
                using var sqliteCommand = conn.CreateCommand();
                sqliteCommand.CommandText = @"CREATE TABLE IF NOT EXISTS track_analysis (
                    masked_filename TEXT PRIMARY KEY, file_size INTEGER NOT NULL,
                    num_bars INTEGER, overall_peaks BLOB, low_peaks BLOB, mid_peaks BLOB, high_peaks BLOB,
                    waveform_duration_seconds REAL, sample_rate INTEGER, waveform_version INTEGER,
                    lufs REAL, true_peak REAL, lra REAL, beat_offset_seconds REAL, beats BLOB,
                    downbeat_offset_seconds REAL, downbeat_confidence REAL, analysed_at INTEGER NOT NULL, detected_bpm INTEGER, detected_key TEXT, dj_summary TEXT)";
                sqliteCommand.ExecuteNonQuery();
                sqliteCommand.CommandText = "PRAGMA table_info(track_analysis)";
                var existingColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (var columns = sqliteCommand.ExecuteReader())
                {
                    while (columns.Read())
                    {
                        existingColumns.Add(columns.GetString(1));
                    }
                }

                foreach (var (name, type) in new[]
                {
                    ("dj_summary", "TEXT"), ("detected_key", "TEXT"),
                    ("detected_bpm", "INTEGER"), ("lufs", "REAL"), ("overall_peaks", "BLOB"),
                })
                {
                    if (!existingColumns.Contains(name))
                    {
                        sqliteCommand.CommandText = $"ALTER TABLE track_analysis ADD COLUMN {name} {type}";
                        sqliteCommand.ExecuteNonQuery();
                    }
                }

                sqliteCommand.CommandText = "CREATE INDEX IF NOT EXISTS IX_TrackAnalysis_ExportReady ON track_analysis(masked_filename) WHERE dj_summary IS NOT NULL";
                sqliteCommand.ExecuteNonQuery();

                // Coverage must not revisit large waveform blobs for every indexed track.
                // A compact covering index keeps routine readiness refreshes off those rows.
                sqliteCommand.CommandTimeout = 1200;
                sqliteCommand.CommandText = @"CREATE INDEX IF NOT EXISTS IX_TrackAnalysis_Coverage
                    ON track_analysis(masked_filename, file_size, detected_key, detected_bpm,
                        lufs, dj_summary, (overall_peaks IS NOT NULL))";
                sqliteCommand.ExecuteNonQuery();
                sqliteCommand.CommandTimeout = 30;
                sqliteCommand.CommandText = @"CREATE TABLE IF NOT EXISTS imported_track_analysis (
                    collection_sha256 TEXT NOT NULL, source_xml_sha256 TEXT NOT NULL,
                    library_path TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind='rekordbox'),
                    source_track_id TEXT NOT NULL, audio_sha256 TEXT NOT NULL, audio_bytes INTEGER NOT NULL,
                    document_sha256 TEXT NOT NULL, export_json TEXT NOT NULL,
                    allowed_end_overrun_seconds REAL NOT NULL, imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(collection_sha256,library_path))";
                sqliteCommand.ExecuteNonQuery();
                return;
            }

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                CREATE SCHEMA IF NOT EXISTS analysis;
                CREATE TABLE IF NOT EXISTS analysis.track_analysis (
                    masked_filename  TEXT PRIMARY KEY,
                    file_size        BIGINT NOT NULL,
                    num_bars         INTEGER,
                    overall_peaks    BYTEA,
                    low_peaks        BYTEA,
                    mid_peaks        BYTEA,
                    high_peaks       BYTEA,
                    lufs             DOUBLE PRECISION,
                    true_peak        DOUBLE PRECISION,
                    lra              DOUBLE PRECISION,
                    beat_offset_seconds DOUBLE PRECISION,
                    beats            BYTEA,
                    downbeat_offset_seconds DOUBLE PRECISION,
                    downbeat_confidence     DOUBLE PRECISION,
                    analysed_at      BIGINT NOT NULL
                );
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS beat_offset_seconds DOUBLE PRECISION;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS beats BYTEA;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS downbeat_offset_seconds DOUBLE PRECISION;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS downbeat_confidence DOUBLE PRECISION;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS waveform_duration_seconds DOUBLE PRECISION;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS sample_rate INTEGER;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS waveform_version INTEGER;
ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS detected_bpm INTEGER;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS detected_key TEXT;
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS dj_summary TEXT;
CREATE TABLE IF NOT EXISTS analysis.imported_track_analysis (
                        collection_sha256 TEXT NOT NULL,
                        source_xml_sha256 TEXT NOT NULL,
                        library_path TEXT NOT NULL,
                        source_kind TEXT NOT NULL CHECK(source_kind = 'rekordbox'),
                        source_track_id TEXT NOT NULL,
                        audio_sha256 TEXT NOT NULL,
                        audio_bytes BIGINT NOT NULL,
                        document_sha256 TEXT NOT NULL,
                        export_json TEXT NOT NULL,
                        allowed_end_overrun_seconds DOUBLE PRECISION NOT NULL,
                        imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY(collection_sha256, library_path)
                    );
                ALTER TABLE analysis.imported_track_analysis ADD COLUMN IF NOT EXISTS source_xml_sha256 TEXT;";
            cmd.ExecuteNonQuery();

            MigrateLegacyTables(conn);
        }

        /// <summary>
        ///     Folds the old per-metric tables into the unified one. A full library is tens of
        ///     thousands of tracks and hours of decoding, so the existing results are carried over
        ///     rather than re-analysed.
        /// </summary>
        private void MigrateLegacyTables(DbConnection conn)
        {
            try
            {
                using var check = conn.CreateCommand();
                check.CommandText = @"
                    SELECT to_regclass('waveform.waveform_cache') IS NOT NULL,
                           to_regclass('loudness.loudness_cache') IS NOT NULL,
                           EXISTS (SELECT 1 FROM analysis.track_analysis)";
                using var reader = check.ExecuteReader();
                if (!reader.Read())
                {
                    return;
                }

                var hasWaveform = reader.GetBoolean(0);
                var hasLoudness = reader.GetBoolean(1);
                var alreadyPopulated = reader.GetBoolean(2);
                reader.Close();

                if (alreadyPopulated || (!hasWaveform && !hasLoudness))
                {
                    return;
                }

                var migrated = 0;
                if (hasWaveform)
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                        INSERT INTO analysis.track_analysis
                            (masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks, analysed_at)
                        SELECT masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks, analysed_at
                        FROM waveform.waveform_cache
                        ON CONFLICT(masked_filename) DO NOTHING";
                    migrated += cmd.ExecuteNonQuery();
                }

                if (hasLoudness)
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                        INSERT INTO analysis.track_analysis
                            (masked_filename, file_size, lufs, true_peak, lra, analysed_at)
                        SELECT masked_filename, file_size, integrated_lufs, true_peak, loudness_range, analysed_at
                        FROM loudness.loudness_cache
                        ON CONFLICT(masked_filename) DO UPDATE SET
                            lufs      = EXCLUDED.lufs,
                            true_peak = EXCLUDED.true_peak,
                            lra       = EXCLUDED.lra";
                    migrated += cmd.ExecuteNonQuery();
                }

                if (migrated > 0)
                {
                    Log.Information(
                        "Migrated {Count} cached analysis row(s) from the legacy waveform/loudness tables. " +
                        "The old tables are left in place and can be dropped once this is confirmed good.",
                        migrated);
                }
            }
            catch (Exception ex)
            {
                // A failed migration costs re-analysis, not correctness — never block startup for it.
                Log.Warning("Could not migrate legacy analysis caches: {Error}", ex.Message);
            }
        }
    }
}
