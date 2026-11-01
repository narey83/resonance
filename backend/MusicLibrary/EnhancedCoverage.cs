// <copyright file="EnhancedCoverage.cs" company="John Narey">
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

namespace resonance.MusicLibrary
{
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;

    // Count compact, content-guarded DB summaries. Dashboard reads never open
    // source audio or candidate report files, or transfer full results to clients.
    internal static class EnhancedCoverage
    {
        private static readonly string[] Features = { "beats", "downbeats", "vocals", "stems", "sections", "phrases", "genre", "energy", "cues", "loops", "similarity" };

        internal static EnhancedAnalysisStats Count(IEnumerable<string> summaries)
        {
            var counts = Features.ToDictionary(feature => feature, _ => 0);
            var saved = 0;
            var complete = 0;
            var unindexed = 0;
            foreach (var summary in summaries)
            {
                saved++;
                try
                {
                    using var document = JsonDocument.Parse(summary);
                    var root = document.RootElement;
                    if (root.ValueKind != JsonValueKind.Object)
                    {
                        unindexed++;
                        continue;
                    }

                    complete += root.TryGetProperty("complete", out var ready) && ready.ValueKind == JsonValueKind.True ? 1 : 0;
                    if (!root.TryGetProperty("coverageVersion", out var version) || version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var value) || value != 1
                        || !root.TryGetProperty("coverage", out var coverage) || coverage.ValueKind != JsonValueKind.Object
                        || Features.Any(feature => !coverage.TryGetProperty(feature, out var flag) || flag.ValueKind is not (JsonValueKind.True or JsonValueKind.False)))
                    {
                        unindexed++;
                        continue;
                    }

                    foreach (var feature in Features)
                    {
                        if (coverage.GetProperty(feature).GetBoolean())
                        {
                            counts[feature]++;
                        }
                    }
                }
                catch (JsonException)
                {
                    unindexed++;
                }
            }

            return new EnhancedAnalysisStats(saved, complete, unindexed, counts);
        }
    }
}
