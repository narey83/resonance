// <copyright file="WaveformService.cs" company="John Narey">
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

namespace resonance.WaveformAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.Data;
    using System.Data.Common;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using Npgsql;
    using resonance.Common;
    using resonance.Common.Ffmpeg;
    using resonance.Shares;
    using Serilog;

    public class WaveformService : IWaveformService, IHostedService
    {
        private const int SampleRate = 44100;
        private const int TargetDsRate = 6_000;       // downsample rate for band filters

        // Bars scale with track length (~5ms/bar) rather than a fixed count, so a 10-minute
        // track gets the same time-resolution as a 3-minute one instead of always being coarser.
        // 5ms/bar is fine enough to resolve a kick's actual transient shape (~10-20ms), not just
        // which coarse window it falls in. Clamped so pathologically short/long files stay sane.
        private const int BarsPerSecond = 200;
        private const int MinBars = 500;
        private const int MaxBars = 200_000;
        private const int BassCutoffHz = 300;
        private const int MidCutoffHz = 2_000;

        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        public WaveformService(IShareService shareService, IFfmpegService ffmpeg, string connectionString, bool usePostgres = false)
        {
            ShareService = shareService;
            Ffmpeg = ffmpeg;
            ConnectionString = connectionString;
            UsePostgres = usePostgres;
            EnsureSchema();
        }

        public WaveformScanState ScanState => CurrentState;

        private IShareService ShareService { get; }
        private IFfmpegService Ffmpeg { get; }
        private string ConnectionString { get; }
        private bool UsePostgres { get; }
        private string T => UsePostgres ? "waveform.waveform_cache" : "waveform_cache";
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Waveform);

        private WaveformScanState CurrentState { get; set; } = new(false, false, false, 0, 0, 0, 0, 0);
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }
        private Task ScanTask { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            if (Cts != null && !Cts.IsCancellationRequested)
            {
                Cts.Cancel();
            }

            if (ScanTask != null)
            {
                try
                {
                    await ScanTask.WaitAsync(cancellationToken);
                }
                catch
                { /* scan cancelled or shutdown timed out */
                }
            }
        }

        // ── Public API ────────────────────────────────────────────────────────
        public async Task<WaveformData> GetOrAnalyzeAsync(
            string maskedFilename, string originalFilename, CancellationToken ct)
        {
            var cached = TryGetFromCache(maskedFilename, originalFilename);
            if (cached != null)
            {
                return cached;
            }

            var ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
            var pcm = await DecodePcmAsync(originalFilename, ffmpegPath, ct);
            if (pcm == null)
            {
                return null;
            }

            var data = ComputeBands(pcm, SampleRate, BarsForDuration(pcm.Length, SampleRate));
            SaveToCache(maskedFilename, originalFilename, data);
            return data;
        }

        public async Task StartScanAsync(WaveformScanRequest request)
        {
            if (!await SyncRoot.WaitAsync(0))
            {
                Log.Warning("Waveform scan rejected; scan already in progress.");
                throw new InvalidOperationException("A waveform scan is already in progress.");
            }

            SetState(true, false, false, 0, 0, 0, 0);
            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            ScanTask = Task.Run(() => RunScanAsync(request, Cts.Token), Cts.Token);
        }

        public bool CancelScan()
        {
            if (Cts == null || Cts.IsCancellationRequested)
            {
                return false;
            }

            Cts.Cancel();
            return true;
        }

        // ── Audio decoding ────────────────────────────────────────────────────
        private static async Task<float[]> DecodePcmAsync(
            string filePath, string ffmpegBinary, CancellationToken ct)
        {
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegBinary,
                Arguments = $"-loglevel quiet -i \"{filePath}\" -vn -acodec pcm_f32le -ar {SampleRate} -ac 1 -f f32le pipe:1",
                RedirectStandardOutput = true,
                RedirectStandardError = false,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
            using var proc = new Process { StartInfo = psi };
            proc.Start();

            using var ms = new MemoryStream();
            try
            {
                await proc.StandardOutput.BaseStream.CopyToAsync(ms, linked.Token);
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

            var bytes = ms.ToArray();
            if (bytes.Length < 4 * SampleRate)
            {
                return null; // need at least 1s
            }

            var sampleCount = bytes.Length / 4;
            var samples = new float[sampleCount];
            Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            return samples;
        }

        private static int BarsForDuration(int sampleCount, int sampleRate) =>
            Math.Clamp((int)Math.Round((double)sampleCount / sampleRate * BarsPerSecond), MinBars, MaxBars);

        // ── Band computation (port of JS IIR filter logic) ────────────────────
        private static WaveformData ComputeBands(float[] monoData, int sampleRate, int numBars)
        {
            var overallPeaks = ComputeRms(monoData, numBars);

            var dsFactor = Math.Max(1, (int)Math.Round((double)sampleRate / TargetDsRate));
            var dsData = Downsample(monoData, dsFactor);
            var dsRate = (double)sampleRate / dsFactor;

            var lowFiltered = OnePoleLowpass(dsData, BassCutoffHz, dsRate);
            var lowMidFiltered = OnePoleLowpass(dsData, MidCutoffHz, dsRate);

            var midData = new float[dsData.Length];
            var highData = new float[dsData.Length];
            for (var i = 0; i < dsData.Length; i++)
            {
                midData[i] = lowMidFiltered[i] - lowFiltered[i];
                highData[i] = dsData[i] - lowMidFiltered[i];
            }

            return new WaveformData(
                OverallPeaks: overallPeaks,
                LowPeaks: ComputePeaks(lowFiltered, numBars),
                MidPeaks: ComputePeaks(midData, numBars),
                HighPeaks: ComputePeaks(highData, numBars),
                NumBars: numBars);
        }

        private static float[] OnePoleLowpass(float[] data, double cutoffHz, double sampleRate)
        {
            var dt = 1.0 / sampleRate;
            var rc = 1.0 / (2.0 * Math.PI * cutoffHz);
            var alpha = (float)(dt / (rc + dt));
            var out_ = new float[data.Length];
            var last = 0f;
            for (var i = 0; i < data.Length; i++)
            {
                last = last + (alpha * (data[i] - last));
                out_[i] = last;
            }

            return out_;
        }

        private static float[] Downsample(float[] data, int factor)
        {
            if (factor <= 1)
            {
                return data;
            }

            var len = data.Length / factor;
            var out_ = new float[len];
            for (var i = 0; i < len; i++)
            {
                var sum = 0.0;
                for (var j = 0; j < factor; j++)
                {
                    sum += data[(i * factor) + j];
                }

                out_[i] = (float)(sum / factor);
            }

            return out_;
        }

        private static float[] ComputeRms(float[] data, int numBars)
        {
            var samplesPerBar = Math.Max(1, data.Length / numBars);
            var rms = new float[numBars];
            for (var b = 0; b < numBars; b++)
            {
                var start = b * samplesPerBar;
                var end = Math.Min(start + samplesPerBar, data.Length);
                var sum = 0.0;
                for (var i = start; i < end; i++)
                {
                    sum += (double)data[i] * data[i];
                }

                rms[b] = (float)Math.Sqrt(sum / (end - start));
            }

            return rms;
        }

        private static float[] ComputePeaks(float[] data, int numBars)
        {
            var samplesPerBar = Math.Max(1, data.Length / numBars);
            var peaks = new float[numBars];
            for (var b = 0; b < numBars; b++)
            {
                var start = b * samplesPerBar;
                var end = Math.Min(start + samplesPerBar, data.Length);
                var peak = 0f;
                for (var i = start; i < end; i++)
                {
                    var abs = Math.Abs(data[i]);
                    if (abs > peak)
                    {
                        peak = abs;
                    }
                }

                peaks[b] = peak;
            }

            return peaks;
        }

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

        private static void AddParam(System.Data.Common.DbCommand cmd, string name, object value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value;
            cmd.Parameters.Add(p);
        }

        // ── Scan loop ─────────────────────────────────────────────────────────
        private DbConnection OpenConnection()
        {
            DbConnection conn = new NpgsqlConnection(ConnectionString);
            conn.Open();
            return conn;
        }

        private async Task RunScanAsync(WaveformScanRequest request, CancellationToken ct)
        {
            try
            {
                var tracks = GetAllAudioTracks();

                if (request.ResetAll)
                {
                    ClearCache();
                }

                var toAnalyse = request.SkipAnalysed && !request.ResetAll
                    ? tracks.Where(t => !IsCached(t.MaskedFilename)).ToList()
                    : tracks;

                var total = toAnalyse.Count;
                SetState(true, false, false, total, 0, 0, 0);
                Log.Information("Waveform scan started. Workers: {Workers}, Tracks: {Total}", request.Workers, total);

                string ffmpegPath;
                try
                {
                    ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
                }
                catch (Exception ex)
                {
                    Log.Warning("Could not locate ffmpeg — waveform scan aborted: {Error}", ex.Message);
                    SetState(false, false, false, 0, 0, 0, 0);
                    SyncRoot.Release();
                    return;
                }

                var channel = Channel.CreateBounded<(string Masked, string Original)>(
                    new BoundedChannelOptions(request.Workers * 2) { FullMode = BoundedChannelFullMode.Wait });

                var analysed = 0;
                var skipped = 0;
                var failed = 0;
                var inFlight = 0;

                var workers = Enumerable.Range(0, request.Workers).Select(_ => Task.Run(async () =>
                {
                    await foreach (var (masked, original) in channel.Reader.ReadAllAsync(ct))
                    {
                        Interlocked.Increment(ref inFlight);
                        try
                        {
                            var pcm = await DecodePcmAsync(original, ffmpegPath, ct);
                            if (pcm == null)
                            {
                                Interlocked.Increment(ref failed);
                                continue;
                            }

                            var data = ComputeBands(pcm, SampleRate, BarsForDuration(pcm.Length, SampleRate));
                            SaveToCache(masked, original, data);
                            Interlocked.Increment(ref analysed);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Warning("Waveform analysis failed for {File}: {Error}", original, ex.Message);
                            Interlocked.Increment(ref failed);
                        }
                        finally
                        {
                            Interlocked.Decrement(ref inFlight);
                            var done = analysed + skipped + failed;
                            SetState(true, false, false, total, analysed, skipped, failed, inFlight);
                        }
                    }
                }, ct)).ToArray();

                foreach (var track in toAnalyse)
                {
                    if (ct.IsCancellationRequested)
                    {
                        break;
                    }

                    await channel.Writer.WriteAsync(track, ct);
                }

                channel.Writer.Complete();
                await Task.WhenAll(workers);

                var cancelled = ct.IsCancellationRequested;
                Log.Information("Waveform scan complete. Analysed: {A}, Skipped: {S}, Failed: {F}",
                    analysed, skipped, failed);
                SetState(false, !cancelled, cancelled, total, analysed, skipped, failed);
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true, CurrentState.Total, CurrentState.Analysed,
                    CurrentState.Skipped, CurrentState.Failed);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Waveform scan failed unexpectedly.");
                SetState(false, false, false, 0, 0, 0, 0);
            }
            finally
            {
                SyncRoot.Release();
            }
        }

        // ── DB cache ──────────────────────────────────────────────────────────
        private void EnsureSchema()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            if (UsePostgres)
            {
                cmd.CommandText = @"
                    CREATE SCHEMA IF NOT EXISTS waveform;
                    CREATE TABLE IF NOT EXISTS waveform.waveform_cache (
                        masked_filename  TEXT PRIMARY KEY,
                        file_size        BIGINT NOT NULL,
                        num_bars         INTEGER NOT NULL,
                        overall_peaks    BYTEA NOT NULL,
                        low_peaks        BYTEA NOT NULL,
                        mid_peaks        BYTEA NOT NULL,
                        high_peaks       BYTEA NOT NULL,
                        analysed_at      BIGINT NOT NULL
                    )";
            }
            else
            {
                cmd.CommandText = @"
                    CREATE TABLE IF NOT EXISTS waveform_cache (
                        masked_filename  TEXT PRIMARY KEY,
                        file_size        INTEGER NOT NULL,
                        num_bars         INTEGER NOT NULL,
                        overall_peaks    BLOB NOT NULL,
                        low_peaks        BLOB NOT NULL,
                        mid_peaks        BLOB NOT NULL,
                        high_peaks       BLOB NOT NULL,
                        analysed_at      INTEGER NOT NULL
                    )";
            }

            cmd.ExecuteNonQuery();
        }

        private WaveformData TryGetFromCache(string maskedFilename, string originalFilename)
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
                SELECT num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks
                FROM {T}
                WHERE masked_filename = @m AND file_size = @s";
            AddParam(cmd, "@m", MusicPath.ToRelative(maskedFilename));
            AddParam(cmd, "@s", fileSize);

            using var reader = cmd.ExecuteReader();
            if (!reader.Read())
            {
                return null;
            }

            var numBars = reader.GetInt32(0);
            return new WaveformData(
                OverallPeaks: BlobToFloats((byte[])reader[1]),
                LowPeaks: BlobToFloats((byte[])reader[2]),
                MidPeaks: BlobToFloats((byte[])reader[3]),
                HighPeaks: BlobToFloats((byte[])reader[4]),
                NumBars: numBars);
        }

        private bool IsCached(string maskedFilename)
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT 1 FROM {T} WHERE masked_filename = @m LIMIT 1";
            AddParam(cmd, "@m", MusicPath.ToRelative(maskedFilename));
            return cmd.ExecuteScalar() != null;
        }

        private void SaveToCache(string maskedFilename, string originalFilename, WaveformData data)
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
                        (masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks, analysed_at)
                    VALUES (@m, @s, @n, @op, @lp, @mp, @hp, @t)
                    ON CONFLICT(masked_filename) DO UPDATE SET
                        file_size=EXCLUDED.file_size, num_bars=EXCLUDED.num_bars,
                        overall_peaks=EXCLUDED.overall_peaks, low_peaks=EXCLUDED.low_peaks,
                        mid_peaks=EXCLUDED.mid_peaks, high_peaks=EXCLUDED.high_peaks,
                        analysed_at=EXCLUDED.analysed_at"
                : $@"INSERT OR REPLACE INTO {T}
                        (masked_filename, file_size, num_bars, overall_peaks, low_peaks, mid_peaks, high_peaks, analysed_at)
                    VALUES (@m, @s, @n, @op, @lp, @mp, @hp, @t)";
            AddParam(cmd, "@m", MusicPath.ToRelative(maskedFilename));
            AddParam(cmd, "@s", fileSize);
            AddParam(cmd, "@n", data.NumBars);
            AddParam(cmd, "@op", FloatsToBlob(data.OverallPeaks));
            AddParam(cmd, "@lp", FloatsToBlob(data.LowPeaks));
            AddParam(cmd, "@mp", FloatsToBlob(data.MidPeaks));
            AddParam(cmd, "@hp", FloatsToBlob(data.HighPeaks));
            AddParam(cmd, "@t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            cmd.ExecuteNonQuery();
        }

        private void ClearCache()
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {T}";
            cmd.ExecuteNonQuery();
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private List<(string MaskedFilename, string Original)> GetAllAudioTracks()
        {
            var tagged = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => (f.MaskedFilename, f.OriginalFilename));

            var untagged = ShareService.GetUntaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => (f.MaskedFilename, f.OriginalFilename));

            return tagged.Concat(untagged)
                .DistinctBy(t => t.MaskedFilename)
                .ToList();
        }

        private void SetState(bool scanning, bool completed, bool cancelled,
            int total, int analysed, int skipped, int failed, int inFlight = 0)
        {
            var progress = total > 0 ? (double)(analysed + skipped + failed) / total : 0;
            CurrentState = new WaveformScanState(scanning, completed, cancelled,
                total, analysed, skipped, failed, progress, inFlight);
        }
    }
}
