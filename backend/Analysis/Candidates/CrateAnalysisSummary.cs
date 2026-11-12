// <copyright file="CrateAnalysisSummary.cs" company="John Narey">
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

namespace resonance.Analysis.Candidates;

using System;
using System.Linq;
using System.Text.Json;

/// <summary>Retains independent full-track facts without treating missing features as negative results.</summary>
internal static class CrateAnalysisSummary
{
    internal static string Create(JsonElement analysis, string analysisId)
    {
        if (analysis.ValueKind != JsonValueKind.Object || !analysis.TryGetProperty("scope", out var scope) || scope.ValueKind != JsonValueKind.Object || !scope.TryGetProperty("fullTrack", out var full)
            || full.ValueKind != JsonValueKind.True || !analysis.TryGetProperty("features", out var features)
            || !analysis.TryGetProperty("featureAvailability", out var availability)
            || features.ValueKind != JsonValueKind.Object || availability.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        JsonElement? Result(string name) => availability.TryGetProperty(name, out var state) && state.ValueKind == JsonValueKind.String
            && state.GetString() == "available" && features.TryGetProperty(name, out var feature)
            && feature.ValueKind == JsonValueKind.Object && feature.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Object ? result : null;
        var beats = Result("beats");
        double? bpm = beats?.TryGetProperty("bpm_median_interval", out _) == true
            && beats.Value.GetProperty("bpm_median_interval").ValueKind == JsonValueKind.Number
            && beats.Value.GetProperty("bpm_median_interval").TryGetDouble(out var tempo) && double.IsFinite(tempo) && tempo > 0 ? tempo : null;
        var keyResult = Result("key");
        var key = keyResult?.TryGetProperty("key", out _) == true && keyResult.Value.GetProperty("key").ValueKind == JsonValueKind.String
            ? KeyTagHelper.Normalize(keyResult.Value.GetProperty("key").GetString()) : null;
        var genreResult = Result("genre");
        string genre = null;
        if (genreResult?.TryGetProperty("scores", out _) == true && genreResult.Value.GetProperty("scores").ValueKind == JsonValueKind.Array)
        {
            var best = genreResult.Value.GetProperty("scores").EnumerateArray()
                .Where(score => score.ValueKind == JsonValueKind.Object && score.TryGetProperty("label", out var label) && label.ValueKind == JsonValueKind.String
                    && score.TryGetProperty("cosine", out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number))
                .OrderByDescending(score => score.GetProperty("cosine").GetDouble()).FirstOrDefault();
            genre = best.ValueKind == JsonValueKind.Object ? best.GetProperty("label").GetString() : null;
        }

        double? energy = null;
        var energyResult = Result("energy");
        if (energyResult?.TryGetProperty("rms", out _) == true && energyResult.Value.GetProperty("rms").ValueKind == JsonValueKind.Array)
        {
            var values = energyResult.Value.GetProperty("rms").EnumerateArray().Where(value => value.ValueKind == JsonValueKind.Number).Select(value => value.GetDouble()).Where(double.IsFinite).ToArray();
            if (values.Length > 0)
            {
                energy = values.Average();
            }
        }

        var voice = Result("vocalPresence");
        bool? vocals = voice?.TryGetProperty("segments", out _) == true && voice.Value.GetProperty("segments").ValueKind == JsonValueKind.Array ? voice.Value.GetProperty("segments").GetArrayLength() > 0 : null;
        if (voice?.TryGetProperty("processedVoice", out _) == true && voice.Value.GetProperty("processedVoice").ValueKind == JsonValueKind.Object && voice.Value.GetProperty("processedVoice").TryGetProperty("sustainedSegments", out var spans) && spans.ValueKind == JsonValueKind.Array)
        {
            vocals = (vocals ?? false) || spans.GetArrayLength() > 0;
        }

        var arrangement = Result("semanticPhrases");
        var automatic = arrangement?.TryGetProperty("djStructure", out _) == true
            && arrangement.Value.GetProperty("djStructure").TryGetProperty("automatic", out var auto) && auto.ValueKind == JsonValueKind.True;
        var neutralPhrases = automatic ? arrangement.Value.GetProperty("djStructure").GetProperty("segments").EnumerateArray().Count(segment => segment.GetProperty("label").GetString() == "Transition") : 0;
        bool HasGrid(string name) => beats.HasValue && beats.Value.TryGetProperty(name, out var grid)
            && grid.ValueKind == JsonValueKind.Array && grid.GetArrayLength() > 0;
        var coverage = new
        {
            beats = HasGrid("beats_seconds"), downbeats = HasGrid("downbeats_seconds"),
            vocals = vocals.HasValue, stems = Result("stems").HasValue,
            sections = Result("structure").HasValue, phrases = arrangement.HasValue,
            genre = genre != null, energy = energy.HasValue,
            cues = Result("cues").HasValue, loops = Result("loops").HasValue,
            similarity = Result("embedding").HasValue,
        };

        var availableFeatures = availability.EnumerateObject()
            .Where(feature => feature.Value.ValueKind == JsonValueKind.String && feature.Value.GetString() == "available")
            .Select(feature => feature.Name).ToArray();

        if (availableFeatures.Length == 0 && genre == null && energy == null && vocals == null && arrangement == null && bpm == null && key == null
            && !coverage.beats && !coverage.downbeats && !coverage.stems && !coverage.sections && !coverage.cues && !coverage.loops && !coverage.similarity)
        {
            return null;
        }

        return JsonSerializer.Serialize(new
        {
            coverageVersion = 1, coverage, availableFeatures,
            complete = CandidateAnalysisService.HasEnhanced(analysis), exportReady = ExportAnalysisContract.Ready(analysis), experimental = true, analysisId,
            bpm, key, genre, energy, energySemantics = "Mean PCM RMS; loudness-based energy proxy", vocals,
            automaticArrangement = automatic, neutralPhraseCount = neutralPhrases,
            reviewReason = automatic ? null : "Independent predictions; audition beatgrid and phrase labels",
        });
    }
}
