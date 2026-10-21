// <copyright file="CandidateFeatureSelection.cs" company="John Narey">
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

namespace resonance.Analysis.Candidates
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json.Nodes;

    public static class CandidateFeatureSelection
    {
        private static readonly string[] Known = { "beats", "key", "waveform", "energy", "loudness", "embedding", "structure", "phrases", "stems", "vocalActivity", "genre", "cues", "semanticPhrases", "loops", "vocalPresence" };

        public static void Validate(string[] features)
        {
            if (features != null && (features.Length == 0 || features.Length > Known.Length || features.Any(feature => !Known.Contains(feature, StringComparer.Ordinal))))
            {
                throw new ArgumentException("Select at least one supported analysis feature.");
            }
        }

        public static string Apply(string configuration, string[] features)
        {
            Validate(features);
            if (features == null)
            {
                return configuration;
            }

            var config = JsonNode.Parse(configuration) as JsonObject ?? throw new ArgumentException("Worker configuration must be an object.");
            var requested = new HashSet<string>(features, StringComparer.Ordinal);
            var required = new HashSet<string>(requested, StringComparer.Ordinal);
            if (required.Contains("loops"))
            {
                required.Add("beats");
            }

            if (required.Contains("vocalPresence"))
            {
                required.Add("vocalActivity");
            }

            if (required.Contains("genre"))
            {
                required.Add("embedding");
            }

            if (required.Overlaps(new[] { "cues", "phrases", "structure" }))
            {
                required.Add("structure");
                required.Add("beats");
            }

            if (required.Overlaps(new[] { "semanticPhrases", "vocalActivity" }))
            {
                required.Add("stems");
            }

            if (required.Contains("stems"))
            {
                required.Add("waveform");
            }

            foreach (var feature in Known)
            {
                var settings = config[feature] as JsonObject;
                var configured = settings?["enabled"]?.GetValue<bool>() ?? feature is "waveform" or "energy" or "loudness" or "genre" or "cues" or "phrases" or "vocalActivity";
                if (settings == null)
                {
                    settings = new JsonObject();
                    config[feature] = settings;
                }

                settings["enabled"] = required.Contains(feature) && configured;
            }

            config["featureSelection"] = new JsonObject
            {
                ["requested"] = new JsonArray(requested.OrderBy(value => value).Select(value => JsonValue.Create(value)).ToArray()),
                ["requiredIncludingDependencies"] = new JsonArray(required.OrderBy(value => value).Select(value => JsonValue.Create(value)).ToArray()),
            };
            return config.ToJsonString();
        }
    }
}
