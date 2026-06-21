// <copyright file="TagConsolidator.cs" company="JP Dillingham">
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

namespace resonance.TagSanitization
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using resonance.KeyAnalysis;

    /// <summary>
    ///     Consolidates all ID3 tag versions in a single audio file into one clean
    ///     ID3v2.3 tag.
    ///
    ///     Dry-run mode analyses the file and reports what would change without
    ///     writing anything.  The full-run mode performs the same analysis then
    ///     writes the result and saves.
    ///
    ///     Consolidation covers:
    ///       • Upgrading ID3v2.2 or downgrading ID3v2.4 to ID3v2.3
    ///       • Promoting fields from ID3v1 into ID3v2 where ID3v2 is empty
    ///       • Removing the ID3v1 block once its data has been promoted
    ///       • Removing non-standard APEv2 blocks from ID3 containers (MP3 etc.)
    ///       • Removing non-standard ID3 blocks from FLAC files (Xiph is canonical)
    ///       • Moving key data from TXXX:KEY / COMM into TKEY via KeyTagHelper.
    /// </summary>
    public static class TagConsolidator
    {
        // ID3 tagging is only meaningful for these containers
        private static readonly HashSet<string> Id3Extensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "aiff", "aif", "wav",
        };

        // These formats use Xiph/VorbisComment exclusively; any ID3 or APE block is non-standard
        private static readonly HashSet<string> XiphExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "flac", "ogg", "opus",
        };

        // ── Public API ────────────────────────────────────────────────────────

        /// <summary>
        ///     Analyses the file and returns what consolidation would do, without
        ///     writing anything to disk.
        /// </summary>
        /// <returns></returns>
        public static FileConsolidationResult Analyse(string filePath, string maskedFilename)
        {
            var filename = Path.GetFileName(filePath);
            var directory = Path.GetFileName(Path.GetDirectoryName(filePath)) ?? string.Empty;
            var ext = GetExtension(filePath);

            if (!Id3Extensions.Contains(ext) && !XiphExtensions.Contains(ext))
            {
                return Clean(maskedFilename, filename, directory);
            }

            try
            {
                using var file = TagLib.File.Create(filePath, TagLib.ReadStyle.None);
                var changes = XiphExtensions.Contains(ext)
                    ? BuildXiphChangeList(file)
                    : BuildChangeList(file, dryRun: true);
                return new(maskedFilename, filename, directory, changes.Count > 0, [.. changes]);
            }
            catch (Exception ex)
            {
                return Error(maskedFilename, filename, directory, ex.Message);
            }
        }

        /// <summary>
        ///     Consolidates the file's tags in place and saves.
        ///     Returns what changed, or an empty result if the file was already clean.
        /// </summary>
        /// <returns></returns>
        public static FileConsolidationResult Consolidate(string filePath, string maskedFilename)
        {
            var filename = Path.GetFileName(filePath);
            var directory = Path.GetFileName(Path.GetDirectoryName(filePath)) ?? string.Empty;
            var ext = GetExtension(filePath);

            if (!Id3Extensions.Contains(ext) && !XiphExtensions.Contains(ext))
            {
                return Clean(maskedFilename, filename, directory);
            }

            try
            {
                if (XiphExtensions.Contains(ext))
                {
                    // TagLib.Flac/Ogg.File.Save() rebuilds the Xiph metadata blocks but cannot
                    // remove a prepended ID3v2 block from disk.  Detect via TagLib, then strip
                    // via direct byte manipulation.  Do NOT call file.Save() here.
                    bool hasId3v2 = false;
                    byte id3v2Ver = 0;
                    bool hasId3v1 = false;
                    using (var file = TagLib.File.Create(filePath, TagLib.ReadStyle.None))
                    {
                        if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag t)
                        {
                            hasId3v2 = true;
                            id3v2Ver = t.Version;
                        }

                        hasId3v1 = file.GetTag(TagLib.TagTypes.Id3v1) != null;
                    }

                    var xChanges = new List<string>();
                    if (hasId3v2)
                    {
                        xChanges.Add($"Removed non-standard ID3v2.{id3v2Ver} block (Xiph is canonical for this format)");
                        StripPrependedId3(filePath);
                    }

                    if (hasId3v1)
                    {
                        xChanges.Add("Removed non-standard ID3v1 block (Xiph is canonical for this format)");
                        StripTrailingId3v1(filePath);
                    }

                    return new(maskedFilename, filename, directory, xChanges.Count > 0, [.. xChanges]);
                }

                using var id3File = TagLib.File.Create(filePath, TagLib.ReadStyle.None);
                var changes = BuildChangeList(id3File, dryRun: false);
                if (changes.Count > 0)
                {
                    id3File.Save();

                    // Verify the write persisted by re-reading the raw ID3v2 version byte.
                    // TagLib's Save() can silently no-op when the tag isn't marked dirty
                    // (e.g. version-only changes in some library states).
                    if (!VerifyId3v2Version(filePath, expectedVersion: 3))
                    {
                        return Error(maskedFilename, filename, directory,
                            "Save appeared to succeed but ID3v2.3 version did not persist on disk");
                    }
                }

                return new(maskedFilename, filename, directory, changes.Count > 0, [.. changes]);
            }
            catch (Exception ex)
            {
                return Error(maskedFilename, filename, directory, ex.Message);
            }
        }

        // ── Core logic ────────────────────────────────────────────────────────
        private static List<string> BuildChangeList(TagLib.File file, bool dryRun)
        {
            var changes = new List<string>();

            // TagLib.Mpeg.File synthesises a virtual ID3v1 object from ID3v2 data even
            // when there is no physical TAG block on disk, so GetTag(Id3v1) always returns
            // non-null for MP3 files.  Check the raw bytes to determine real presence.
            var id3v1 = HasPhysicalId3v1Block(file.Name)
                ? file.GetTag(TagLib.TagTypes.Id3v1) as TagLib.Id3v1.Tag
                : null;

            // Create ID3v2 if absent; passing `true` only allocates an in-memory object.
            var id3v2 = (file.GetTag(TagLib.TagTypes.Id3v2)
                      ?? file.GetTag(TagLib.TagTypes.Id3v2, true)) as TagLib.Id3v2.Tag;

            // Nothing to do for formats that use Xiph or other non-ID3 tagging
            if (id3v1 == null && id3v2 == null)
            {
                return changes;
            }

            // ── Version upgrade / downgrade ───────────────────────────────────
            if (id3v2 != null && id3v2.Version != 3)
            {
                changes.Add($"ID3v2.{id3v2.Version} → ID3v2.3 · all existing fields carried across ({SummariseFields(id3v2)})");
                if (!dryRun)
                {
                    id3v2.Version = 3;
                }
            }

            // ── Promote ID3v1 fields into ID3v2 where ID3v2 is empty ──────────
            if (id3v1 != null && id3v2 != null)
            {
                var promoted = PromoteV1Fields(id3v1, id3v2, dryRun);
                changes.AddRange(promoted);

                var removalNote = promoted.Count > 0
                    ? $"Removed ID3v1 block after copying {promoted.Count} missing field{(promoted.Count == 1 ? string.Empty : "s")} to ID3v2.3 · now retains: {SummariseFields(id3v2)}"
                    : $"Removed redundant ID3v1 block · ID3v2.3 already has: {SummariseFields(id3v2)}";
                changes.Add(removalNote);

                if (!dryRun)
                {
                    file.RemoveTags(TagLib.TagTypes.Id3v1);
                }
            }

            // ── APEv2 removal (non-standard on ID3 containers) ────────────────
            if (file.GetTag(TagLib.TagTypes.Ape) != null)
            {
                changes.Add("Removed non-standard APEv2 block");
                if (!dryRun)
                {
                    file.RemoveTags(TagLib.TagTypes.Ape);
                }
            }

            // ── Key consolidation: TXXX:KEY / COMM → TKEY ────────────────────
            if (id3v2 != null)
            {
                changes.AddRange(ConsolidateKey(id3v2, dryRun));
            }

            // Ensure the version is stamped on write even if only the key changed
            if (!dryRun && changes.Count > 0 && id3v2 != null)
            {
                id3v2.Version = 3;
            }

            return changes;
        }

        // Detection-only; used by Analyse (dry run). Consolidate uses inline detection + byte stripping.
        private static List<string> BuildXiphChangeList(TagLib.File file)
        {
            var changes = new List<string>();
            if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2)
            {
                changes.Add($"Removed non-standard ID3v2.{id3v2.Version} block (Xiph is canonical for this format)");
            }

            if (file.GetTag(TagLib.TagTypes.Id3v1) != null)
            {
                changes.Add("Removed non-standard ID3v1 block (Xiph is canonical for this format)");
            }

            if (file.GetTag(TagLib.TagTypes.Ape) != null)
            {
                changes.Add("Removed non-standard APEv2 block (Xiph is canonical for this format)");
            }

            return changes;
        }

        private static void StripPrependedId3(string filePath)
        {
            // ID3v2 header: bytes 0-2 = "ID3", bytes 6-9 = synchsafe size
            Span<byte> hdr = stackalloc byte[10];
            using (var probe = File.OpenRead(filePath))
            {
                if (probe.Length < 10)
                {
                    return;
                }

                probe.ReadExactly(hdr);
            }

            if (hdr[0] != 'I' || hdr[1] != 'D' || hdr[2] != '3')
            {
                return;
            }

            long id3Len = ((long)hdr[6] << 21) | ((long)hdr[7] << 14) | ((long)hdr[8] << 7) | hdr[9];
            id3Len += 10;
            if ((hdr[5] & 0x10) != 0)
            {
                id3Len += 10; // footer present
            }

            var tmp = filePath + ".sanitmp";
            try
            {
                using (var src = File.OpenRead(filePath))
                using (var dst = File.Create(tmp))
                {
                    src.Seek(id3Len, SeekOrigin.Begin);
                    src.CopyTo(dst);
                }

                File.Move(tmp, filePath, overwrite: true);
            }
            catch
            {
                try
                {
                    File.Delete(tmp);
                }
                catch
                { /* ignore */
                }

                throw;
            }
        }

        private static void StripTrailingId3v1(string filePath)
        {
            using var fs = File.Open(filePath, FileMode.Open, FileAccess.ReadWrite);
            if (fs.Length < 128)
            {
                return;
            }

            Span<byte> tag = stackalloc byte[3];
            fs.Seek(-128, SeekOrigin.End);
            fs.ReadExactly(tag);
            if (tag[0] == 'T' && tag[1] == 'A' && tag[2] == 'G')
            {
                fs.SetLength(fs.Length - 128);
            }
        }

        private static List<string> PromoteV1Fields(TagLib.Id3v1.Tag v1, TagLib.Id3v2.Tag v2, bool dryRun)
        {
            var promoted = new List<string>();

            if (string.IsNullOrEmpty(v2.Title) && !string.IsNullOrEmpty(v1.Title))
            {
                promoted.Add($"Promoted title: \"{v1.Title}\"");
                if (!dryRun)
                {
                    v2.Title = v1.Title;
                }
            }

            if ((v2.Performers == null || v2.Performers.Length == 0)
                && v1.Performers != null && v1.Performers.Length > 0)
            {
                promoted.Add($"Promoted artist: \"{v1.Performers[0]}\"");
                if (!dryRun)
                {
                    v2.Performers = v1.Performers;
                }
            }

            if (string.IsNullOrEmpty(v2.Album) && !string.IsNullOrEmpty(v1.Album))
            {
                promoted.Add($"Promoted album: \"{v1.Album}\"");
                if (!dryRun)
                {
                    v2.Album = v1.Album;
                }
            }

            if (v2.Year == 0 && v1.Year != 0)
            {
                promoted.Add($"Promoted year: {v1.Year}");
                if (!dryRun)
                {
                    v2.Year = v1.Year;
                }
            }

            if (v2.Track == 0 && v1.Track != 0)
            {
                promoted.Add($"Promoted track: {v1.Track}");
                if (!dryRun)
                {
                    v2.Track = v1.Track;
                }
            }

            if ((v2.Genres == null || v2.Genres.Length == 0)
                && v1.Genres != null && v1.Genres.Length > 0)
            {
                promoted.Add($"Promoted genre: \"{v1.Genres[0]}\"");
                if (!dryRun)
                {
                    v2.Genres = v1.Genres;
                }
            }

            return promoted;
        }

        private static List<string> ConsolidateKey(TagLib.Id3v2.Tag id3v2, bool dryRun)
        {
            var changes = new List<string>();

            var hasTxxx = id3v2.GetFrames<TagLib.Id3v2.UserTextInformationFrame>()
                .Any(f => string.Equals(f.Description, "KEY", StringComparison.OrdinalIgnoreCase));

            var hasCommKey = id3v2.GetFrames<TagLib.Id3v2.CommentsFrame>()
                .Any(f => KeyTagHelper.Normalize(f.Text?.Trim()) != null);

            if (!hasTxxx && !hasCommKey)
            {
                return changes;
            }

            var key = KeyTagHelper.ReadKey(id3v2);
            if (key == null)
            {
                return changes;
            }

            changes.Add($"Consolidated key to TKEY: {key}");
            if (!dryRun)
            {
                KeyTagHelper.WriteKey(id3v2, key);
            }

            return changes;
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private static bool VerifyId3v2Version(string filePath, byte expectedVersion)
        {
            try
            {
                using var stream = File.OpenRead(filePath);
                if (stream.Length < 4)
                {
                    return true; // can't verify; don't block
                }

                Span<byte> hdr = stackalloc byte[4];
                stream.ReadExactly(hdr);

                // If there's no ID3v2 header at all, that's fine (file may have had no ID3v2)
                if (hdr[0] != 'I' || hdr[1] != 'D' || hdr[2] != '3')
                {
                    return true;
                }

                return hdr[3] == expectedVersion;
            }
            catch
            {
                return true; // can't verify; don't block
            }
        }

        private static bool HasPhysicalId3v1Block(string filePath)
        {
            try
            {
                using var stream = File.OpenRead(filePath);
                if (stream.Length < 128)
                {
                    return false;
                }

                stream.Seek(-128, SeekOrigin.End);
                Span<byte> buf = stackalloc byte[3];
                stream.ReadExactly(buf);
                return buf[0] == (byte)'T' && buf[1] == (byte)'A' && buf[2] == (byte)'G';
            }
            catch
            {
                return false;
            }
        }

        private static string SummariseFields(TagLib.Id3v2.Tag tag)
        {
            var parts = new List<string>();
            if (!string.IsNullOrEmpty(tag.Title))
            {
                parts.Add("title");
            }

            if (tag.Performers?.Length > 0 && !string.IsNullOrEmpty(tag.Performers[0]))
            {
                parts.Add("artist");
            }

            if (tag.AlbumArtists?.Length > 0 && !string.IsNullOrEmpty(tag.AlbumArtists[0]))
            {
                parts.Add("album artist");
            }

            if (!string.IsNullOrEmpty(tag.Album))
            {
                parts.Add("album");
            }

            if (tag.Year > 0)
            {
                parts.Add("year");
            }

            if (tag.Track > 0)
            {
                parts.Add($"track {tag.Track}");
            }

            if (tag.Disc > 0)
            {
                parts.Add($"disc {tag.Disc}");
            }

            if (tag.Genres?.Length > 0 && !string.IsNullOrEmpty(tag.Genres[0]))
            {
                parts.Add("genre");
            }

            if (tag.BeatsPerMinute > 0)
            {
                parts.Add($"BPM {tag.BeatsPerMinute}");
            }

            var key = KeyTagHelper.ReadKey(tag);
            if (key != null)
            {
                parts.Add($"key {key}");
            }

            if (!string.IsNullOrEmpty(tag.Comment))
            {
                parts.Add("comment");
            }

            if (tag.Pictures?.Length > 0)
            {
                parts.Add("artwork");
            }

            if (!string.IsNullOrEmpty(tag.Lyrics))
            {
                parts.Add("lyrics");
            }

            return parts.Count > 0 ? string.Join(", ", parts) : "no fields";
        }

        private static string GetExtension(string filePath)
            => Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();

        private static FileConsolidationResult Clean(string masked, string filename, string directory)
            => new(masked, filename, directory, false, []);

        private static FileConsolidationResult Error(string masked, string filename, string directory, string message)
            => new(masked, filename, directory, false, [$"Error: {message}"]);
    }
}
