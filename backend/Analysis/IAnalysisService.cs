// <copyright file="IAnalysisService.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    ///     Detection and storage of every per-track audio metric: BPM, musical key, waveform
    ///     band peaks and EBU R128 loudness.
    /// </summary>
    public interface IAnalysisService
    {
        /// <summary>Gets the state of the current or most recent scan.</summary>
        AnalysisScanState ScanState { get; }

        /// <summary>
        ///     Records that a client is actively streaming audio right now. Called from the
        ///     stream endpoint so background analysis (e.g. the auto BPM check on new downloads)
        ///     can wait for playback to go quiet instead of competing with it for CPU/decode.
        /// </summary>
        void RecordPlaybackActivity();

        /// <summary>Returns the analysis status of every audio file in the library.</summary>
        /// <returns>One record per track.</returns>
        IEnumerable<TrackAnalysisInfo> GetAllTracks();

        /// <summary>Starts a background scan. Throws if one is already running.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        Task StartScanAsync(AnalysisScanRequest request);

        /// <summary>Cancels the running scan.</summary>
        /// <returns>True if a scan was cancelled, false if none was running.</returns>
        bool CancelScan();

        /// <summary>
        ///     Returns cached waveform peaks, analysing the file if not yet cached — unless
        ///     <paramref name="cachedOnly"/>, in which case an uncached track simply returns null.
        /// </summary>
        /// <remarks>
        ///     Callers rendering a list must pass <paramref name="cachedOnly"/>. Analysing on
        ///     demand is fine for the one track a player is on, but a virtualised library scrolling
        ///     past thousands of rows would otherwise queue a full decode for every one of them.
        /// </remarks>
        /// <returns>The peaks, or null if not cached (or undecodable).</returns>
        Task<WaveformData> GetWaveformAsync(string path, CancellationToken ct, bool cachedOnly = false);

        /// <summary>
        ///     Returns the cached beat detection results — the grid phase/origin, the raw detected
        ///     beat timestamps, and the downbeat heuristic — a byproduct of BPM detection, so this
        ///     never triggers a decode of its own; it is only ever populated as a side effect of a
        ///     BPM scan.
        /// </summary>
        /// <returns>The beat info; every member is null if BPM has never been detected.</returns>
        BeatAnalysis GetBeatInfo(string path);

        /// <summary>Returns cached loudness, analysing the file if not yet cached.</summary>
        /// <returns>The measurements, or null if the file could not be decoded.</returns>
        Task<LoudnessData> GetLoudnessAsync(string path, CancellationToken ct);

        /// <summary>Sets a track's BPM, writing it to the file's tags.</summary>
        void SetBpm(string maskedFilename, uint bpm);

        /// <summary>Sets a track's musical key, writing it to the file's tags.</summary>
        void SetKey(string maskedFilename, string key);

        /// <summary>Clears a track's BPM tag.</summary>
        void ClearBpm(string maskedFilename);

        /// <summary>Clears a track's key tag.</summary>
        void ClearKey(string maskedFilename);

        /// <summary>
        ///     Resolves a library path to the masked filename the tag-editing members above key on.
        /// </summary>
        /// <param name="path">An absolute or root-relative library path.</param>
        /// <returns>The masked filename, or null if the path is not in the share.</returns>
        string ResolveMaskedFilename(string path);
    }
}
