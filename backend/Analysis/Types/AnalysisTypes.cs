// <copyright file="AnalysisTypes.cs" company="John Narey">
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

    /// <summary>
    ///     The individual metrics the analyser can produce. A scan requests any combination;
    ///     they all come from the same single decode of the file.
    /// </summary>
    [Flags]
    public enum AnalysisMetrics
    {
        None = 0,
        Bpm = 1,
        Key = 2,
        Waveform = 4,
        Loudness = 8,
        All = Bpm | Key | Waveform | Loudness,
    }

    /// <summary>Band peaks for the waveform display.</summary>
    public record WaveformData(
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks,
        int NumBars);

    /// <summary>EBU R128 loudness measurements.</summary>
    public record LoudnessData(double IntegratedLufs, double TruePeak, double LoudnessRange);

    /// <summary>
    ///     Everything one pass over a file produced. Any member may be null: a metric that
    ///     was not requested, or one whose detector was unavailable, is simply absent.
    /// </summary>
    public record AnalysisResult(
        uint? Bpm = null,
        double? BpmConfidence = null,
        string Key = null,
        WaveformData Waveform = null,
        LoudnessData Loudness = null);

    /// <summary>State of an in-progress analysis scan.</summary>
    public record AnalysisScanState(
        bool Scanning,
        bool Completed,
        bool Cancelled,
        int Total,
        int Analysed,
        int Skipped,
        int Failed,
        double Progress,
        int InFlight = 0,
        string Metrics = null);

    /// <summary>Per-track analysis status, one row per audio file in the library.</summary>
    public record TrackAnalysisInfo(
        string MaskedFilename,
        string OriginalFilename,
        string Directory,
        string Filename,
        string Extension,
        uint? Bpm,
        string Key,
        bool HasWaveform,
        double? Lufs,
        string Artist,
        string Title,
        string Album)
    {
        public bool HasBpm => Bpm.HasValue && Bpm.Value != 0;

        public bool HasKey => !string.IsNullOrEmpty(Key);

        public bool HasLoudness => Lufs.HasValue;
    }

    /// <summary>Request body for starting an analysis scan.</summary>
    /// <remarks>
    ///     <see cref="OnlyFilenames"/>: null scans the whole library, an empty array scans
    ///     nothing, and a populated array restricts the scan to those files.
    /// </remarks>
    public record AnalysisScanRequest(
        AnalysisMetrics Metrics = AnalysisMetrics.All,
        bool SkipAnalysed = true,
        bool ResetAll = false,
        int Workers = 2,
        string[] OnlyFilenames = null);

    /// <summary>API response shape for waveform data.</summary>
    public record WaveformResponse(
        int NumBars,
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks);

    /// <summary>API response shape for loudness data.</summary>
    public record LoudnessResponse(double IntegratedLufs, double TruePeak, double LoudnessRange);

    /// <summary>Request body for manually setting a track's BPM and/or key.</summary>
    public record SetAnalysisRequest(uint? Bpm = null, string Key = null);
}
