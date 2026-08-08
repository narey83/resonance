// <copyright file="AudioAnalyzer.cs" company="John Narey">
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
    using System.Diagnostics;
    using System.Globalization;
    using System.IO;
    using System.Text.Json;
    using System.Text.RegularExpressions;
    using System.Threading;
    using System.Threading.Tasks;
    using Serilog;

    /// <summary>
    ///     Produces every analysis metric for a file from a single decode.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         One ffmpeg process per file emits raw mono f32 PCM on stdout while an
    ///         <c>asplit</c> branch runs <c>loudnorm</c> over the same stream and prints its EBU
    ///         R128 measurements to stderr. That PCM then feeds both the waveform band DSP below
    ///         and a single Essentia subprocess that returns BPM and key.
    ///     </para>
    ///     <para>
    ///         The previous four services each spawned their own ffmpeg (BPM at 22050, key at
    ///         44100, waveform at 44100, loudness a separate loudnorm pass) and the key path added
    ///         a fifth decode inside Essentia's own MonoLoader. Decoding is the dominant cost of a
    ///         library scan, so collapsing it to one pass is most of the reason this class exists.
    ///     </para>
    /// </remarks>
    public class AudioAnalyzer
    {
        public const int SampleRate = 44100;

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

        // Essentia reads f32 mono PCM from stdin so it reuses our decode rather than running
        // MonoLoader over the file again. Results come back on a sentinel-prefixed line because
        // Essentia's algorithm registry writes its own banner to stdout on import.
        private const string Sentinel = "RESONANCE_JSON:";

        private const string EssentiaScript = """
            import sys, json
            import numpy as np
            import essentia
            essentia.log.infoActive = False
            essentia.log.warningActive = False
            import essentia.standard as es

            SHARP = {'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}
            profile, method, max_secs, want = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]

            raw = sys.stdin.buffer.read()
            audio = np.frombuffer(raw, dtype=np.float32).copy()
            limit = int(max_secs * 44100)
            if limit and len(audio) > limit:
                audio = audio[:limit]

            out = {}
            if len(audio) >= 44100:
                if 'key' in want:
                    try:
                        k, scale, _ = es.KeyExtractor(profileType=profile)(audio)
                        out['key'] = SHARP.get(k, k) + ('m' if scale == 'minor' else '')
                    except Exception as e:
                        out['keyError'] = str(e)
                if 'bpm' in want:
                    try:
                        bpm, _, conf, _, _ = es.RhythmExtractor2013(method=method)(audio)
                        out['bpm'] = float(bpm)
                        out['bpmConfidence'] = float(conf)
                    except Exception as e:
                        out['bpmError'] = str(e)

            sys.stdout.write('RESONANCE_JSON:' + json.dumps(out) + '\n')
            """;

        // The ebur128 summary block, e.g. "    I:          -6.9 LUFS". Anchored per line so
        // "LRA low:" / "LRA high:" / "Threshold:" cannot be mistaken for the wanted values.
        private static readonly Regex IntegratedRegex =
            new(@"^\s*I:\s*(-?[\d.]+)\s*LUFS", RegexOptions.Compiled | RegexOptions.Multiline);

        private static readonly Regex TruePeakRegex =
            new(@"^\s*Peak:\s*(-?[\d.]+)\s*dBFS", RegexOptions.Compiled | RegexOptions.Multiline);

        private static readonly Regex LraRegex =
            new(@"^\s*LRA:\s*(-?[\d.]+)\s*LU", RegexOptions.Compiled | RegexOptions.Multiline);

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

        /// <summary>
        ///     Folds a tempo into the half-open preferred range [minBpm, maxBpm) by repeatedly doubling
        ///     or halving, correcting half-/double-time octave errors. Folding is disabled (returns the
        ///     input unchanged) when the range is invalid (minBpm &lt;= 0 or maxBpm &lt; 2*minBpm), since a
        ///     window narrower than one octave cannot fold unambiguously. Exposed for testing.
        /// </summary>
        /// <returns>The octave-folded tempo.</returns>
        public static double FoldOctave(double bpm, double minBpm, double maxBpm)
        {
            if (bpm <= 0 || minBpm <= 0 || maxBpm < minBpm * 2)
            {
                return bpm;
            }

            while (bpm < minBpm)
            {
                bpm *= 2;
            }

            while (bpm >= maxBpm)
            {
                bpm /= 2;
            }

            return bpm;
        }

        /// <summary>
        ///     Writes the first <paramref name="sampleCount"/> samples of <paramref name="pcm"/> to
        ///     <paramref name="destination"/> as little-endian f32, in chunks.
        /// </summary>
        /// <remarks>
        ///     Chunked rather than one array because AnalysisSeconds can be configured up to an
        ///     hour, which would otherwise mean a ~600MB contiguous allocation per worker just to
        ///     hand the samples over. Exposed for testing.
        /// </remarks>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public static async Task WritePcmAsync(
            Stream destination, float[] pcm, int sampleCount, CancellationToken ct = default)
        {
            var chunk = new byte[64 * 1024];
            for (var offset = 0; offset < sampleCount;)
            {
                var samples = Math.Min(chunk.Length / 4, sampleCount - offset);
                Buffer.BlockCopy(pcm, offset * 4, chunk, 0, samples * 4);
                await destination.WriteAsync(chunk.AsMemory(0, samples * 4), ct);
                offset += samples;
            }

            await destination.FlushAsync(ct);
        }

        // ── Loudness ──────────────────────────────────────────────────────────

        /// <summary>Reads the three R128 values out of an ebur128 summary. Exposed for testing.</summary>
        /// <returns>The measurements, or null if the summary is absent or incomplete.</returns>
        public static LoudnessData ParseLoudness(string? stderr)
        {
            if (string.IsNullOrEmpty(stderr))
            {
                return null;
            }

            var i = IntegratedRegex.Match(stderr);
            var tp = TruePeakRegex.Match(stderr);
            var lra = LraRegex.Match(stderr);

            if (!i.Success || !tp.Success || !lra.Success)
            {
                return null;
            }

            return new LoudnessData(
                double.Parse(i.Groups[1].Value, CultureInfo.InvariantCulture),
                double.Parse(tp.Groups[1].Value, CultureInfo.InvariantCulture),
                double.Parse(lra.Groups[1].Value, CultureInfo.InvariantCulture));
        }

        /// <summary>
        ///     Runs every requested metric over a single decode of <paramref name="filePath"/>.
        /// </summary>
        /// <returns>The metrics that could be produced, or null if the file could not be decoded.</returns>
        public async Task<AnalysisResult> AnalyseAsync(
            string filePath,
            string ffmpegPath,
            AnalysisMetrics metrics,
            resonance.Options.AnalysisOptions options,
            CancellationToken ct)
        {
            var wantPcm = metrics.HasFlag(AnalysisMetrics.Waveform)
                || metrics.HasFlag(AnalysisMetrics.Bpm)
                || metrics.HasFlag(AnalysisMetrics.Key);
            var wantLoudness = metrics.HasFlag(AnalysisMetrics.Loudness);

            if (!wantPcm && !wantLoudness)
            {
                return new AnalysisResult();
            }

            // A full decode is only required by waveform and loudness; a BPM/key-only pass can
            // stop at the window those two actually examine.
            var decodeSeconds = metrics.HasFlag(AnalysisMetrics.Waveform) ? 0 : options.AnalysisSeconds;

            var (pcm, stderr) = await DecodeAsync(filePath, ffmpegPath, wantPcm, wantLoudness, decodeSeconds, ct);

            if (wantPcm && pcm == null)
            {
                return null;
            }

            var loudness = wantLoudness ? ParseLoudness(stderr) : null;

            WaveformData waveform = null;
            if (metrics.HasFlag(AnalysisMetrics.Waveform))
            {
                waveform = ComputeBands(pcm, SampleRate, BarsForDuration(pcm.Length, SampleRate));
            }

            uint? bpm = null;
            double? bpmConfidence = null;
            string key = null;
            if (metrics.HasFlag(AnalysisMetrics.Bpm) || metrics.HasFlag(AnalysisMetrics.Key))
            {
                var want = (metrics.HasFlag(AnalysisMetrics.Bpm) ? "bpm," : string.Empty)
                    + (metrics.HasFlag(AnalysisMetrics.Key) ? "key" : string.Empty);
                var essentia = await RunEssentiaAsync(pcm, want, options, ct);
                if (essentia != null)
                {
                    if (essentia.Value.TryGetProperty("bpm", out var b))
                    {
                        var folded = FoldOctave(b.GetDouble(), options.MinBpm, options.MaxBpm);
                        bpm = (uint)Math.Round(folded);
                    }

                    if (essentia.Value.TryGetProperty("bpmConfidence", out var c))
                    {
                        bpmConfidence = c.GetDouble();
                    }

                    if (essentia.Value.TryGetProperty("key", out var k))
                    {
                        key = k.GetString();
                    }

                    // The Python side catches its own exceptions per-metric (bpmError/keyError)
                    // rather than crashing the whole call, so a real detection failure otherwise
                    // surfaces as nothing more than a silently-missing value on this side.
                    var missingBpm = metrics.HasFlag(AnalysisMetrics.Bpm) && !bpm.HasValue;
                    var missingKey = metrics.HasFlag(AnalysisMetrics.Key) && key == null;
                    if (missingBpm || missingKey)
                    {
                        Log.Warning("Essentia produced no {Missing} for '{File}': {Raw}",
                            missingBpm && missingKey ? "bpm/key" : missingBpm ? "bpm" : "key",
                            filePath, essentia.Value.GetRawText());
                    }
                }
            }

            return new AnalysisResult(bpm, bpmConfidence, key, waveform, loudness);
        }

        // ── Decode ────────────────────────────────────────────────────────────

        // ebur128 rather than loudnorm: both report the same three R128 numbers, but loudnorm
        // measured a 6-minute track in ~64s against ebur128's ~9s (the rest of an 80s pass being
        // the decode itself). loudnorm is a normalisation filter whose measurement pass does far
        // more work than the meter actually wanted here.
        private static string BuildArguments(string filePath, bool wantPcm, bool wantLoudness, double seconds)
        {
            // ebur128 reports on stderr, so it must not run at -loglevel quiet.
            if (wantPcm && wantLoudness)
            {
                return $"-hide_banner -nostats -i \"{filePath}\" -vn " +
                    "-filter_complex \"[0:a]asplit=2[w][l];[l]ebur128=peak=true[lo]\" " +
                    $"-map \"[w]\" -c:a pcm_f32le -ar {SampleRate} -ac 1 -f f32le pipe:1 " +
                    "-map \"[lo]\" -f null -";
            }

            if (wantPcm)
            {
                // Only BPM and key were asked for, and they read at most AnalysisSeconds — so
                // decode that much rather than the whole file. Waveform and loudness are the
                // only metrics that need every sample, and both took the branch above.
                var limit = seconds > 0 ? $"-t {seconds.ToString(CultureInfo.InvariantCulture)} " : string.Empty;
                return $"-loglevel quiet -i \"{filePath}\" -vn -c:a pcm_f32le -ar {SampleRate} -ac 1 {limit}-f f32le pipe:1";
            }

            return $"-hide_banner -nostats -i \"{filePath}\" -af ebur128=peak=true -f null -";
        }

        private static async Task<(float[] Pcm, string Stderr)> DecodeAsync(
            string filePath, string ffmpegBinary, bool wantPcm, bool wantLoudness, double seconds, CancellationToken ct)
        {
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegBinary,
                Arguments = BuildArguments(filePath, wantPcm, wantLoudness, seconds),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);
            using var proc = new Process { StartInfo = psi };
            proc.Start();

            using var ms = new MemoryStream();

            // Both pipes must be drained concurrently; either one filling would block ffmpeg
            // and deadlock the other.
            var stdoutTask = proc.StandardOutput.BaseStream.CopyToAsync(ms, linked.Token);
            var stderrTask = proc.StandardError.ReadToEndAsync(linked.Token);

            string stderr;
            try
            {
                await stdoutTask;
                stderr = await stderrTask;
                await proc.WaitForExitAsync(linked.Token);
            }
            catch (OperationCanceledException)
            {
                try
                {
                    proc.Kill(entireProcessTree: true);
                }
                catch
                { /* already gone */
                }

                return (null, null);
            }

            if (!wantPcm)
            {
                return (null, stderr);
            }

            var bytes = ms.ToArray();
            if (bytes.Length < 4 * SampleRate)
            {
                return (null, stderr); // need at least 1s of audio
            }

            var samples = new float[bytes.Length / 4];
            Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            return (samples, stderr);
        }

        // ── Waveform bands ────────────────────────────────────────────────────
        private static int BarsForDuration(int sampleCount, int sampleRate) =>
            Math.Clamp((int)Math.Round((double)sampleCount / sampleRate * BarsPerSecond), MinBars, MaxBars);

        private static WaveformData ComputeBands(float[] monoData, int sampleRate, int numBars)
        {
            // Peak, not RMS — RMS smooths a kick's brief transient into the
            // surrounding envelope, so it barely reads as louder than a sustained
            // passage. Peak amplitude is what actually makes a kick the tallest
            // thing on a DJ-style waveform (Serato/rekordbox render this way too).
            var overallPeaks = ComputePeaks(monoData, numBars);

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

        // Proportional (float) bucket bounds rather than a fixed integer stride —
        // an integer stride (data.Length / numBars, truncated) undercounts every
        // bar by its rounding remainder, and that undercount compounds bar over
        // bar. For a typical track this drifts the bar-to-audio-time mapping by
        // hundreds of milliseconds by mid-track, which shows up as the waveform's
        // transients (kicks, hits) visibly lagging where they actually play.
        private static (int Start, int End) BarBounds(int barIndex, int numBars, int length)
        {
            var start = (int)((double)barIndex / numBars * length);
            var end = Math.Max(start + 1, (int)((double)(barIndex + 1) / numBars * length));
            return (start, Math.Min(end, length));
        }

        private static float[] ComputePeaks(float[] data, int numBars)
        {
            var peaks = new float[numBars];
            for (var b = 0; b < numBars; b++)
            {
                var (start, end) = BarBounds(b, numBars, data.Length);
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

        // ── Essentia (BPM + key) ──────────────────────────────────────────────
        private async Task<JsonElement?> RunEssentiaAsync(
            float[] pcm, string want, resonance.Options.AnalysisOptions options, CancellationToken ct)
        {
            var seconds = options.AnalysisSeconds.ToString(CultureInfo.InvariantCulture);
            var psi = new ProcessStartInfo
            {
                FileName = options.EssentiaPython,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            psi.ArgumentList.Add("-c");
            psi.ArgumentList.Add(EssentiaScript);
            psi.ArgumentList.Add(options.EssentiaProfile);
            psi.ArgumentList.Add(options.BpmMethod);
            psi.ArgumentList.Add(seconds);
            psi.ArgumentList.Add(want);

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromMinutes(10));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

            using var proc = new Process { StartInfo = psi };
            try
            {
                proc.Start();
            }
            catch (Exception ex)
            {
                Log.Warning("Essentia is unavailable at '{Python}' — BPM and key will be skipped: {Error}",
                    options.EssentiaPython, ex.Message);
                return null;
            }

            // Only the leading AnalysisSeconds are needed; sending the whole track would
            // move tens of megabytes through the pipe for samples Essentia discards anyway.
            var limit = (int)Math.Min(pcm.Length, (long)(options.AnalysisSeconds * SampleRate));

            var stdoutTask = proc.StandardOutput.ReadToEndAsync(linked.Token);
            var stderrTask = proc.StandardError.ReadToEndAsync(linked.Token);

            try
            {
                await WritePcmAsync(proc.StandardInput.BaseStream, pcm, limit, linked.Token);
                proc.StandardInput.Close();

                var stdout = await stdoutTask;
                var stderr = await stderrTask;
                await proc.WaitForExitAsync(linked.Token);

                foreach (var line in stdout.Split('\n'))
                {
                    if (line.StartsWith(Sentinel, StringComparison.Ordinal))
                    {
                        using var doc = JsonDocument.Parse(line[Sentinel.Length..]);
                        return doc.RootElement.Clone();
                    }
                }

                Log.Warning("Essentia returned no result: {Error}", stderr.Trim());
                return null;
            }
            catch (OperationCanceledException)
            {
                try
                {
                    proc.Kill(entireProcessTree: true);
                }
                catch
                { /* already gone */
                }

                throw;
            }
            catch (IOException)
            {
                // Essentia died before consuming the PCM; its stderr explains why.
                Log.Warning("Essentia exited early: {Error}", (await stderrTask).Trim());
                return null;
            }
        }
    }
}
