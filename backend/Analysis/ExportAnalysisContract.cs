// <copyright file="ExportAnalysisContract.cs" company="John Narey">
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
    using System.Linq;
    using System.Text.Json;

    internal static class ExportAnalysisContract
    {
        internal static bool Ready(JsonElement analysis)
        {
            if (analysis.ValueKind != JsonValueKind.Object
                || !analysis.TryGetProperty("scope", out var scope) || scope.ValueKind != JsonValueKind.Object
                || !scope.TryGetProperty("fullTrack", out var full) || full.ValueKind != JsonValueKind.True
                || !analysis.TryGetProperty("features", out var features) || features.ValueKind != JsonValueKind.Object
                || !analysis.TryGetProperty("featureAvailability", out var available) || available.ValueKind != JsonValueKind.Object
                || !analysis.TryGetProperty("durationSeconds", out var duration) || duration.ValueKind != JsonValueKind.Number
                || !duration.TryGetDouble(out var seconds) || !double.IsFinite(seconds) || seconds <= 0)
            {
                return false;
            }

            var availability = analysis.GetProperty("featureAvailability");
            var complete = new[] { "beats", "key", "waveform", "semanticPhrases", "vocalPresence", "genre" }.All(name =>
                availability.TryGetProperty(name, out var state) && state.ValueKind == JsonValueKind.String && state.GetString() == "available"
                && features.TryGetProperty(name, out var feature) && feature.ValueKind == JsonValueKind.Object
                && feature.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object);
            if (!complete)
            {
                return false;
            }

            var beats = features.GetProperty("beats").GetProperty("result");
            var waveform = features.GetProperty("waveform").GetProperty("result");
            var key = features.GetProperty("key").GetProperty("result");
            return beats.TryGetProperty("bpm_median_interval", out var bpm) && bpm.ValueKind == JsonValueKind.Number
                && bpm.TryGetDouble(out var tempo) && double.IsFinite(tempo) && tempo > 0
                && Timeline(beats, "beats_seconds", seconds, 2) && Timeline(beats, "downbeats_seconds", seconds, 1)
                && key.TryGetProperty("key", out var keyName) && keyName.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(keyName.GetString())
                && Peaks(waveform, "overallPeaks") && waveform.TryGetProperty("bands", out var bands) && bands.ValueKind == JsonValueKind.Object
                && new[] { "low", "mid", "high" }.All(band => Peaks(bands, band));
        }

        private static bool Timeline(JsonElement result, string name, double duration, int minimum)
        {
            if (!result.TryGetProperty(name, out var values) || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() < minimum)
            {
                return false;
            }

            var previous = -1d;
            foreach (var value in values.EnumerateArray())
            {
                if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) || !double.IsFinite(number)
                    || number < 0 || number <= previous || number > duration + 0.1)
                {
                    return false;
                }

                previous = number;
            }

            return true;
        }

        private static bool Peaks(JsonElement result, string name)
        {
            return result.TryGetProperty(name, out var values) && values.ValueKind == JsonValueKind.Array && values.GetArrayLength() > 0
                && values.EnumerateArray().All(value => value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)
                    && double.IsFinite(number) && number >= 0);
        }
    }
}
