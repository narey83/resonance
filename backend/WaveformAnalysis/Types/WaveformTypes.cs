// <copyright file="WaveformTypes.cs" company="John Narey">
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
    /// <summary>Pre-computed waveform band peaks for a single track.</summary>
    public record WaveformData(
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks,
        int NumBars);

    /// <summary>State of an in-progress waveform scan.</summary>
    public record WaveformScanState(
        bool Scanning,
        bool Completed,
        bool Cancelled,
        int Total,
        int Analysed,
        int Skipped,
        int Failed,
        double Progress,
        int InFlight = 0);

    /// <summary>Request body for starting a waveform scan.</summary>
    public record WaveformScanRequest(
        bool SkipAnalysed = true,
        bool ResetAll = false,
        int Workers = 2);

    /// <summary>API response shape for waveform data.</summary>
    public record WaveformResponse(
        int NumBars,
        float[] OverallPeaks,
        float[] LowPeaks,
        float[] MidPeaks,
        float[] HighPeaks);
}
