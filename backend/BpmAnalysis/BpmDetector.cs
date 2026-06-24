// <copyright file="BpmDetector.cs" company="John Narey">
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

namespace resonance.BpmAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Numerics;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    ///     Detects the BPM of an audio file using the Queen Mary TempoTrackV2 algorithm
    ///     (as used by Mixxx). The pipeline is: complex spectral difference onset detection →
    ///     zero-phase Butterworth filter → resonating comb filter with Rayleigh weighting →
    ///     Viterbi decoding to find the most likely beat period path.
    /// </summary>
    public static class BpmDetector
    {
        // Audio parameters: same time resolution as Mixxx @ 44100 Hz (512 frames / 11.6 ms per step)
        private const int SampleRate = 22050;
        private const int StepSize = 256;       // floor(22050 * 0.01161) — ~11.6 ms per onset frame
        private const int WindowSize = 512;     // nextPowerOfTwo(22050 / 50)
        private const int AnalysisSeconds = 90;

        // TempoTrackV2 constants (matching Mixxx/qm-dsp)
        private const double InputTempo = 120.0; // Rayleigh weighting centre BPM
        private const int WvLen = 128;           // number of beat-period candidates (in onset frames)
        private const int WinLen = 512;          // onset frames per tempo-estimation window
        private const int TempoStep = 128;       // onset frames hop between windows
        private const int NumCombElements = 4;   // comb filter teeth
        private const double Eps = 0.0000008;

        /// <summary>Reads the BPM tag from the file. Returns null if absent or zero.</summary>
        /// <returns></returns>
        public static uint? ReadBpmFromTags(string filePath)
        {
            try
            {
                using var file = TagLib.File.Create(filePath, TagLib.ReadStyle.Average);
                var bpm = file.Tag.BeatsPerMinute;
                return bpm == 0 ? null : bpm;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        ///     Detects BPM from audio using the Queen Mary TempoTrackV2 algorithm.
        ///     Analyses the first <see cref="AnalysisSeconds"/> seconds of the file.
        ///     Requires ffmpeg to be available.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public static async Task<uint?> DetectBpmFromAudioAsync(
            string filePath,
            string ffmpegBinary = "ffmpeg",
            CancellationToken cancellationToken = default,
            double minBpm = 88,
            double maxBpm = 176)
        {
            var samples = await DecodePcmAsync(filePath, ffmpegBinary, cancellationToken);
            if (samples == null || samples.Length < WindowSize * 4)
            {
                return null;
            }

            var df = ComputeComplexSpectralDifference(samples);
            if (df == null || df.Length < WinLen + TempoStep)
            {
                return null;
            }

            return EstimateBpm(df, minBpm, maxBpm);
        }

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

        // ── PCM decoding via ffmpeg ───────────────────────────────────────────
        private static async Task<float[]> DecodePcmAsync(
            string filePath, string ffmpegBinary, CancellationToken cancellationToken)
        {
            var maxSamples = SampleRate * AnalysisSeconds;
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegBinary,
                Arguments = $"-loglevel quiet -i \"{filePath}\" -vn -acodec pcm_f32le -ar {SampleRate} -ac 1 -f f32le -t {AnalysisSeconds} pipe:1",
                RedirectStandardOutput = true,
                RedirectStandardError = false,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(AnalysisSeconds + 15));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            using var proc = new Process { StartInfo = psi };
            proc.Start();

            using var ms = new MemoryStream(maxSamples * 4);
            try
            {
                await proc.StandardOutput.BaseStream.CopyToAsync(ms, linkedCts.Token);
                await proc.WaitForExitAsync(linkedCts.Token);
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
            if (bytes.Length < WindowSize * 4 * 4)
            {
                return null;
            }

            var sampleCount = bytes.Length / 4;
            var samples = new float[sampleCount];
            Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            return samples;
        }

        // ── Complex Spectral Difference (DF_COMPLEXSD) ───────────────────────
        // Tracks both magnitude and phase deviation, giving a more accurate onset
        // signal than spectral flux (magnitude-only).
        private static double[] ComputeComplexSpectralDifference(float[] samples)
        {
            var numFrames = ((samples.Length - WindowSize) / StepSize) + 1;
            if (numFrames < 3)
            {
                return null;
            }

            var hannWindow = MakeHannWindow(WindowSize);
            var halfLen = (WindowSize / 2) + 1;

            var magHistory = new double[halfLen];
            var phaseHistory = new double[halfLen];
            var phaseHistoryOld = new double[halfLen];

            var df = new double[numFrames];
            var frame = new Complex[WindowSize];

            for (var i = 0; i < numFrames; i++)
            {
                var offset = i * StepSize;

                for (var j = 0; j < WindowSize; j++)
                {
                    var s = (offset + j < samples.Length) ? samples[offset + j] : 0f;
                    frame[j] = new Complex(s * hannWindow[j], 0);
                }

                Fft(frame);

                var val = 0.0;
                for (var k = 0; k < halfLen; k++)
                {
                    var mag = frame[k].Magnitude;
                    var phase = frame[k].Phase; // raw atan2 — no unwrapping needed for complexSD

                    // Second-order phase difference predicts the expected phase advance
                    var dev = Princarg(phase - (2.0 * phaseHistory[k]) + phaseHistoryOld[k]);

                    // Distance between predicted and actual spectral frame
                    var re = magHistory[k] - (mag * Math.Cos(dev));
                    var im = -mag * Math.Sin(dev);
                    val += Math.Sqrt((re * re) + (im * im));

                    phaseHistoryOld[k] = phaseHistory[k];
                    phaseHistory[k] = phase;
                    magHistory[k] = mag;
                }

                df[i] = val;
            }

            // Skip the first 2 frames — they contain spurious onset energy from cold start
            return df[2..];
        }

        // ── BPM estimation (TempoTrackV2::calculateBeatPeriod + Viterbi) ─────
        private static uint? EstimateBpm(double[] df, double minBpm, double maxBpm)
        {
            // Zero-phase Butterworth LP filter smooths high-frequency noise in the DF
            FilterDf(df);

            // Rayleigh weighting biases the comb filter toward InputTempo (120 BPM)
            var rayparam = (60.0 * SampleRate / StepSize) / InputTempo;
            var wv = new double[WvLen];
            for (var i = 0; i < WvLen; i++)
            {
                wv[i] = (i / (rayparam * rayparam)) * Math.Exp(-(double)(i * i) / (2.0 * rayparam * rayparam));
            }

            // Build RCF matrix — one observation vector per tempo-estimation window
            var rcfmat = new List<double[]>();
            for (var i = 0; i + WinLen < df.Length; i += TempoStep)
            {
                rcfmat.Add(GetRcf(df[i..(i + WinLen)], wv));
            }

            if (rcfmat.Count < 2)
            {
                return null;
            }

            // Viterbi decoding: find the smoothest beat-period path through the RCF matrix
            var bestPath = ViterbiDecode(rcfmat, wv);
            if (bestPath == null || bestPath.Length == 0)
            {
                return null;
            }

            // Convert beat periods (in onset-frame units) to BPM, fold each into the preferred
            // octave (so consistent half-/double-time paths collapse to one band), then take the median
            var tempi = new List<double>(bestPath.Length);
            foreach (var bp in bestPath)
            {
                if (bp > 0)
                {
                    tempi.Add(FoldOctave((60.0 * SampleRate / StepSize) / bp, minBpm, maxBpm));
                }
            }

            if (tempi.Count == 0)
            {
                return null;
            }

            tempi.Sort();
            var medianBpm = tempi[tempi.Count / 2];
            return (uint)Math.Round(medianBpm);
        }

        // ── Zero-phase Butterworth LP filter (TempoTrackV2::filter_df) ───────
        // Coefficients: [b, a] = butter(2, 0.4) — 2nd-order, normalised cutoff 0.4.
        // Applied forward then backward to achieve zero phase shift.
        private static void FilterDf(double[] df)
        {
            const double a1 = -0.3695, a2 = 0.1958;
            const double b0 = 0.2066, b1 = 0.4131, b2 = 0.2066;
            var n = df.Length;
            var buf = new double[n];

            // Forward pass
            double inp1 = 0, inp2 = 0, out1 = 0, out2 = 0;
            for (var i = 0; i < n; i++)
            {
                buf[i] = (b0 * df[i]) + (b1 * inp1) + (b2 * inp2) - (a1 * out1) - (a2 * out2);
                inp2 = inp1;
                inp1 = df[i];
                out2 = out1;
                out1 = buf[i];
            }

            // Reverse then backward pass
            Array.Reverse(buf);
            inp1 = 0;
            inp2 = 0;
            out1 = 0;
            out2 = 0;
            var buf2 = new double[n];
            for (var i = 0; i < n; i++)
            {
                buf2[i] = (b0 * buf[i]) + (b1 * inp1) + (b2 * inp2) - (a1 * out1) - (a2 * out2);
                inp2 = inp1;
                inp1 = buf[i];
                out2 = out1;
                out1 = buf2[i];
            }

            // Reverse back and write result to df
            Array.Reverse(buf2);
            Array.Copy(buf2, df, n);
        }

        // ── Resonating comb filter (TempoTrackV2::get_rcf) ───────────────────
        // For each candidate beat period i, sums the autocorrelation at i, 2i, 3i, 4i
        // (with decreasing weights), creating a resonating response at the true period
        // and its harmonics. The Rayleigh weighting further biases toward 120 BPM.
        private static double[] GetRcf(double[] dfframeIn, double[] wv)
        {
            var dfframe = (double[])dfframeIn.Clone();
            AdaptiveThreshold(dfframe);

            var dfLen = dfframe.Length;
            var rcfLen = wv.Length;

            // Unnormalised autocorrelation
            var acf = new double[dfLen];
            for (var lag = 0; lag < dfLen; lag++)
            {
                var sum = 0.0;
                for (var n = 0; n < dfLen - lag; n++)
                {
                    sum += dfframe[n] * dfframe[n + lag];
                }

                acf[lag] = sum / (dfLen - lag);
            }

            // Comb filter bank: for each candidate period i, sum acf at harmonic multiples
            var rcf = new double[rcfLen];
            for (var i = 2; i < rcfLen; i++)
            {
                for (var a = 1; a <= NumCombElements; a++)
                {
                    for (var b = 1 - a; b <= a - 1; b++)
                    {
                        var idx = (a * i) + b - 1;
                        if (idx < acf.Length)
                        {
                            rcf[i - 1] += (acf[idx] * wv[i - 1]) / ((2.0 * a) - 1);
                        }
                    }
                }
            }

            AdaptiveThreshold(rcf);

            var rcfsum = 0.0;
            for (var i = 0; i < rcfLen; i++)
            {
                rcf[i] += Eps;
                rcfsum += rcf[i];
            }

            for (var i = 0; i < rcfLen; i++)
            {
                rcf[i] /= rcfsum + Eps;
            }

            return rcf;
        }

        // ── Adaptive threshold (MathUtilities::adaptiveThreshold) ────────────
        // Subtracts a local mean (±8/7 frames) then half-wave rectifies.
        private static void AdaptiveThreshold(double[] data)
        {
            const int pPre = 8, pPost = 7;
            var n = data.Length;
            var smoothed = new double[n];
            for (var i = 0; i < n; i++)
            {
                var first = Math.Max(0, i - pPre);
                var last = Math.Min(n - 1, i + pPost);
                var sum = 0.0;
                for (var j = first; j <= last; j++)
                {
                    sum += data[j];
                }

                smoothed[i] = sum / (last - first + 1);
            }

            for (var i = 0; i < n; i++)
            {
                data[i] -= smoothed[i];
                if (data[i] < 0)
                {
                    data[i] = 0;
                }
            }
        }

        // ── Viterbi decoding (TempoTrackV2::viterbi_decode) ──────────────────
        // Finds the most likely beat-period path through the RCF matrix using a
        // Gaussian transition model (sigma=8) that penalises large tempo changes.
        private static int[] ViterbiDecode(List<double[]> rcfmat, double[] wv)
        {
            var q = wv.Length; // number of states
            var t = rcfmat.Count;

            // Transition matrix: Gaussian on diagonal, zero outside edge guard (±20)
            const double sigma = 8.0;
            var tmat = new double[q][];
            for (var i = 0; i < q; i++)
            {
                tmat[i] = new double[q];
                if (i >= 20 && i < q - 20)
                {
                    for (var j = 20; j < q - 20; j++)
                    {
                        tmat[i][j] = Math.Exp(-0.5 * (j - i) * (j - i) / (sigma * sigma));
                    }
                }
            }

            // Viterbi forward pass
            var delta = new double[t][];
            var psi = new int[t][];
            for (var tt = 0; tt < t; tt++)
            {
                delta[tt] = new double[q];
                psi[tt] = new int[q];
            }

            // Initialise first column with Rayleigh prior × observation
            var ds = 0.0;
            for (var j = 0; j < q; j++)
            {
                delta[0][j] = wv[j] * rcfmat[0][j];
                ds += delta[0][j];
            }

            for (var j = 0; j < q; j++)
            {
                delta[0][j] /= ds + Eps;
            }

            for (var tt = 1; tt < t; tt++)
            {
                for (var j = 0; j < q; j++)
                {
                    var maxVal = 0.0;
                    var maxInd = 0;
                    for (var i = 0; i < q; i++)
                    {
                        var v = delta[tt - 1][i] * tmat[j][i];
                        if (v > maxVal)
                        {
                            maxVal = v;
                            maxInd = i;
                        }
                    }

                    delta[tt][j] = maxVal * rcfmat[tt][j];
                    psi[tt][j] = maxInd;
                }

                ds = 0.0;
                for (var j = 0; j < q; j++)
                {
                    ds += delta[tt][j];
                }

                for (var j = 0; j < q; j++)
                {
                    delta[tt][j] /= ds + Eps;
                }
            }

            // Find best final state and backtrack
            var bestpath = new int[t];
            var maxFinal = 0.0;
            for (var j = 0; j < q; j++)
            {
                if (delta[t - 1][j] > maxFinal)
                {
                    maxFinal = delta[t - 1][j];
                    bestpath[t - 1] = j;
                }
            }

            for (var tt = t - 2; tt > 0; tt--)
            {
                bestpath[tt] = psi[tt + 1][bestpath[tt + 1]];
            }

            bestpath[0] = psi[1][bestpath[1]]; // qm-dsp backtracking quirk

            return bestpath;
        }

        // ── Utilities ─────────────────────────────────────────────────────────
        private static double Princarg(double d) =>
            d - (2.0 * Math.PI * Math.Round(d / (2.0 * Math.PI)));

        private static void Fft(Complex[] buf)
        {
            var n = buf.Length;
            for (int i = 1, j = 0; i < n; i++)
            {
                var bit = n >> 1;
                for (; (j & bit) != 0; bit >>= 1)
                {
                    j ^= bit;
                }

                j ^= bit;
                if (i < j)
                {
                    (buf[i], buf[j]) = (buf[j], buf[i]);
                }
            }

            for (var len = 2; len <= n; len <<= 1)
            {
                var ang = -2.0 * Math.PI / len;
                var wLen = new Complex(Math.Cos(ang), Math.Sin(ang));
                for (var i = 0; i < n; i += len)
                {
                    var w = Complex.One;
                    for (var j = 0; j < len / 2; j++)
                    {
                        var u = buf[i + j];
                        var v = buf[i + j + (len / 2)] * w;
                        buf[i + j] = u + v;
                        buf[i + j + (len / 2)] = u - v;
                        w *= wLen;
                    }
                }
            }
        }

        private static double[] MakeHannWindow(int n)
        {
            var w = new double[n];
            for (var i = 0; i < n; i++)
            {
                w[i] = 0.5 * (1.0 - Math.Cos(2.0 * Math.PI * i / (n - 1)));
            }

            return w;
        }
    }
}
