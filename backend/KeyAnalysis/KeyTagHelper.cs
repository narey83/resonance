// <copyright file="KeyTagHelper.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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
//   │ https://slskd.org
//   │
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌╌ ╌
//   │ SPDX-FileCopyrightText: JP Dillingham
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ─  ── ──┈  ┈
// </copyright>

namespace resonance.KeyAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.RegularExpressions;

    /// <summary>
    ///     Centralises all ID3v2 key-tag read and write logic.
    ///
    ///     Read priority: TKEY → TXXX:KEY → COMM (first frame whose value is a
    ///     recognized key string).  All values are normalized to the app's canonical
    ///     standard notation before returning.
    ///
    ///     Write target: TKEY only, in ID3v2.3 with UTF-16 encoding.  Legacy
    ///     TXXX:KEY and COMM key frames are removed on every write or clear.
    /// </summary>
    public static class KeyTagHelper
    {
        // ── Lookup tables ─────────────────────────────────────────────────────

        // Camelot code → canonical standard key (mirrors camelot.js CAMELOT_KEYS)
        private static readonly Dictionary<string, string> CamelotMap = new(StringComparer.OrdinalIgnoreCase)
        {
            { "1A",  "G#m" }, { "1B",  "B" },
            { "2A",  "D#m" }, { "2B",  "F#" },
            { "3A",  "A#m" }, { "3B",  "C#" },
            { "4A",  "Fm" }, { "4B",  "Ab" },
            { "5A",  "Cm" }, { "5B",  "Eb" },
            { "6A",  "Gm" }, { "6B",  "Bb" },
            { "7A",  "Dm" }, { "7B",  "F" },
            { "8A",  "Am" }, { "8B",  "C" },
            { "9A",  "Em" }, { "9B",  "G" },
            { "10A", "Bm" }, { "10B", "D" },
            { "11A", "F#m" }, { "11B", "A" },
            { "12A", "C#m" }, { "12B", "E" },
        };

        // Standard musical notation → canonical (passthrough + enharmonic aliases)
        private static readonly Dictionary<string, string> MusicalMap = new(StringComparer.OrdinalIgnoreCase)
        {
            // Canonical majors (passthrough)
            { "C",    "C" }, { "C#",   "C#" }, { "D",    "D" }, { "D#",   "D#" },
            { "Eb",   "Eb" }, { "E",    "E" }, { "F",    "F" }, { "F#",   "F#" },
            { "G",    "G" }, { "G#",   "G#" }, { "Ab",   "Ab" }, { "A",    "A" },
            { "A#",   "A#" }, { "Bb",   "Bb" }, { "B",    "B" },

            // Enharmonic major aliases → canonical
            { "Db",   "C#" }, { "Gb",   "F#" },

            // Canonical minors (passthrough)
            { "Cm",   "Cm" }, { "C#m",  "C#m" }, { "Dm",   "Dm" }, { "D#m",  "D#m" },
            { "Em",   "Em" }, { "Fm",   "Fm" }, { "F#m",  "F#m" }, { "Gm",   "Gm" },
            { "G#m",  "G#m" }, { "Am",   "Am" }, { "A#m",  "A#m" }, { "Bm",   "Bm" },

            // Enharmonic minor aliases → canonical
            { "Ebm",  "D#m" }, { "Abm",  "G#m" }, { "Bbm",  "A#m" },
            { "Dbm",  "C#m" }, { "Gbm",  "F#m" },

            // "min" suffix variants
            { "Cmin",   "Cm" }, { "Dmin",   "Dm" }, { "Emin",   "Em" },
            { "Fmin",   "Fm" }, { "Gmin",   "Gm" }, { "Amin",   "Am" }, { "Bmin",   "Bm" },
            { "C#min",  "C#m" }, { "D#min",  "D#m" }, { "F#min",  "F#m" },
            { "G#min",  "G#m" }, { "A#min",  "A#m" },
            { "Dbmin",  "C#m" }, { "Ebmin",  "D#m" }, { "Gbmin",  "F#m" },
            { "Abmin",  "G#m" }, { "Bbmin",  "A#m" },

            // "maj" suffix variants
            { "Cmaj",   "C" }, { "Dmaj",   "D" }, { "Emaj",   "E" },
            { "Fmaj",   "F" }, { "Gmaj",   "G" }, { "Amaj",   "A" }, { "Bmaj",   "B" },
            { "C#maj",  "C#" }, { "D#maj",  "D#" }, { "F#maj",  "F#" },
            { "G#maj",  "G#" }, { "A#maj",  "A#" },
            { "Dbmaj",  "C#" }, { "Ebmaj",  "Eb" }, { "Gbmaj",  "F#" },
            { "Abmaj",  "Ab" }, { "Bbmaj",  "Bb" },
        };

        // Matches Camelot codes: 1A–12B (case-insensitive)
        private static readonly Regex CamelotRegex = new(@"^(\d{1,2})([AB])$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Matches Open Key codes: 1m–12m / 1d–12d (case-insensitive)
        private static readonly Regex OpenKeyRegex = new(@"^(\d{1,2})([dm])$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // ── Public read API ───────────────────────────────────────────────────

        /// <summary>
        ///     Reads the musical key from an ID3v2 tag using the priority chain:
        ///     TKEY → TXXX:KEY → COMM (first frame with a recognized key value).
        ///     The returned value is normalized to canonical standard notation,
        ///     or null if no recognized key is found.
        /// </summary>
        /// <returns></returns>
        public static string ReadKey(TagLib.Id3v2.Tag id3v2)
        {
            // 1. TKEY
            var tkey = id3v2.GetFrames(new TagLib.ByteVector("TKEY"))
                .OfType<TagLib.Id3v2.TextInformationFrame>()
                .Select(f => f.Text?.FirstOrDefault()?.Trim())
                .FirstOrDefault(v => !string.IsNullOrEmpty(v));
            if (tkey != null)
            {
                var norm = Normalize(tkey);
                if (norm != null)
                {
                    return norm;
                }
            }

            // 2. TXXX:KEY
            var txxx = id3v2.GetFrames<TagLib.Id3v2.UserTextInformationFrame>()
                .Where(f => string.Equals(f.Description, "KEY", StringComparison.OrdinalIgnoreCase))
                .Select(f => f.Text?.FirstOrDefault()?.Trim())
                .FirstOrDefault(v => !string.IsNullOrEmpty(v));
            if (txxx != null)
            {
                var norm = Normalize(txxx);
                if (norm != null)
                {
                    return norm;
                }
            }

            // 3. COMM — any comment frame whose entire text value is a recognized key
            var commKey = id3v2.GetFrames<TagLib.Id3v2.CommentsFrame>()
                .Select(f => f.Text?.Trim())
                .Where(t => !string.IsNullOrEmpty(t))
                .Select(Normalize)
                .FirstOrDefault(k => k != null);
            return commKey;
        }

        // ── Public write API ──────────────────────────────────────────────────

        /// <summary>
        ///     Writes <paramref name="key"/> to the TKEY frame in ID3v2.3 with UTF-16
        ///     encoding, and removes any legacy TXXX:KEY and COMM key frames.
        /// </summary>
        public static void WriteKey(TagLib.Id3v2.Tag id3v2, string key)
        {
            id3v2.Version = 3;
            RemoveAllKeyFrames(id3v2);

            id3v2.AddFrame(new TagLib.Id3v2.TextInformationFrame(new TagLib.ByteVector("TKEY"))
            {
                Text = [key],
                TextEncoding = TagLib.StringType.UTF16,
            });
        }

        /// <summary>
        ///     Removes all key frames (TKEY, TXXX:KEY, recognized COMM key frames)
        ///     and sets the tag to ID3v2.3.
        /// </summary>
        public static void ClearKey(TagLib.Id3v2.Tag id3v2)
        {
            id3v2.Version = 3;
            RemoveAllKeyFrames(id3v2);
        }

        // ── Normalization ─────────────────────────────────────────────────────

        /// <summary>
        ///     Converts any recognized key representation — Camelot (8A), Open Key (7m),
        ///     or musical notation (Am, Abm, Bbmaj, …) — to the app's canonical standard
        ///     notation.  Returns null for unrecognized input.
        /// </summary>
        /// <returns></returns>
        public static string Normalize(string key)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                return null;
            }

            var s = key.Trim();

            // Musical notation (canonical + aliases)
            if (MusicalMap.TryGetValue(s, out var musical))
            {
                return musical;
            }

            // Camelot: e.g. "8A", "10B"
            if (CamelotRegex.IsMatch(s) && CamelotMap.TryGetValue(s, out var camelot))
            {
                return camelot;
            }

            // Open Key: "8m" → Camelot "8A", "8d" → Camelot "8B"
            var ok = OpenKeyRegex.Match(s);
            if (ok.Success)
            {
                var num = ok.Groups[1].Value;
                var suffix = ok.Groups[2].Value.ToLowerInvariant() == "m" ? "A" : "B";
                if (CamelotMap.TryGetValue($"{num}{suffix}", out var openKey))
                {
                    return openKey;
                }
            }

            return null;
        }

        // ── Internal helpers ──────────────────────────────────────────────────
        private static void RemoveAllKeyFrames(TagLib.Id3v2.Tag id3v2)
        {
            id3v2.RemoveFrames(new TagLib.ByteVector("TKEY"));

            foreach (var f in id3v2.GetFrames<TagLib.Id3v2.UserTextInformationFrame>()
                .Where(f => string.Equals(f.Description, "KEY", StringComparison.OrdinalIgnoreCase))
                .ToList())
            {
                id3v2.RemoveFrame(f);
            }

            foreach (var f in id3v2.GetFrames<TagLib.Id3v2.CommentsFrame>()
                .Where(f => !string.IsNullOrEmpty(f.Text?.Trim()) && Normalize(f.Text.Trim()) != null)
                .ToList())
            {
                id3v2.RemoveFrame(f);
            }
        }
    }
}
