// <copyright file="SoulseekFileFactory.cs" company="JP Dillingham">
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

using System.IO;

namespace resonance.Shares
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Creates instances of <see cref="Soulseek.File"/>.
    /// </summary>
    public interface ISoulseekFileFactory
    {
        /// <summary>
        ///     Creates an instance of <see cref="Soulseek.File"/> from the given path.
        /// </summary>
        /// <param name="filename">The fully qualified path to the file.</param>
        /// <param name="maskedFilename">The masked filename.</param>
        /// <param name="size">The size of the file, in bytes.</param>
        /// <returns>The created file and any tag metadata that was read.</returns>
        (File File, FileTags Tags) Create(string filename, string maskedFilename, long size);
    }

    /// <summary>
    ///     ID3/tag metadata read from a file during share scanning.
    /// </summary>
    public record FileTags(string Artist, string AlbumArtist, string Album, string Title, uint TrackNumber, uint Year, string Key = null, string Genre = null, uint Bpm = 0, string Comment = null, uint DiscNumber = 0);

    /// <summary>
    ///     Represents a shared file that has no tag metadata.
    /// </summary>
    public record UntaggedFile(string MaskedFilename, string OriginalFilename, string Directory, string Filename, string Extension);

    /// <summary>
    ///     Represents a shared file that has tag metadata.
    /// </summary>
    public record TaggedFile(string MaskedFilename, string OriginalFilename, string Directory, string Filename, string Extension, FileTags Tags);

    /// <summary>
    ///     Creates instances of <see cref="Soulseek.File"/>.
    /// </summary>
    public class SoulseekFileFactory : ISoulseekFileFactory
    {
        // webm is intentionally excluded — it is a video container and should not be treated as audio
        private static readonly string[] AudioExtensions = { "aa", "aax", "aac", "aiff", "ape", "dsf", "flac", "m4a", "m4b", "m4p", "mp3", "mpc", "mpp", "ogg", "oga", "wav", "wma", "wv" };
        private static readonly string[] VideoExtensions = { "mkv", "ogv", "avi", "wmv", "asf", "mp4", "m4p", "m4v", "mpg", "mpe", "mpv", "mpg", "m2v" };
        private static readonly HashSet<string> SupportedExtensions = AudioExtensions.Concat(VideoExtensions).ToHashSet();

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Shares.Scan);

        /// <summary>
        ///     Creates an instance of <see cref="Soulseek.File"/> from the given path.
        /// </summary>
        /// <param name="filename">The fully qualified path to the file.</param>
        /// <param name="maskedFilename">The masked filename.</param>
        /// <param name="size">The size of the file, in bytes.</param>
        /// <returns>The created instance.</returns>
        public (File File, FileTags Tags) Create(string filename, string maskedFilename, long size)
        {
            var code = 1;
            var extension = Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
            List<FileAttribute> attributeList = default;
            FileTags tags = null;

            if (SupportedExtensions.Contains(extension))
            {
                attributeList = new List<FileAttribute>();
                TagLib.File file = default;

                try
                {
                    file = TagLib.File.Create(filename, TagLib.ReadStyle.Average | TagLib.ReadStyle.PictureLazy);

                    // try to mimic the behavior of existing clients by providing attributes selectively and in a specific order,
                    // depending on whether files use a lossless or lossy codec. lossless files should have BitsPerSample, while lossy
                    // will not. this may not be the best way to determine this.
                    bool isLossless = file.Properties.BitsPerSample > 0;

                    if (!isLossless)
                    {
                        // per Nicotine+ docs, Soulseek NS, Nicotine+, Museek+, SoulSeeX all send bit rate, length, then VBR
                        attributeList.Add(new FileAttribute(FileAttributeType.BitRate, file.Properties.AudioBitrate));
                        attributeList.Add(new FileAttribute(FileAttributeType.Length, (int)file.Properties.Duration.TotalSeconds));
                        attributeList.Add(new FileAttribute(FileAttributeType.VariableBitRate, IsVBR(file) ? 1 : 0));
                    }
                    else
                    {
                        // SoulseekQt 2015-6-12 and later provides the length, sample rate and bit depth for lossless files
                        // bitrate can be deduced from this information
                        attributeList.Add(new FileAttribute(FileAttributeType.Length, (int)file.Properties.Duration.TotalSeconds));
                        attributeList.Add(new FileAttribute(FileAttributeType.SampleRate, file.Properties.AudioSampleRate));
                        attributeList.Add(new FileAttribute(FileAttributeType.BitDepth, file.Properties.BitsPerSample));
                    }

                    // capture ID3/tag fields while the file is already open
                    var t = file.Tag;
                    var artist = t.FirstPerformer?.Trim();
                    var albumArtist = t.FirstAlbumArtist?.Trim();
                    var album = t.Album?.Trim();
                    var title = t.Title?.Trim();
                    var genre = t.Genres?.Length > 0 ? t.Genres[0]?.Trim() : null;
                    var comment = t.Comment?.Trim();

                    // read musical key: ID3v2 uses priority chain TKEY → TXXX:KEY → COMM
                    // (with normalization); Xiph uses INITIALKEY directly
                    string key = null;
                    if (file.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2)
                    {
                        key = resonance.Analysis.KeyTagHelper.ReadKey(id3v2);
                    }
                    else if (file.GetTag(TagLib.TagTypes.Xiph) is TagLib.Ogg.XiphComment xiph)
                    {
                        var fields = xiph.GetField("INITIALKEY");
                        if (fields.Length > 0 && !string.IsNullOrEmpty(fields[0]))
                        {
                            key = fields[0].Trim();
                        }
                    }

                    if (!string.IsNullOrEmpty(artist) || !string.IsNullOrEmpty(title))
                    {
                        tags = new FileTags(artist, albumArtist, album, title, t.Track, t.Year, key, genre, t.BeatsPerMinute, comment, t.Disc);
                    }
                    else if (!string.IsNullOrEmpty(key))
                    {
                        tags = new FileTags(null, null, null, null, 0, 0, key, genre, t.BeatsPerMinute, comment, t.Disc);
                    }
                }
                catch (Exception ex)
                {
                    Log.Debug("Failed to read metadata from file '{Filename}'; the file is an unsupported format or may be corrupt ({ExceptionType})", filename, ex.GetType().Name);
                }
                finally
                {
                    file?.Dispose();
                }
            }

            return (new File(code, maskedFilename, size, extension, attributeList), tags);
        }

        private bool IsVBR(TagLib.File file)
        {
            static bool HasVBRIHeader(TagLib.Mpeg.AudioHeader header) => header.VBRIHeader.Present && header.VBRIHeader.TotalSize > 0;
            static bool HasXingHeader(TagLib.Mpeg.AudioHeader header) => header.XingHeader.Present && header.XingHeader.TotalSize > 0;

            return file.Properties.Codecs.Any(c =>
                (c is TagLib.Mpeg.AudioHeader h && (HasVBRIHeader(h) || HasXingHeader(h)))
                || c is TagLib.Aac.AudioHeader
                || c is TagLib.Ogg.Codec);
        }
    }
}
