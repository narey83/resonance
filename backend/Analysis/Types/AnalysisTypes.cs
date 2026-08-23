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
    using System.Collections.Generic;

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
    /// <param name="OverallPeaks">The overall (unfiltered) peak per bar.</param>
    /// <param name="LowPeaks">The bass-band peak per bar.</param>
    /// <param name="MidPeaks">The mid-band peak per bar.</param>
    /// <param name="HighPeaks">The high-band peak per bar.</param>
    /// <param name="NumBars">How many bars each peaks array holds.</param>
    /// <param name="DurationSeconds">
    ///     The duration of the decoded PCM the bars were generated from — <c>pcm.Length /
    ///     AudioAnalyzer.SampleRate</c>, in seconds. This is the timebase the bars are laid out
    ///     against, which is not necessarily what any given player's media element reports (a
    ///     streamed, variable-bitrate file's <c>HTMLAudioElement.duration</c> can be revised by the
    ///     browser mid-playback as more of the file downloads — see the frontend's
    ///     <c>resolveWaveformDuration</c>). Null only for a legacy row analysed before this field
    ///     existed and never rescanned since; <see cref="AnalysisStore.GetWaveform"/> backfills a
    ///     close estimate for those from <see cref="NumBars"/> rather than leaving it unusable.
    /// </param>
    public record WaveformData(
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks,
        int NumBars,
        double? DurationSeconds = null);

    /// <summary>EBU R128 loudness measurements.</summary>
    public record LoudnessData(double IntegratedLufs, double TruePeak, double LoudnessRange);

    /// <summary>
    ///     Everything the beat detector produced for a track, read as one bundle since it all
    ///     comes from the same cached row: the theoretical grid's anchor, the raw detections, and
    ///     the downbeat heuristic's best guess. See <see cref="AnalysisResult"/> for what each
    ///     member means and where it comes from.
    /// </summary>
    public record BeatAnalysis(
        double? BeatOffsetSeconds,
        float[] Beats,
        double? DownbeatOffsetSeconds,
        double? DownbeatConfidence);

    /// <summary>
    ///     One detected beat measured against where the theoretical grid (bpm + beat offset)
    ///     expected it. Diagnostic only — see <see cref="AudioAnalyzer.CompareBeatsToGrid"/>.
    /// </summary>
    public record BeatComparison(double Detected, double Expected, double ErrorSeconds, int ExpectedIndex, int IndexGap);

    /// <summary>
    ///     Aggregate view of <see cref="BeatComparison"/> across every detected beat: how tightly
    ///     the detector tracks the theoretical grid, and how often it appears to have skipped or
    ///     doubled a beat.
    /// </summary>
    public record BeatComparisonSummary(
        int Count,
        double MeanAbsErrorSeconds,
        double MaxAbsErrorSeconds,
        int SkippedBeats,
        int ExtraBeats,
        IReadOnlyList<BeatComparison> Comparisons);

    /// <summary>
    ///     Everything one pass over a file produced. Any member may be null: a metric that
    ///     was not requested, or one whose detector was unavailable, is simply absent.
    /// </summary>
    /// <param name="Bpm">The detected (octave-folded) tempo.</param>
    /// <param name="BpmConfidence">Essentia's confidence in <paramref name="Bpm"/>.</param>
    /// <param name="Key">The detected musical key.</param>
    /// <param name="Waveform">The waveform band peaks.</param>
    /// <param name="Loudness">The EBU R128 loudness measurements.</param>
    /// <param name="BeatOffsetSeconds">
    ///     The first detected beat, in seconds from the start of the track — the beat grid's
    ///     phase/origin. Distinct from BPM (the interval between beats): a track with a silent
    ///     or non-rhythmic intro has this greater than zero even when the tempo is exact, and a
    ///     grid anchored at 0:00 instead of this value is offset by a constant amount for the
    ///     whole track.
    /// </param>
    /// <param name="Beats">
    ///     Every beat Essentia actually detected, in seconds — distinct from the theoretical
    ///     grid <see cref="BeatOffsetSeconds"/> and <see cref="Bpm"/> imply. Kept independently
    ///     so the two can be compared/displayed separately rather than one standing in for
    ///     the other.
    /// </param>
    /// <param name="DownbeatOffsetSeconds">
    ///     The first beat of the detected downbeat phase, in seconds — a heuristic (average
    ///     per-beat energy grouped by position in a 4-beat cycle), not a dedicated detector; see
    ///     <see cref="DownbeatConfidence"/>.
    /// </param>
    /// <param name="DownbeatConfidence">
    ///     How much louder the winning downbeat phase was than the runner-up, in [0, 1]. Low by
    ///     construction on four-on-the-floor material, where every beat carries similar energy —
    ///     a low value means "no real signal to anchor a bar grid on", not detector error.
    /// </param>
    public record AnalysisResult(
        uint? Bpm = null,
        double? BpmConfidence = null,
        string Key = null,
        WaveformData Waveform = null,
        LoudnessData Loudness = null,
        double? BeatOffsetSeconds = null,
        float[] Beats = null,
        double? DownbeatOffsetSeconds = null,
        double? DownbeatConfidence = null);

    /// <summary>
    ///     State of an in-progress analysis scan.
    /// </summary>
    /// <remarks>
    ///     <see cref="InFlightPaths"/> holds the absolute library paths being decoded right now — the
    ///     same form <c>MusicTrack.Path</c> uses — so a client can mark the exact rows in progress by
    ///     comparing against what the library list already gave it, with nothing to resolve first.
    /// </remarks>
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
        string Metrics = null,
        IReadOnlyList<string> InFlightPaths = null);

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
    /// <param name="Metrics">Which metrics to produce.</param>
    /// <param name="SkipAnalysed">Skip a track's metrics that are already present.</param>
    /// <param name="ResetAll">Clear existing results for the selection before scanning.</param>
    /// <param name="OnlyFilenames">Restricts the scan to these masked filenames; null scans everything.</param>
    /// <param name="AllowBpmFabrication">
    ///     Whether a track with no BPM tag at all should have one computed and written. True for
    ///     every human-requested scan (someone asking to fill in blanks is the point). The
    ///     automatic post-download check sets this false — a blank BPM is often correct (ambient,
    ///     spoken word), not something to fabricate a value for.
    /// </param>
    /// <param name="OnlyPaths">
    ///     The same restriction as <see cref="OnlyFilenames"/>, expressed as library paths and
    ///     resolved to masked filenames server-side. Clients reading the paged library query only
    ///     ever see paths; making each of them resolve names first would be a round-trip per row.
    ///     Merged with <see cref="OnlyFilenames"/> when both are given.
    /// </param>
    public record AnalysisScanRequest(
        AnalysisMetrics Metrics = AnalysisMetrics.All,
        bool SkipAnalysed = true,
        bool ResetAll = false,
        string[] OnlyFilenames = null,
        bool AllowBpmFabrication = true,
        string[] OnlyPaths = null);

    /// <summary>API response shape for waveform data.</summary>
    /// <param name="NumBars">How many bars each peaks array holds.</param>
    /// <param name="OverallPeaks">The overall (unfiltered) peak per bar.</param>
    /// <param name="LowPeaks">The bass-band peak per bar.</param>
    /// <param name="MidPeaks">The mid-band peak per bar.</param>
    /// <param name="HighPeaks">The high-band peak per bar.</param>
    /// <param name="BeatOffsetSeconds">
    ///     The first detected beat, in seconds from track start — null if BPM has never been
    ///     detected for this track (only its tag is known) or detection produced no ticks.
    /// </param>
    /// <param name="Beats">
    ///     Every beat Essentia actually detected, in seconds — the raw detections, as distinct
    ///     from the theoretical grid <see cref="BeatOffsetSeconds"/>/bpm imply. Null under the
    ///     same conditions as <see cref="BeatOffsetSeconds"/>.
    /// </param>
    /// <param name="DownbeatOffsetSeconds">
    ///     The first beat of the heuristically-detected downbeat phase, in seconds — see
    ///     <see cref="AnalysisResult.DownbeatOffsetSeconds"/>. Null if too few beats were
    ///     detected to attempt the heuristic.
    /// </param>
    /// <param name="DownbeatConfidence">See <see cref="AnalysisResult.DownbeatConfidence"/>.</param>
    /// <param name="AnalysisDuration">See <see cref="WaveformData.DurationSeconds"/>.</param>
    public record WaveformResponse(
        int NumBars,
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks,
        double? BeatOffsetSeconds = null,
        float[] Beats = null,
        double? DownbeatOffsetSeconds = null,
        double? DownbeatConfidence = null,
        double? AnalysisDuration = null);

    /// <summary>API response shape for loudness data.</summary>
    public record LoudnessResponse(double IntegratedLufs, double TruePeak, double LoudnessRange);

    /// <summary>Request body for manually setting a track's BPM and/or key.</summary>
    public record SetAnalysisRequest(uint? Bpm = null, string Key = null);

    /// <summary>API response shape for a resolved masked filename.</summary>
    public record MaskedFilenameResponse(string MaskedFilename);
}
