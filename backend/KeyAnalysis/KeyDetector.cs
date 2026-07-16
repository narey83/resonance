// <copyright file="KeyDetector.cs" company="John Narey">
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

namespace resonance.KeyAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;
    using System.Numerics;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    ///     Detects the musical key of an audio file using the Queen Mary GetKeyMode algorithm
    ///     (as used by Mixxx). The pipeline is: IIR decimation → Constant-Q chromagram (36 bins/octave)
    ///     → 10-second HPCP rolling average → Krumhansl-Schmuckler correlation → 10-second median filter.
    /// </summary>
    public static class KeyDetector
    {
        // ── Constants matching Mixxx AnalyzerQueenMaryKey + qm-dsp GetKeyMode ──
        private const int SampleRate = 44100;
        private const int DecimationFactor = 8;
        private const int BinsPerOctave = 36;    // 3 per semitone
        private const double CqThresh = 0.0054;  // sparse kernel threshold
        private const double HpcpAverageSeconds = 10.0;
        private const double MedianAverageSeconds = 10.0;
        private const int MaxAnalysisSeconds = 90;

        // Essentia key detection (run as a Python subprocess). Returns the key in the same
        // sharp notation as the built-in detector (e.g. "Am", "C#"), or null on failure.
        private const string EssentiaScript =
            "import sys\n" +
            "import essentia.standard as es\n" +
            "_S={'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#'}\n" +
            "a=es.MonoLoader(filename=sys.argv[1], sampleRate=44100)()\n" +
            "k,scale,_=es.KeyExtractor(profileType=sys.argv[2])(a)\n" +
            "print(_S.get(k,k)+('m' if scale=='minor' else ''))\n";

        // CQ frequency range: C3 (MIDI 48) to C8 (MIDI 96) at A4 = 440 Hz
        private static readonly double FMin = 440.0 * Math.Pow(2.0, (48 - 69) / 12.0); // ≈ 130.81 Hz
        private static readonly double FMax = 440.0 * Math.Pow(2.0, (96 - 69) / 12.0); // ≈ 4186.0 Hz

        // Q factor and derived CQT parameters (computed from constants above)
        private static readonly double DQ = 1.0 / (Math.Pow(2.0, 1.0 / BinsPerOctave) - 1.0); // ≈ 51.49
        private static readonly double EffectiveFs = SampleRate / (double)DecimationFactor;     // 5512.5 Hz
        private static readonly int FftLength = NextPowerOfTwo((int)Math.Ceiling(DQ * EffectiveFs / FMin)); // 4096
        private static readonly int NumCqBins = BinsPerOctave * (int)Math.Ceiling(Math.Log(FMax / FMin) / Math.Log(2.0)); // 180
        private static readonly int HpcpBufferSize = (int)Math.Ceiling(HpcpAverageSeconds * EffectiveFs / FftLength);     // 14
        private static readonly int MedianWinSize = (int)Math.Ceiling(MedianAverageSeconds * EffectiveFs / FftLength);    // 14

        // QM 36-bin chroma profiles (from GetKeyMode.cpp)
        private static readonly double[] MajProfile =
        {
            0.0384, 0.0629, 0.0258, 0.0121, 0.0146, 0.0106, 0.0364, 0.0610, 0.0267,
            0.0126, 0.0121, 0.0086, 0.0364, 0.0623, 0.0279, 0.0275, 0.0414, 0.0186,
            0.0173, 0.0248, 0.0145, 0.0364, 0.0631, 0.0262, 0.0129, 0.0150, 0.0098,
            0.0312, 0.0521, 0.0235, 0.0129, 0.0142, 0.0095, 0.0289, 0.0478, 0.0239,
        };

        private static readonly double[] MinProfile =
        {
            0.0375, 0.0682, 0.0299, 0.0119, 0.0138, 0.0093, 0.0296, 0.0543, 0.0257,
            0.0292, 0.0519, 0.0246, 0.0159, 0.0234, 0.0135, 0.0291, 0.0544, 0.0248,
            0.0137, 0.0176, 0.0104, 0.0352, 0.0670, 0.0302, 0.0222, 0.0349, 0.0164,
            0.0174, 0.0297, 0.0166, 0.0222, 0.0401, 0.0202, 0.0175, 0.0270, 0.0146,
        };

        // QM key index (1–24) → standard notation. 1=Cmaj … 12=Bmaj, 13=Cmin … 24=Bmin
        private static readonly string[] KeyNames =
        {
            string.Empty,
            "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
            "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
        };

        // IIR anti-aliasing filter for decimation by 8 (from Decimator.cpp)
        private static readonly double[] DecB =
        {
             0.060111378492136, -0.257323420830598,  0.420583503165928, -0.222750785197418,
             -0.222750785197418,  0.420583503165928, -0.257323420830598,  0.060111378492136,
        };

        private static readonly double[] DecA =
        {
            1.0, -5.667654878577432, 14.062452278088417, -19.737303840697738,
            16.889698874608641, -8.796600612325928, 2.577553446979888, -0.326903916815751,
        };

        // Mean-subtracted profiles (matches GetKeyMode constructor)
        private static readonly double[] MajNorm;
        private static readonly double[] MinNorm;

        // Sparse CQ kernel — built once, shared across all analysis calls
        private static readonly Lazy<SparseKernel> CachedKernel = new(BuildSparseKernel);

        static KeyDetector()
        {
            double mMaj = 0, mMin = 0;
            for (var i = 0; i < BinsPerOctave; i++)
            {
                mMaj += MajProfile[i];
                mMin += MinProfile[i];
            }

            mMaj /= BinsPerOctave;
            mMin /= BinsPerOctave;

            MajNorm = new double[BinsPerOctave];
            MinNorm = new double[BinsPerOctave];
            for (var i = 0; i < BinsPerOctave; i++)
            {
                MajNorm[i] = MajProfile[i] - mMaj;
                MinNorm[i] = MinProfile[i] - mMin;
            }
        }

        // ── Warm-up ───────────────────────────────────────────────────────────

        /// <summary>Pre-builds the sparse CQ kernel so the first scan starts without delay.</summary>
        public static void WarmUp() => _ = CachedKernel.Value;

        // ── Tag reading ───────────────────────────────────────────────────────

        /// <summary>Reads the musical key embedded in file tags. Returns null if absent.</summary>
        /// <returns></returns>
        public static string ReadKeyFromTags(string filePath)
        {
            try
            {
                using var file = TagLib.File.Create(filePath, TagLib.ReadStyle.Average);
                if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2)
                {
                    return KeyTagHelper.ReadKey(id3v2);
                }

                if (file.GetTag(TagLib.TagTypes.Xiph) is TagLib.Ogg.XiphComment xiph)
                {
                    var fields = xiph.GetField("INITIALKEY");
                    if (fields.Length > 0 && !string.IsNullOrEmpty(fields[0]))
                    {
                        return fields[0].Trim();
                    }
                }
            }
            catch
            { /* unsupported format or corrupt file */
            }

            return null;
        }

        // ── Audio analysis entry point ────────────────────────────────────────

        /// <summary>Detects the musical key via the Queen Mary CQT chromagram algorithm.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public static async Task<string> DetectKeyFromAudioAsync(
            string filePath,
            string ffmpegBinary = "ffmpeg",
            CancellationToken cancellationToken = default)
        {
            var samples = await DecodePcmAsync(filePath, ffmpegBinary, cancellationToken);
            if (samples == null || samples.Length < FftLength * DecimationFactor)
            {
                return null;
            }

            return DetectKey(samples);
        }

        /// <summary>
        ///     Detects the musical key by invoking Essentia's <c>KeyExtractor</c> via a Python
        ///     subprocess. More accurate than the built-in detector on electronic music; requires a
        ///     Python interpreter with Essentia installed (see <c>KeyAnalysis.EssentiaPython</c>).
        /// </summary>
        /// <returns>The detected key in sharp notation, or null on failure.</returns>
        public static async Task<string> DetectKeyViaEssentiaAsync(
            string filePath,
            string pythonPath,
            string profile,
            CancellationToken cancellationToken = default)
        {
            var psi = new ProcessStartInfo
            {
                FileName = string.IsNullOrWhiteSpace(pythonPath) ? "python3" : pythonPath,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("-c");
            psi.ArgumentList.Add(EssentiaScript);
            psi.ArgumentList.Add(filePath);
            psi.ArgumentList.Add(string.IsNullOrWhiteSpace(profile) ? "edma" : profile);

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            using var proc = new Process { StartInfo = psi };

            try
            {
                proc.Start();
                var stdoutTask = proc.StandardOutput.ReadToEndAsync(linkedCts.Token);
                var stderrTask = proc.StandardError.ReadToEndAsync(linkedCts.Token);
                await proc.WaitForExitAsync(linkedCts.Token);
                var stdout = await stdoutTask;
                _ = await stderrTask; // drained to avoid a full-pipe deadlock

                if (proc.ExitCode != 0)
                {
                    return null;
                }

                var line = stdout
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .LastOrDefault();
                return string.IsNullOrWhiteSpace(line) ? null : line;
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
        }

        // ── PCM decoding ──────────────────────────────────────────────────────
        private static async Task<float[]> DecodePcmAsync(
            string filePath, string ffmpegBinary, CancellationToken cancellationToken)
        {
            var maxSamples = SampleRate * MaxAnalysisSeconds;
            var psi = new ProcessStartInfo
            {
                FileName = ffmpegBinary,
                Arguments = $"-loglevel quiet -i \"{filePath}\" -vn -acodec pcm_f32le -ar {SampleRate} -ac 1 -f f32le -t {MaxAnalysisSeconds} pipe:1",
                RedirectStandardOutput = true,
                RedirectStandardError = false,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(MaxAnalysisSeconds + 15));
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
            if (bytes.Length < FftLength * DecimationFactor * 4)
            {
                return null;
            }

            var sampleCount = bytes.Length / 4;
            var samples = new float[sampleCount];
            Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            return samples;
        }

        // ── Pipeline orchestration ────────────────────────────────────────────
        private static string DetectKey(float[] samples)
        {
            // 1. IIR anti-aliasing filter + downsample by 8
            var decimated = DecimateBy8(samples);
            if (decimated.Length < FftLength)
            {
                return null;
            }

            // 2. Retrieve the cached sparse CQ kernel
            var kernel = CachedKernel.Value;
            var hammingWin = MakeHammingWindow(FftLength);
            var fftBuf = new Complex[FftLength];

            // 3. Chroma frame for each non-overlapping FftLength block
            var chromaFrames = new List<double[]>(decimated.Length / FftLength);
            for (var i = 0; i + FftLength <= decimated.Length; i += FftLength)
            {
                var chroma = ComputeChromaFrame(decimated, i, hammingWin, fftBuf, kernel);
                if (chroma != null)
                {
                    chromaFrames.Add(chroma);
                }
            }

            if (chromaFrames.Count == 0)
            {
                return null;
            }

            // 4. HPCP rolling average → Krumhansl correlation → median filter → mode
            return GetFinalKey(chromaFrames);
        }

        // ── Step 1: IIR decimation (Decimator.cpp, factor 8) ─────────────────
        private static double[] DecimateBy8(float[] samples)
        {
            var blockSize = FftLength * DecimationFactor;
            var numBlocks = samples.Length / blockSize;
            var dst = new double[numBlocks * FftLength];
            var filtered = new double[blockSize];

            double o1 = 0, o2 = 0, o3 = 0, o4 = 0, o5 = 0, o6 = 0, o7 = 0;
            var outIdx = 0;

            for (var b = 0; b < numBlocks; b++)
            {
                var blockStart = b * blockSize;

                // Direct-form II transposed IIR; state carries across blocks
                for (var i = 0; i < blockSize; i++)
                {
                    var inp = (double)samples[blockStart + i];
                    var outp = (inp * DecB[0]) + o1;
                    o1 = (inp * DecB[1]) - (outp * DecA[1]) + o2;
                    o2 = (inp * DecB[2]) - (outp * DecA[2]) + o3;
                    o3 = (inp * DecB[3]) - (outp * DecA[3]) + o4;
                    o4 = (inp * DecB[4]) - (outp * DecA[4]) + o5;
                    o5 = (inp * DecB[5]) - (outp * DecA[5]) + o6;
                    o6 = (inp * DecB[6]) - (outp * DecA[6]) + o7;
                    o7 = (inp * DecB[7]) - (outp * DecA[7]);
                    filtered[i] = outp;
                }

                for (var i = 0; i < blockSize; i += DecimationFactor)
                {
                    dst[outIdx++] = filtered[i];
                }
            }

            return dst;
        }

        private static SparseKernel BuildSparseKernel()
        {
            var squareThresh = CqThresh * CqThresh;
            var fftBins = new List<int>();
            var cqBins = new List<int>();
            var kernelRe = new List<double>();
            var kernelIm = new List<double>();

            var winRe = new double[FftLength];
            var winIm = new double[FftLength];
            var kFft = new Complex[FftLength];

            for (var j = NumCqBins - 1; j >= 0; j--)
            {
                Array.Clear(winRe, 0, FftLength);
                Array.Clear(winIm, 0, FftLength);

                var winLen = (int)Math.Ceiling(DQ * EffectiveFs / (FMin * Math.Pow(2.0, (double)j / BinsPerOctave)));
                var origin = (FftLength / 2) - (winLen / 2);
                var hamming = MakeHammingWindow(winLen);

                for (var i = 0; i < winLen; i++)
                {
                    var idx = origin + i;
                    if (idx < 0 || idx >= FftLength)
                    {
                        continue;
                    }

                    var angle = 2.0 * Math.PI * DQ * i / winLen;
                    winRe[idx] = Math.Cos(angle) * hamming[i] / winLen;
                    winIm[idx] = Math.Sin(angle) * hamming[i] / winLen;
                }

                // fftshift both halves
                for (var i = 0; i < FftLength / 2; i++)
                {
                    (winRe[i], winRe[i + (FftLength / 2)]) = (winRe[i + (FftLength / 2)], winRe[i]);
                    (winIm[i], winIm[i + (FftLength / 2)]) = (winIm[i + (FftLength / 2)], winIm[i]);
                }

                for (var i = 0; i < FftLength; i++)
                {
                    kFft[i] = new Complex(winRe[i], winIm[i]);
                }

                Fft(kFft);

                for (var i = 0; i < FftLength; i++)
                {
                    var re = kFft[i].Real;
                    var im = kFft[i].Imaginary;
                    if ((re * re) + (im * im) <= squareThresh)
                    {
                        continue;
                    }

                    fftBins.Add(i);
                    cqBins.Add(j);
                    kernelRe.Add(re / FftLength);
                    kernelIm.Add(-im / FftLength); // conjugate
                }
            }

            return new SparseKernel([.. fftBins], [.. cqBins], [.. kernelRe], [.. kernelIm]);
        }

        // ── Step 3: One CQT frame → 36-bin chroma (Chromagram::process) ──────
        private static double[] ComputeChromaFrame(
            double[] decimated, int frameStart,
            double[] hammingWin, Complex[] fftBuf, SparseKernel kernel)
        {
            // Apply Hamming window then fftshift
            for (var i = 0; i < FftLength; i++)
            {
                fftBuf[i] = new Complex(decimated[frameStart + i] * hammingWin[i], 0);
            }

            for (var i = 0; i < FftLength / 2; i++)
            {
                (fftBuf[i], fftBuf[i + (FftLength / 2)]) = (fftBuf[i + (FftLength / 2)], fftBuf[i]);
            }

            Fft(fftBuf);

            // Sparse CQ multiply (ConstantQ::process)
            var cqRe = new double[NumCqBins];
            var cqIm = new double[NumCqBins];
            var n = kernel.FftBins.Length;

            for (var i = 0; i < n; i++)
            {
                var col = kernel.FftBins[i];
                if (col == 0)
                {
                    continue;
                }

                var row = kernel.CqBins[i];
                var r1 = kernel.Real[i];
                var i1 = kernel.Imag[i];
                var r2 = fftBuf[FftLength - col].Real;
                var i2 = fftBuf[FftLength - col].Imaginary;
                cqRe[row] += (r1 * r2) - (i1 * i2);
                cqIm[row] += (r1 * i2) + (i1 * r2);
            }

            // Fold octaves into BinsPerOctave-bin chroma (Chromagram::process)
            var chroma = new double[BinsPerOctave];
            var octaves = NumCqBins / BinsPerOctave;
            for (var oct = 0; oct < octaves; oct++)
            {
                var first = oct * BinsPerOctave;
                for (var b = 0; b < BinsPerOctave; b++)
                {
                    var re = cqRe[first + b];
                    var im = cqIm[first + b];
                    chroma[b] += Math.Sqrt((re * re) + (im * im));
                }
            }

            // Normalise to unit max
            var max = 0.0;
            for (var b = 0; b < BinsPerOctave; b++)
            {
                if (chroma[b] > max)
                {
                    max = chroma[b];
                }
            }

            if (max <= 0)
            {
                return null;
            }

            for (var b = 0; b < BinsPerOctave; b++)
            {
                chroma[b] /= max;
            }

            return chroma;
        }

        // ── Step 4: HPCP average → correlation → median filter (GetKeyMode::process) ──
        private static string GetFinalKey(List<double[]> chromaFrames)
        {
            var total = chromaFrames.Count;
            var medianBuf = new int[MedianWinSize];
            var medianFilling = 0;
            var keyCounts = new int[25]; // key indices 1–24

            var meanHpcp = new double[BinsPerOctave];

            for (var frame = 0; frame < total; frame++)
            {
                // Rolling HPCP average over the last HpcpBufferSize frames
                var filling = Math.Min(frame + 1, HpcpBufferSize);
                Array.Clear(meanHpcp, 0, BinsPerOctave);
                for (var f = frame - filling + 1; f <= frame; f++)
                {
                    for (var b = 0; b < BinsPerOctave; b++)
                    {
                        meanHpcp[b] += chromaFrames[f][b];
                    }
                }

                for (var b = 0; b < BinsPerOctave; b++)
                {
                    meanHpcp[b] /= filling;
                }

                // Subtract mean (zero-centre the HPCP)
                var mh = 0.0;
                for (var b = 0; b < BinsPerOctave; b++)
                {
                    mh += meanHpcp[b];
                }

                mh /= BinsPerOctave;
                for (var b = 0; b < BinsPerOctave; b++)
                {
                    meanHpcp[b] -= mh;
                }

                // Krumhansl correlation against all 36 rotations of major and minor profiles
                var bestMaj = double.MinValue;
                var bestMin = double.MinValue;
                var bestMajBin = 0;
                var bestMinBin = 0;

                for (var k = 0; k < BinsPerOctave; k++)
                {
                    var cm = KrumCorr(meanHpcp, MajNorm, k - 2);
                    var cn = KrumCorr(meanHpcp, MinNorm, k - 2);
                    if (cm > bestMaj)
                    {
                        bestMaj = cm;
                        bestMajBin = k;
                    }

                    if (cn > bestMin)
                    {
                        bestMin = cn;
                        bestMinBin = k;
                    }
                }

                var maxBin = bestMaj >= bestMin ? bestMajBin : bestMinBin + BinsPerOctave;
                var key = (maxBin / 3) + 1;

                // Shift median buffer and insert new key
                for (var k = 1; k < MedianWinSize; k++)
                {
                    medianBuf[k - 1] = medianBuf[k];
                }

                medianBuf[MedianWinSize - 1] = key;
                if (medianFilling < MedianWinSize)
                {
                    medianFilling++;
                }

                // Sort last medianFilling entries and pick the median
                var sortBuf = new int[medianFilling];
                for (var k = 0; k < medianFilling; k++)
                {
                    sortBuf[k] = medianBuf[MedianWinSize - medianFilling + k];
                }

                Array.Sort(sortBuf);
                var midpoint = (int)Math.Ceiling(medianFilling / 2.0);
                keyCounts[sortBuf[midpoint - 1]]++;
            }

            // Return the key with the highest count (mode)
            var bestKey = 1;
            for (var i = 2; i <= 24; i++)
            {
                if (keyCounts[i] > keyCounts[bestKey])
                {
                    bestKey = i;
                }
            }

            return bestKey >= 1 && bestKey <= 24 ? KeyNames[bestKey] : null;
        }

        // Krumhansl-Schmuckler correlation (GetKeyMode::krumCorr)
        private static double KrumCorr(double[] data, double[] profile, int shift)
        {
            var num = 0.0;
            var sum1 = 0.0;
            var sum2 = 0.0;
            for (var i = 0; i < BinsPerOctave; i++)
            {
                var k = (((i - shift) % BinsPerOctave) + BinsPerOctave) % BinsPerOctave;
                num += data[i] * profile[k];
                sum1 += data[i] * data[i];
                sum2 += profile[k] * profile[k];
            }

            var den = Math.Sqrt(sum1 * sum2);
            return den > 0 ? num / den : 0.0;
        }

        // ── Utilities ─────────────────────────────────────────────────────────
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

        private static double[] MakeHammingWindow(int n)
        {
            var w = new double[n];
            for (var i = 0; i < n; i++)
            {
                w[i] = 0.54 - (0.46 * Math.Cos(2.0 * Math.PI * i / Math.Max(n - 1, 1)));
            }

            return w;
        }

        private static int NextPowerOfTwo(int n)
        {
            var p = 1;
            while (p < n)
            {
                p <<= 1;
            }

            return p;
        }

        // ── Step 2: Sparse CQ kernel (ConstantQ::sparsekernel) ───────────────
        private sealed class SparseKernel(int[] fftBins, int[] cqBins, double[] real, double[] imag)
        {
            public int[] FftBins { get; } = fftBins;

            public int[] CqBins { get; } = cqBins;

            public double[] Real { get; } = real;

            public double[] Imag { get; } = imag;
        }
    }
}
