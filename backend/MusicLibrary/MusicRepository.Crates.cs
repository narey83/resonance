// <copyright file="MusicRepository.Crates.cs" company="John Narey">
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

namespace resonance.MusicLibrary;

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using resonance.MusicLibrary.Workspace;

/// <summary>Automatic analysed-track collections.</summary>
public partial class MusicRepository
{
    private string CrateAnalysisExists => $"EXISTS (SELECT 1 FROM {TA} ca WHERE {CacheMatch("ca")} AND (ca.overall_peaks IS NOT NULL OR ca.lufs IS NOT NULL OR ca.detected_bpm > 0 OR NULLIF(ca.detected_key, '') IS NOT NULL OR ca.dj_summary IS NOT NULL))";

    // Aggregate just labels and counts, never waveform blobs or the full track list.
    public IReadOnlyList<SmartCrate> AutomaticCrates()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        var summaryGenre = UsePostgres
            ? $"(SELECT c.dj_summary::jsonb->>'genre' FROM {TA} c WHERE {CacheMatch("c")})"
            : $"(SELECT json_extract(c.dj_summary,'$.genre') FROM {TA} c WHERE {CacheMatch("c")})";
        command.CommandText = $@"WITH facts AS (
            SELECT path, NULLIF(TRIM(genre), '') AS tag_genre, NULLIF(TRIM({summaryGenre}), '') AS predicted_genre,
                {CachedKey} AS musical_key, {CachedBpm} AS tempo FROM {T} WHERE {CrateAnalysisExists}),
            labels AS (
                SELECT path, 'Genre' AS kind, tag_genre AS label FROM facts WHERE LENGTH(tag_genre) BETWEEN 1 AND 100
                UNION SELECT path, 'Genre', predicted_genre FROM facts WHERE LENGTH(predicted_genre) BETWEEN 1 AND 100
                UNION SELECT path, 'Key', musical_key FROM facts WHERE LENGTH(TRIM(musical_key)) BETWEEN 1 AND 12
                UNION SELECT path, 'BPM', CAST(CAST(FLOOR(tempo / 10.0) * 10 AS INTEGER) AS TEXT) FROM facts WHERE tempo BETWEEN 20 AND 400)
            SELECT kind, MIN(label), COUNT(DISTINCT path) FROM labels GROUP BY kind, LOWER(label) ORDER BY kind, LOWER(label)";
        using var reader = command.ExecuteReader();
        var crates = new List<SmartCrate>();
        while (reader.Read())
        {
            var group = reader.GetString(0);
            var label = reader.GetString(1);
            if (group == "BPM")
            {
                label = double.Parse(label, CultureInfo.InvariantCulture).ToString("G17", CultureInfo.InvariantCulture);
            }

            var rules = group switch
            {
                "Genre" => new SmartCrateRules(Genre: label, AnalysedOnly: true),
                "Key" => new SmartCrateRules(Keys: [label], AnalysedOnly: true),
                _ => new SmartCrateRules(BpmMin: double.Parse(label, CultureInfo.InvariantCulture), BpmMax: Math.Min(400, double.Parse(label, CultureInfo.InvariantCulture) + 10), AnalysedOnly: true, BpmMaxExclusive: label != "400"),
            };
            var id = "auto-" + group.ToLowerInvariant() + "-" + Convert.ToHexString(Encoding.UTF8.GetBytes(label.ToLowerInvariant()));
            crates.Add(new SmartCrate(id, group == "BPM" ? (label == "400" ? "400 BPM" : $"{label}–<{int.Parse(label, CultureInfo.InvariantCulture) + 10} BPM") : label,
                $"{group} collection · updates when analysis is saved", rules, 0, true, group, Convert.ToInt32(reader.GetValue(2), CultureInfo.InvariantCulture)));
        }

        return crates;
    }

    private string SummaryFact(string name) => UsePostgres
        ? $"(SELECT c.dj_summary::jsonb->>'{name}' FROM {TA} c WHERE {CacheMatch("c")})"
        : $"(SELECT json_extract(c.dj_summary,'$.{name}') FROM {TA} c WHERE {CacheMatch("c")})";
}
