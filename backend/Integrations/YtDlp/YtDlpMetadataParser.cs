// <copyright file="YtDlpMetadataParser.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp;

using System;
using System.Text.RegularExpressions;
using Resonance.Integrations.YtDlp.Types;

public static class YtDlpMetadataParser
{
    public static ParsedTrackMetadata Parse(
        string rawTitle,
        string uploader,
        int? playlistIndex = null,
        string? uploadDate = null,
        string? defaultGenre = null)
    {
        // Strip leading track-number prefix: "3. ", "03. "
        uint? inTitleTrackNumber = null;
        var prefixMatch = Regex.Match(rawTitle, @"^(\d+)\.\s+");
        if (prefixMatch.Success && uint.TryParse(prefixMatch.Groups[1].Value, out var prefixNum))
        {
            inTitleTrackNumber = prefixNum;
            rawTitle = rawTitle[prefixMatch.Length..];
        }

        // In-title track number takes precedence over playlist position
        var effectiveTrackNumber = inTitleTrackNumber.HasValue
            ? (int?)inTitleTrackNumber.Value
            : playlistIndex;

        // Titles separate artist from track with a hyphen, en dash, or em dash. Hyphens need
        // spaces on both sides (to not split hyphenated words) but may be doubled/tripled
        // (e.g. "Artist -- Title"); en/em dashes are unambiguous and need a space on one side.
        var separatorMatch = Regex.Match(rawTitle, @"\s+-+\s+|\s*[–—]+\s+|\s+[–—]+\s*");
        if (!separatorMatch.Success)
        {
            // Dashes glued to one side: "Pfirter- Oppression", "nthng -There Is A Place For Me"
            separatorMatch = Regex.Match(rawTitle, @"(?<=\S)-+\s+|\s+-+(?=\S)");
        }

        if (!separatorMatch.Success)
        {
            // Colon separator: "DJ Disrespect: Transition (Athletic Mix)"
            separatorMatch = Regex.Match(rawTitle, @"(?<=\S):\s+");
        }

        if (!separatorMatch.Success)
        {
            // Last resort, bare dash with no spaces: "Artist-Title". Scoped to before any
            // bracket so "(Some Remix)" and catalogue numbers like [TECH-UM003] can't split.
            // ponytail: hyphenated artist names ("Hi-Tech") will mis-split; accepted trade-off.
            var bracketIdx = rawTitle.IndexOfAny(['[', '(']);
            var scope = bracketIdx >= 0 ? rawTitle[..bracketIdx] : rawTitle;
            separatorMatch = Regex.Match(scope, @"(?<=\S)-+(?=\S)");
        }

        var dashIdx = separatorMatch.Success ? separatorMatch.Index : -1;

        if (dashIdx > 0)
        {
            var artist = rawTitle[..dashIdx].Trim();
            var rest = rawTitle[(dashIdx + separatorMatch.Length)..].Trim();

            // Extract [Label] → album
            string? album = null;
            var labelMatch = Regex.Match(rest, @"\[([^\]]+)\]");
            if (labelMatch.Success)
            {
                album = labelMatch.Groups[1].Value.Trim();
                rest = rest.Remove(labelMatch.Index, labelMatch.Length).Trim();
            }

            // Strip common suffixes
            rest = Regex.Replace(rest, @"\s*\(Original Mix\)", string.Empty, RegexOptions.IgnoreCase).Trim();
            rest = Regex.Replace(rest, @"\s*\(Official[^)]*\)", string.Empty, RegexOptions.IgnoreCase).Trim();
            rest = Regex.Replace(rest, @"\s*Official\s+(Video|Audio|Lyric\s+Video)", string.Empty, RegexOptions.IgnoreCase).Trim();
            rest = rest.TrimEnd('-', ' ');

            if (!string.IsNullOrWhiteSpace(artist) && !string.IsNullOrWhiteSpace(rest))
            {
                return Build(artist, rest, album, effectiveTrackNumber, uploadDate, defaultGenre);
            }
        }

        return Build(uploader, rawTitle, null, effectiveTrackNumber, uploadDate, defaultGenre);
    }

    private static ParsedTrackMetadata Build(
        string artist,
        string title,
        string? album,
        int? playlistIndex,
        string? uploadDate,
        string? defaultGenre)
    {
        uint? year = uploadDate?.Length >= 4 && uint.TryParse(uploadDate[..4], out var y) ? y : null;
        uint? trackNumber = playlistIndex.HasValue ? (uint)playlistIndex.Value : null;
        string? genre = string.IsNullOrWhiteSpace(defaultGenre) ? null : defaultGenre;
        return new ParsedTrackMetadata(artist, title, album, trackNumber, year, genre);
    }
}
