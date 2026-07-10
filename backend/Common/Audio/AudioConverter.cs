// <copyright file="AudioConverter.cs" company="John Narey">
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

namespace resonance.Common.Audio;

using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

/// <summary>
///     Shared ffmpeg-backed audio transcoding helpers used by the yt-dlp integration and the
///     library converter. Pure mapping helpers plus a single-file conversion runner.
/// </summary>
public static class AudioConverter
{
    /// <summary>
    ///     Maps a target format to its file extension and the ffmpeg codec arguments to produce it.
    ///     mp3 honours the supplied quality (libmp3lame VBR 0=best..9=worst); other formats use sane
    ///     fixed defaults. Returns null for formats we do not transcode to.
    /// </summary>
    /// <returns></returns>
    public static (string Extension, Func<int, string> CodecArgs)? FormatSpec(string? format)
        => (format ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "mp3" => ("mp3", (Func<int, string>)(q => $"-c:a libmp3lame -q:a {Math.Clamp(q, 0, 9)}")),
            "flac" => ("flac", _ => "-c:a flac"),
            "wav" => ("wav", _ => "-c:a pcm_s16le"),
            "opus" => ("opus", _ => "-c:a libopus -b:a 192k"),
            "m4a" => ("m4a", _ => "-c:a aac -b:a 256k"),
            "aac" => ("m4a", _ => "-c:a aac -b:a 256k"),
            "ogg" => ("ogg", _ => "-c:a libvorbis -q:a 6"),
            _ => null,
        };

    /// <summary>
    ///     Whether the given format is one we can actually transcode to. "best"/"none"/empty are
    ///     treated as "no conversion" and therefore return false.
    /// </summary>
    /// <returns></returns>
    public static bool IsConvertibleTarget(string? format)
        => !string.IsNullOrWhiteSpace(format)
            && !format.Equals("none", StringComparison.OrdinalIgnoreCase)
            && !format.Equals("best", StringComparison.OrdinalIgnoreCase)
            && FormatSpec(format) != null;

    /// <summary>
    ///     Whether a file would change format under the given target (i.e. its current extension
    ///     differs from the target's). Already-target files return false (nothing to do).
    /// </summary>
    /// <returns></returns>
    public static bool NeedsConversion(string? filePath, string? targetFormat)
    {
        var spec = FormatSpec(targetFormat);
        if (string.IsNullOrEmpty(filePath) || spec == null)
        {
            return false;
        }

        var currentExt = Path.GetExtension(filePath).TrimStart('.');
        return !string.Equals(currentExt, spec.Value.Extension, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    ///     Transcodes <paramref name="sourcePath"/> to a sibling file with the target format's
    ///     extension. On success the original is left in place (the caller decides whether to
    ///     replace it) and the new path is returned; on failure any partial output is removed.
    ///     Throws <see cref="OperationCanceledException"/> if cancelled.
    /// </summary>
    /// <returns>A <see cref="ConversionResult"/> describing the outcome.</returns>
    public static async Task<ConversionResult> ConvertAsync(string ffmpegPath, string sourcePath, string targetFormat, int quality = 2, CancellationToken cancellationToken = default)
    {
        var spec = FormatSpec(targetFormat);
        if (spec == null || !File.Exists(sourcePath))
        {
            return new ConversionResult(false, null, "source missing or unsupported target format");
        }

        var dest = Path.ChangeExtension(sourcePath, spec.Value.Extension);
        if (string.Equals(sourcePath, dest, StringComparison.OrdinalIgnoreCase))
        {
            return new ConversionResult(false, null, "file is already in the target format");
        }

        // Ogg-family sources (opus/ogg) carry their vorbis comments on the audio stream, not the
        // container, so global metadata alone arrives empty — map both. An empty stream-level
        // source does not clobber container tags, so this is safe for flac/mp3 inputs too.
        var metadataArgs = "-map_metadata 0 -map_metadata 0:s:a:0";

        // Targets whose muxer supports attached pictures get the (optional) embedded cover
        // carried through as jpeg; the rest stay audio-only. Sources are audio files, so any
        // video stream present is cover art rather than actual video.
        var artworkArgs = spec.Value.Extension switch
        {
            "mp3" => "-map 0:a -map 0:v? -c:v mjpeg -disposition:v:0 attached_pic -id3v2_version 3",
            "flac" or "m4a" => "-map 0:a -map 0:v? -c:v mjpeg -disposition:v:0 attached_pic",
            _ => "-vn",
        };

        var args = $"-y -loglevel error -i \"{sourcePath}\" {artworkArgs} {metadataArgs} {spec.Value.CodecArgs(quality)} \"{dest}\"";

        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo(ffmpegPath)
                {
                    Arguments = args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardError = true,
                },
            };

            process.Start();
            var stderr = await process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);

            if (process.ExitCode == 0 && File.Exists(dest))
            {
                return new ConversionResult(true, dest, null);
            }

            TryDelete(dest);
            return new ConversionResult(false, null, string.IsNullOrWhiteSpace(stderr) ? $"ffmpeg exited {process.ExitCode}" : stderr.Trim());
        }
        catch (OperationCanceledException)
        {
            TryDelete(dest);
            throw;
        }
        catch (Exception ex)
        {
            TryDelete(dest);
            return new ConversionResult(false, null, ex.Message);
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // best-effort cleanup of a partial/failed output
        }
    }

    /// <summary>
    ///     The result of a single-file conversion attempt.
    /// </summary>
    public readonly record struct ConversionResult(bool Success, string? DestinationPath, string? Error);
}
