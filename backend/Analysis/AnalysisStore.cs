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
    using Npgsql;
    using resonance.Common;
    using Serilog;

    /// <summary>
    ///     One table holding every cached analysis metric, replacing the separate
    ///     <c>waveform.waveform_cache</c> and <c>loudness.loudness_cache</c> tables.
    /// </summary>
    /// <remarks>
    ///     BPM and key are deliberately not stored here. They live in the files' own tags, which
    ///     is what the music library reads during a scan and what travels with a file when it
    ///     leaves — a second copy in this table would just be a cache that can silently disagree
    ///     with the tag.
    /// </remarks>
    public class AnalysisStore
    {
        public AnalysisStore(string connectionString)
        {
            ConnectionString = connectionString;
            EnsureSchema();
        }

        private string ConnectionString { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

        public WaveformData GetWaveform(string path)
        {
            var row = Read(path, "num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks");
            if (row == null || row[0] is DBNull || row[1] is DBNull)
            {
                return null;
            }

            return new WaveformData(
                OverallPeaks: BlobToFloats((byte[])row[1]),
                LowPeaks: BlobToFloats((byte[])row[2]),
                MidPeaks: BlobToFloats((byte[])row[3]),
                HighPeaks: BlobToFloats((byte[])row[4]),
                NumBars: Convert.ToInt32(row[0]));
        }

        /// <summary>
        ///     The first detected beat, in seconds from track start — read independently of
        ///     <see cref="GetWaveform"/> because it comes from the BPM detector, not the waveform
        ///     generator, and a track can have one without the other (e.g. a BPM-only rescan of a
        ///     track whose waveform was already cached).
        /// </summary>
        /// <returns>The offset, or null if BPM has never been detected for this track.</returns>
        public double? GetBeatOffsetSeconds(string path)
        {
            var row = Read(path, "beat_offset_seconds");
            return row == null || row[0] is DBNull ? null : Convert.ToDouble(row[0]);
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
        /// <returns>A map of masked filename to its cached waveform and loudness state.</returns>
        public Dictionary<string, (bool HasWaveform, double? Lufs)> GetStatusMap()
        {
            var map = new Dictionary<string, (bool, double?)>(StringComparer.OrdinalIgnoreCase);
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT masked_filename, num_bars IS NOT NULL, lufs FROM analysis.track_analysis";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                map[reader.GetString(0)] = (
                    reader.GetBoolean(1),
                    reader.IsDBNull(2) ? null : reader.GetDouble(2));
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
            cmd.CommandText = @"
                INSERT INTO analysis.track_analysis
                    (masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks,
                     lufs, true_peak, lra, beat_offset_seconds, analysed_at)
                VALUES (@m, @s, @n, @op, @lp, @mp, @hp, @lufs, @tp, @lra, @bo, @t)
                ON CONFLICT(masked_filename) DO UPDATE SET
                    file_size            = EXCLUDED.file_size,
                    num_bars             = COALESCE(EXCLUDED.num_bars,             analysis.track_analysis.num_bars),
                    overall_peaks        = COALESCE(EXCLUDED.overall_peaks,        analysis.track_analysis.overall_peaks),
                    low_peaks            = COALESCE(EXCLUDED.low_peaks,            analysis.track_analysis.low_peaks),
                    mid_peaks            = COALESCE(EXCLUDED.mid_peaks,            analysis.track_analysis.mid_peaks),
                    high_peaks           = COALESCE(EXCLUDED.high_peaks,           analysis.track_analysis.high_peaks),
                    lufs                 = COALESCE(EXCLUDED.lufs,                 analysis.track_analysis.lufs),
                    true_peak            = COALESCE(EXCLUDED.true_peak,            analysis.track_analysis.true_peak),
                    lra                  = COALESCE(EXCLUDED.lra,                  analysis.track_analysis.lra),
                    beat_offset_seconds  = COALESCE(EXCLUDED.beat_offset_seconds,  analysis.track_analysis.beat_offset_seconds),
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
            AddParam(cmd, "@lufs", (object)l?.IntegratedLufs ?? DBNull.Value);
            AddParam(cmd, "@tp", (object)l?.TruePeak ?? DBNull.Value);
            AddParam(cmd, "@lra", (object)l?.LoudnessRange ?? DBNull.Value);
            AddParam(cmd, "@bo", (object)result.BeatOffsetSeconds ?? DBNull.Value);
            AddParam(cmd, "@t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            cmd.ExecuteNonQuery();
        }

        public void Clear()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM analysis.track_analysis";
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
            cmd.CommandText = "DELETE FROM analysis.track_analysis WHERE masked_filename = ANY(@m)";
            AddParam(cmd, "@m", keys);
            cmd.ExecuteNonQuery();
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
            DbConnection conn = new NpgsqlConnection(ConnectionString);
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
            cmd.CommandText = $"SELECT {columns} FROM analysis.track_analysis WHERE masked_filename = @m AND file_size = @s";
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
                    analysed_at      BIGINT NOT NULL
                );
                ALTER TABLE analysis.track_analysis ADD COLUMN IF NOT EXISTS beat_offset_seconds DOUBLE PRECISION;";
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
