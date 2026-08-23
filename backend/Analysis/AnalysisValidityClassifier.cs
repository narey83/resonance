// <copyright file="AnalysisValidityClassifier.cs" company="John Narey">
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
    /// <summary>
    ///     Classifies a stored waveform row's trustworthiness from its <see
    ///     cref="WaveformData.WaveformVersion"/> alone — deliberately the only signal it looks at.
    ///     The row's analysed-at timestamp is not used to determine validity: distinguishing
    ///     pre-fix from post-fix waveform data by timestamp alone previously required redecoding
    ///     the source file and byte-comparing stored bars against both the current and a prior
    ///     bucketing algorithm. A version number makes that unnecessary going forward.
    /// </summary>
    public static class AnalysisValidityClassifier
    {
        /// <summary>Classifies one track's waveform row.</summary>
        /// <returns>
        ///     The row's validity. Never triggers or implies reanalysis on its own — callers
        ///     decide what, if anything, to do with the classification.
        /// </returns>
        public static AnalysisValidity Classify(WaveformData? waveform)
        {
            if (waveform == null)
            {
                return AnalysisValidity.Missing;
            }

            if (waveform.WaveformVersion is not { } version)
            {
                return AnalysisValidity.LegacyValid;
            }

            return version >= AudioAnalyzer.CurrentWaveformVersion
                ? AnalysisValidity.Current
                : AnalysisValidity.Stale;
        }
    }
}
