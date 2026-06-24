// <copyright file="IBpmAnalysisService.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Threading.Tasks;

    public interface IBpmAnalysisService
    {
        /// <summary>Gets the current scan state.</summary>
        BpmScanState ScanState { get; }

        /// <summary>Returns BPM status for all local audio files.</summary>
        /// <returns></returns>
        IEnumerable<TrackBpmInfo> GetAllTracksWithBpmStatus();

        /// <summary>Starts a background BPM analysis scan.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        Task StartScanAsync(BpmScanRequest request);

        /// <summary>Cancels any running scan.</summary>
        /// <returns></returns>
        bool CancelScan();

        /// <summary>Sets the BPM for a specific track, writing to both the physical file and the database.</summary>
        void SetBpm(string maskedFilename, uint bpm);

        /// <summary>Clears the BPM for a specific track, removing it from both the physical file and the database.</summary>
        void ClearBpm(string maskedFilename);
    }
}
