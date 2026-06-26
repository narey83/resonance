// <copyright file="TagConsolidator.cs" company="John Narey">
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

namespace resonance.TagSanitization
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using resonance.Common;
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
            "mp3", "aiff", "aif",
        };

        // RIFF (little-endian) containers handled with targeted byte surgery. TagLib cannot
        // reliably rewrite or remove a malformed/empty `id3 ` chunk inside a WAV — Save() leaves
        // the original chunk in place — so a phantom tag is re-detected on every scan. We strip
        // it directly instead. (AIFF stays on the generic ID3 path; no breakage observed there.)
        private static readonly HashSet<string> RiffExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "wav",
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

            if (!Id3Extensions.Contains(ext) && !XiphExtensions.Contains(ext) && !RiffExtensions.Contains(ext))
            {
                return Clean(maskedFilename, filename, directory);
            }

            try
            {
                if (RiffExtensions.Contains(ext))
                {
                    var rChanges = AnalyseRiffId3(filePath);
                    return new(maskedFilename, filename, directory, rChanges.Count > 0, [.. rChanges]);
                }

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

            if (!Id3Extensions.Contains(ext) && !XiphExtensions.Contains(ext) && !RiffExtensions.Contains(ext))
            {
                return Clean(maskedFilename, filename, directory);
            }

            // Serialize against other tag writers touching this same file (see FileWriteLock).
            using var fileLock = FileWriteLock.Acquire(filePath);

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

                if (RiffExtensions.Contains(ext))
                {
                    var rChanges = ConsolidateRiffId3(filePath);
                    return new(maskedFilename, filename, directory, rChanges.Count > 0, [.. rChanges]);
                }

                List<string> changes;
                using (var id3File = TagLib.File.Create(filePath, TagLib.ReadStyle.None))
                {
                    changes = BuildChangeList(id3File, dryRun: false);
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
                }

                // TagLib's MPEG Save() does not reliably strip the trailing ID3v1 TAG block even
                // after RemoveTags(Id3v1), so HasPhysicalId3v1Block keeps re-flagging the file on
                // every scan. Enforce removal directly once the TagLib handle is closed.
                if (changes.Count > 0 && HasPhysicalId3v1Block(filePath))
                {
                    StripTrailingId3v1(filePath);
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

        // ── RIFF/WAV ID3 handling ─────────────────────────────────────────────
        // WAV files in the wild carry appended (often stacked, malformed) `id3 ` chunks that
        // TagLib surfaces as a phantom, empty ID3v2 tag it cannot rewrite. We strip such empty
        // chunks via byte surgery; files with real ID3 frames fall through to the generic path.
        private static List<string> AnalyseRiffId3(string filePath)
        {
            var changes = new List<string>();
            var frameCount = ReadRiffId3FrameCount(filePath, out var hasId3);
            if (!hasId3)
            {
                return changes;
            }

            if (frameCount == 0)
            {
                if (TryStripTrailingRiffId3(filePath, dryRun: true, out var bytes))
                {
                    changes.Add($"Would remove non-canonical empty ID3 chunk ({bytes} bytes) from WAV");
                }

                // Unlocatable phantom tag: report nothing so the file stops re-appearing.
                return changes;
            }

            // Real ID3 frames present — report the same consolidation the generic path performs.
            using var file = TagLib.File.Create(filePath, TagLib.ReadStyle.None);
            changes.AddRange(BuildChangeList(file, dryRun: true));
            return changes;
        }

        private static List<string> ConsolidateRiffId3(string filePath)
        {
            var changes = new List<string>();
            var frameCount = ReadRiffId3FrameCount(filePath, out var hasId3);
            if (!hasId3)
            {
                return changes;
            }

            if (frameCount == 0)
            {
                if (TryStripTrailingRiffId3(filePath, dryRun: false, out var bytes))
                {
                    changes.Add($"Removed non-canonical empty ID3 chunk ({bytes} bytes) from WAV");
                }

                return changes;
            }

            using (var file = TagLib.File.Create(filePath, TagLib.ReadStyle.None))
            {
                changes.AddRange(BuildChangeList(file, dryRun: false));
                if (changes.Count > 0)
                {
                    file.Save();
                }
            }

            return changes;
        }

        private static int ReadRiffId3FrameCount(string filePath, out bool hasId3)
        {
            using var file = TagLib.File.Create(filePath, TagLib.ReadStyle.None);
            if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag tag)
            {
                hasId3 = true;
                return tag.GetFrames().Count();
            }

            hasId3 = false;
            return 0;
        }

        // Locates an appended `id3 ` chunk region at the tail of a RIFF/WAV and (unless dryRun)
        // strips it, repairing the `data` and `RIFF` size fields. Bails on anything unexpected.
        private static bool TryStripTrailingRiffId3(string filePath, bool dryRun, out int removedBytes)
        {
            removedBytes = 0;
            var access = dryRun ? FileAccess.Read : FileAccess.ReadWrite;
            using var fs = File.Open(filePath, FileMode.Open, access);
            var n = fs.Length;
            if (n < 44)
            {
                return false;
            }

            Span<byte> head = stackalloc byte[12];
            fs.Position = 0;
            fs.ReadExactly(head);
            if (head[0] != 'R' || head[1] != 'I' || head[2] != 'F' || head[3] != 'F'
                || head[8] != 'W' || head[9] != 'A' || head[10] != 'V' || head[11] != 'E')
            {
                return false;
            }

            // Front-walk the chunk list for the data + fmt headers. The data chunk's own declared
            // size is frequently wrong (which is the whole problem), so we stop once we reach it.
            long off = 12;
            long dataHdr = -1;
            long fmtHdr = -1;
            Span<byte> chdr = stackalloc byte[8];
            while (off + 8 <= n)
            {
                fs.Position = off;
                fs.ReadExactly(chdr);
                var csz = (uint)(chdr[4] | (chdr[5] << 8) | (chdr[6] << 16) | (chdr[7] << 24));
                if (chdr[0] == 'f' && chdr[1] == 'm' && chdr[2] == 't' && chdr[3] == ' ' && fmtHdr < 0)
                {
                    fmtHdr = off;
                }

                if (chdr[0] == 'd' && chdr[1] == 'a' && chdr[2] == 't' && chdr[3] == 'a')
                {
                    dataHdr = off;
                    break;
                }

                var next = off + 8 + csz + (csz & 1);
                if (next <= off || next > n)
                {
                    break;
                }

                off = next;
            }

            if (dataHdr < 0 || fmtHdr < 0)
            {
                return false;
            }

            var dataBody = dataHdr + 8;

            // Tail-scan the last 64 KiB for the first real id3 chunk header ("id3 " + ID3 magic).
            var scanStart = Math.Max(dataBody, n - 65536);
            var scanLen = (int)(n - scanStart);
            if (scanLen <= 11)
            {
                return false;
            }

            var tail = new byte[scanLen];
            fs.Position = scanStart;
            fs.ReadExactly(tail);

            long pId3 = -1;
            for (var i = 0; i + 11 < scanLen; i++)
            {
                var isId3Chunk = (tail[i] == 'i' || tail[i] == 'I')
                    && (tail[i + 1] == 'd' || tail[i + 1] == 'D')
                    && tail[i + 2] == '3' && tail[i + 3] == ' ';
                if (isId3Chunk && tail[i + 8] == 'I' && tail[i + 9] == 'D' && tail[i + 10] == '3')
                {
                    pId3 = scanStart + i;
                    break;
                }
            }

            if (pId3 < 0 || pId3 < dataBody || (n - pId3) > 1_000_000)
            {
                return false;
            }

            var newDataSize = pId3 - dataBody;
            if (newDataSize <= 0)
            {
                return false;
            }

            // Duration sanity guards against a stray id3 match inside PCM truncating real audio.
            // The WAV byte-rate lives at fmt body offset 8 (i.e. fmtHdr + 8 header + 8 into body).
            fs.Position = fmtHdr + 16;
            Span<byte> br = stackalloc byte[4];
            fs.ReadExactly(br);
            var byteRate = (uint)(br[0] | (br[1] << 8) | (br[2] << 16) | (br[3] << 24));
            if (byteRate == 0)
            {
                return false;
            }

            var seconds = (double)newDataSize / byteRate;
            if (seconds is < 1 or > 7200)
            {
                return false;
            }

            removedBytes = (int)(n - pId3);
            if (dryRun)
            {
                return true;
            }

            // Repair the data chunk size and the RIFF size, then truncate the trailing id3 region.
            Span<byte> sz = stackalloc byte[4];
            WriteUInt32Le(sz, (uint)newDataSize);
            fs.Position = dataHdr + 4;
            fs.Write(sz);

            WriteUInt32Le(sz, (uint)(pId3 - 8));
            fs.Position = 4;
            fs.Write(sz);

            fs.SetLength(pId3);
            fs.Flush();
            return true;
        }

        private static void WriteUInt32Le(Span<byte> dst, uint v)
        {
            dst[0] = (byte)v;
            dst[1] = (byte)(v >> 8);
            dst[2] = (byte)(v >> 16);
            dst[3] = (byte)(v >> 24);
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
