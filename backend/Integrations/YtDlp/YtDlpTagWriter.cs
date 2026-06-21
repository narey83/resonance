// <copyright file="YtDlpTagWriter.cs" company="JP Dillingham">
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

namespace Resonance.Integrations.YtDlp;

using System;
using System.IO;
using Resonance.Integrations.YtDlp.Types;
using Serilog;
using TagLib;

public static class YtDlpTagWriter
{
    private static readonly ILogger Log = Serilog.Log.ForContext(typeof(YtDlpTagWriter));

    private static readonly string[] ThumbnailExtensions = [".jpg", ".jpeg", ".webp", ".png"];

    /// <summary>
    ///     Writes parsed metadata and embedded artwork to the given audio file.
    ///     Returns null on success, or an error message on failure.
    /// </summary>
    /// <returns></returns>
    public static string? Write(string filePath, ParsedTrackMetadata metadata, out int? durationSeconds)
    {
        durationSeconds = null;
        var thumbnailPath = FindThumbnailSidecar(filePath);
        try
        {
            using var file = TagLib.File.Create(filePath);
            durationSeconds = (int)file.Properties.Duration.TotalSeconds;

            // Force ID3v2.3 for MP3 — broadest player compatibility
            if (file.TagTypes.HasFlag(TagTypes.Id3v2))
            {
                var id3v2 = (TagLib.Id3v2.Tag)file.GetTag(TagTypes.Id3v2, true);
                id3v2.Version = 3;
            }

            file.Tag.Title = metadata.Title;

            if (!string.IsNullOrWhiteSpace(metadata.Artist))
            {
                file.Tag.Performers = [metadata.Artist];
            }

            if (metadata.Album != null)
            {
                file.Tag.Album = metadata.Album;
            }

            if (metadata.TrackNumber.HasValue)
            {
                file.Tag.Track = metadata.TrackNumber.Value;
            }

            if (metadata.Year.HasValue)
            {
                file.Tag.Year = metadata.Year.Value;
            }

            if (metadata.Genre != null)
            {
                file.Tag.Genres = [metadata.Genre];
            }

            if (thumbnailPath != null)
            {
                try
                {
                    var picture = new Picture(thumbnailPath) { Type = PictureType.FrontCover };
                    file.Tag.Pictures = [picture];
                }
                catch (Exception ex)
                {
                    Log.Warning("Failed to embed thumbnail {Path}: {Message}", thumbnailPath, ex.Message);
                }
            }

            file.Save();

            // A file without an artist is a tagging problem even though the write succeeded —
            // surface it so it shows up in the tag error list instead of passing silently
            if (string.IsNullOrWhiteSpace(metadata.Artist))
            {
                return "No artist tag written — couldn't parse an artist from the title, and the uploader is unknown.";
            }

            return null;
        }
        catch (Exception ex)
        {
            Log.Warning("Tag writing failed for {File}: {Message}", filePath, ex.Message);
            return ex.Message;
        }
        finally
        {
            // The sidecar must go even when tagging fails — orphaned thumbnails
            // otherwise end up alongside the audio in the music folders
            if (thumbnailPath != null)
            {
                TryDelete(thumbnailPath);
            }
        }
    }

    private static string? FindThumbnailSidecar(string audioFilePath)
    {
        var stem = Path.Combine(
            Path.GetDirectoryName(audioFilePath) ?? string.Empty,
            Path.GetFileNameWithoutExtension(audioFilePath));

        foreach (var ext in ThumbnailExtensions)
        {
            var candidate = stem + ext;
            if (System.IO.File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static void TryDelete(string path)
    {
        try
        {
            System.IO.File.Delete(path);
        }
        catch (Exception ex)
        {
            Log.Warning("Could not delete thumbnail sidecar {Path}: {Message}", path, ex.Message);
        }
    }
}
