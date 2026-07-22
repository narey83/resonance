// <copyright file="LoudnessService.cs" company="John Narey">
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

namespace resonance.LoudnessAnalysis
{
    using System;
    using System.Data.Common;
    using System.Diagnostics;
    using System.Globalization;
    using System.IO;
    using System.Text.RegularExpressions;
    using System.Threading;
    using System.Threading.Tasks;
    using Npgsql;
    using resonance.Common;
    using resonance.Common.Ffmpeg;
    using Serilog;

    public record LoudnessData(double IntegratedLufs, double TruePeak, double LoudnessRange);

    public interface ILoudnessService
    {
        Task<LoudnessData> GetOrAnalyzeAsync(string maskedFilename, string originalFilename, CancellationToken ct);
    }

    // Integrated loudness (LUFS), true peak and loudness range, via ffmpeg's own
    // loudnorm filter (ITU-R BS.1770 / EBU R128) rather than hand-rolled K-weighting
    // DSP — ffmpeg is already a dependency for waveform PCM decode, and its
    // single-pass "measure only" analysis run prints exactly these three numbers
    // as JSON on stderr.
    public class LoudnessService : ILoudnessService
    {
        private static readonly Regex InputIRegex = new(@"""input_i""\s*:\s*""(-?[\d.]+)""");
        private static readonly Regex InputTpRegex = new(@"""input_tp""\s*:\s*""(-?[\d.]+)""");
        private static readonly Regex InputLraRegex = new(@"""input_lra""\s*:\s*""(-?[\d.]+)""");

        public LoudnessService(IFfmpegService ffmpeg, string connectionString, bool usePostgres = false)
        {
            Ffmpeg = ffmpeg;
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
            EnsureSchema();
        }

        private IFfmpegService Ffmpeg { get; }
        private string ConnectionString { get; }
        private bool UsePostgres { get; }
        private string T => UsePostgres ? "loudness.loudness_cache" : "loudness_cache";
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Loudness);

        public async Task<LoudnessData> GetOrAnalyzeAsync(
            string maskedFilename, string originalFilename, CancellationToken ct)
        {
            var cached = TryGetFromCache(maskedFilename, originalFilename);
            if (cached != null)
            {
                return cached;
            }

            var ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
            var data = await AnalyseAsync(originalFilename, ffmpegPath, ct);
            if (data == null)
            {
                return null;
            }

            SaveToCache(maskedFilename, originalFilename, data);
            return data;
        }

        private static async Task<LoudnessData> AnalyseAsync(
            string filePath, string ffmpegBinary, CancellationToken ct)
        {
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegBinary,
                Arguments = $"-hide_banner -nostats -i \"{filePath}\" -af loudnorm=print_format=json -f null -",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
            using var proc = new Process { StartInfo = psi };
            proc.Start();

            // loudnorm prints its measurement summary to stderr, not stdout; stdout
            // is discarded (-f null -) but still needs draining so the process
            // doesn't block on a full pipe buffer.
            var stderrTask = proc.StandardError.ReadToEndAsync(linked.Token);
            var stdoutDrain = proc.StandardOutput.ReadToEndAsync(linked.Token);
            try
            {
                await proc.WaitForExitAsync(linked.Token);
            }
            catch (OperationCanceledException)
            {
                try
                {
                    proc.Kill(entireProcessTree: true);
                }
                catch
                { /* ignored */
                }

                return null;
            }

            var stderr = await stderrTask;
            await stdoutDrain;

            var iMatch = InputIRegex.Match(stderr);
            if (!iMatch.Success)
            {
                return null;
            }

            var tpMatch = InputTpRegex.Match(stderr);
            var lraMatch = InputLraRegex.Match(stderr);

            return new LoudnessData(
                IntegratedLufs: double.Parse(iMatch.Groups[1].Value, CultureInfo.InvariantCulture),
                TruePeak: tpMatch.Success
                    ? double.Parse(tpMatch.Groups[1].Value, CultureInfo.InvariantCulture)
                    : 0,
                LoudnessRange: lraMatch.Success
                    ? double.Parse(lraMatch.Groups[1].Value, CultureInfo.InvariantCulture)
                    : 0);
        }

        // ── DB cache ──────────────────────────────────────────────────────────
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
            if (UsePostgres)
            {
                cmd.CommandText = @"
                    CREATE SCHEMA IF NOT EXISTS loudness;
                    CREATE TABLE IF NOT EXISTS loudness.loudness_cache (
                        masked_filename   TEXT PRIMARY KEY,
                        file_size         BIGINT NOT NULL,
                        integrated_lufs   DOUBLE PRECISION NOT NULL,
                        true_peak         DOUBLE PRECISION NOT NULL,
                        loudness_range    DOUBLE PRECISION NOT NULL,
                        analysed_at       BIGINT NOT NULL
                    )";
            }
            else
            {
                cmd.CommandText = @"
                    CREATE TABLE IF NOT EXISTS loudness_cache (
                        masked_filename   TEXT PRIMARY KEY,
                        file_size         INTEGER NOT NULL,
                        integrated_lufs   REAL NOT NULL,
                        true_peak         REAL NOT NULL,
                        loudness_range    REAL NOT NULL,
                        analysed_at       INTEGER NOT NULL
                    )";
            }

            cmd.ExecuteNonQuery();
        }

        private LoudnessData TryGetFromCache(string maskedFilename, string originalFilename)
        {
            long fileSize;
            try
            {
                fileSize = new FileInfo(originalFilename).Length;
            }
            catch
            {
                return null;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $@"
                SELECT integrated_lufs, true_peak, loudness_range
                FROM {T}
                WHERE masked_filename = @m AND file_size = @s";
            AddParam(cmd, "@m", MusicPath.ToRelative(maskedFilename));
            AddParam(cmd, "@s", fileSize);

            using var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                return null;
            }

            return new LoudnessData(
                IntegratedLufs: reader.GetDouble(0),
                TruePeak: reader.GetDouble(1),
                LoudnessRange: reader.GetDouble(2));
        }

        private void SaveToCache(string maskedFilename, string originalFilename, LoudnessData data)
        {
            long fileSize;
            try
            {
                fileSize = new FileInfo(originalFilename).Length;
            }
            catch
            {
                return;
            }

            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = UsePostgres
                ? $@"INSERT INTO {T}
                        (masked_filename, file_size, integrated_lufs, true_peak, loudness_range, analysed_at)
                    VALUES (@m, @s, @i, @tp, @lra, @t)
                    ON CONFLICT(masked_filename) DO UPDATE SET
                        file_size=EXCLUDED.file_size, integrated_lufs=EXCLUDED.integrated_lufs,
                        true_peak=EXCLUDED.true_peak, loudness_range=EXCLUDED.loudness_range,
                        analysed_at=EXCLUDED.analysed_at"
                : $@"INSERT OR REPLACE INTO {T}
                        (masked_filename, file_size, integrated_lufs, true_peak, loudness_range, analysed_at)
                    VALUES (@m, @s, @i, @tp, @lra, @t)";
            AddParam(cmd, "@m", MusicPath.ToRelative(maskedFilename));
            AddParam(cmd, "@s", fileSize);
            AddParam(cmd, "@i", data.IntegratedLufs);
            AddParam(cmd, "@tp", data.TruePeak);
            AddParam(cmd, "@lra", data.LoudnessRange);
            AddParam(cmd, "@t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            cmd.ExecuteNonQuery();
        }

        private static void AddParam(DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value;
            cmd.Parameters.Add(p);
        }
    }
}
