// <copyright file="MetadataTagEvidence.cs" company="John Narey">
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

namespace resonance.MetadataLookup
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using resonance.Common;
    using resonance.Shares;

    /// <summary>Evidence from actual disk values before and after a successful tag write.</summary>
    internal static class MetadataTagEvidence
    {
        internal static IReadOnlyDictionary<string, string> Values(FileTags tags) => new Dictionary<string, string>
        {
            ["Title"] = tags?.Title ?? string.Empty,
            ["Artist"] = tags?.Artist ?? string.Empty,
            ["Album"] = tags?.Album ?? string.Empty,
            ["Album artist"] = tags?.AlbumArtist ?? string.Empty,
            ["Year"] = tags?.Year.ToString() ?? "0",
            ["Track number"] = tags?.TrackNumber.ToString() ?? "0",
            ["Disc number"] = tags?.DiscNumber.ToString() ?? "0",
            ["Genre"] = tags?.Genre ?? string.Empty,
        };

        internal static IReadOnlyDictionary<string, string> ConfirmChanges(FileTags before, FileTags after, FileTags proposed, IReadOnlyDictionary<string, string> sources)
        {
            var old = Values(before);
            var expected = Values(proposed);
            return Values(after).Where(pair => pair.Value != old[pair.Key] && pair.Value == expected[pair.Key]
                    && !string.IsNullOrWhiteSpace(pair.Value) && pair.Value != "0" && sources.ContainsKey(pair.Key))
                .ToDictionary(pair => pair.Key, pair => sources[pair.Key]);
        }

        internal static FileTags Read(string path)
        {
            using var file = TagLib.File.Create(path, TagLib.ReadStyle.None);
            var tag = file.Tag;
            return new FileTags(tag.FirstPerformer, tag.FirstAlbumArtist, tag.Album, tag.Title,
                tag.Track, tag.Year, ReadKey(file), tag.FirstGenre, tag.BeatsPerMinute, tag.Comment, tag.Disc);
        }

        internal static (FileTags Tags, IReadOnlyDictionary<string, string> Fields) Write(
            string path, Func<FileTags, FileTags> propose, IReadOnlyDictionary<string, string> sources,
            Action<FileTags> save, Func<FileTags> read = null)
        {
            using var fileLock = FileWriteLock.Acquire(path);
            read ??= () => Read(path);
            var before = read();
            var proposed = propose(before);

            // Do not rewrite a file when the lookup fills no gaps.
            if (before == proposed)
            {
                return (before, new Dictionary<string, string>());
            }

            save(proposed);
            var after = read();
            return (after, ConfirmChanges(before, after, proposed, sources));
        }

        private static string ReadKey(TagLib.File file)
        {
            if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3)
            {
                return resonance.Analysis.KeyTagHelper.ReadKey(id3);
            }

            return (file.GetTag(TagLib.TagTypes.Xiph) as TagLib.Ogg.XiphComment)?.GetField("INITIALKEY").FirstOrDefault();
        }
    }
}
