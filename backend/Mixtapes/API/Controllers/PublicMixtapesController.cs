// <copyright file="PublicMixtapesController.cs" company="John Narey">
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

namespace resonance.Mixtapes.API
{
    using System;
    using System.IO;
    using System.IO.Compression;
    using System.Linq;
    using System.Text;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.MusicLibrary;

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Route("api/v{version:apiVersion}/public/mixtapes")]
    [AllowAnonymous]
    public class PublicMixtapesController : ControllerBase
    {
        public PublicMixtapesController(IMixtapeService service, IMusicLibraryService library)
        {
            Service = service;
            Library = library;
        }

        private IMixtapeService Service { get; }

        private IMusicLibraryService Library { get; }

        [HttpGet("{token}")]
        [ProducesResponseType(typeof(Mixtape), 200)]
        [ProducesResponseType(404)]
        public IActionResult Get(string token)
        {
            var m = Service.GetByToken(token);
            return m == null ? NotFound() : Ok(m);
        }

        [HttpGet("{token}/artwork")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult GetArtwork(string token, [FromQuery] int? size)
        {
            var m = Service.GetByToken(token);
            if (m == null)
            {
                return NotFound();
            }

            var info = Service.GetArtworkInfo(m.Id, size);
            if (info == null)
            {
                return NotFound();
            }

            var file = new System.IO.FileInfo(info.Value.Path);
            Response.Headers.CacheControl = "private, max-age=0, must-revalidate";
            return new PhysicalFileResult(file.FullName, info.Value.ContentType)
            {
                LastModified = file.LastWriteTimeUtc,
                EntityTag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{file.LastWriteTimeUtc.Ticks:x}-{file.Length:x}\""),
            };
        }

        [HttpGet("{token}/export.m3u")]
        [Produces("audio/x-mpegurl")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult ExportM3u(string token)
        {
            var m = Service.GetByToken(token);
            if (m == null)
            {
                return NotFound();
            }

            var baseUrl = $"{Request.Scheme}://{Request.Host}/api/v0/public/mixtapes/{token}/tracks";
            var content = Service.BuildM3uContent(
                m.Tracks ?? [],
                t => $"{baseUrl}/{Uri.EscapeDataString(t.Id)}/download");
            var fileName = $"{SanitizeName(m.Name)}.m3u";
            return File(Encoding.UTF8.GetBytes(content), "audio/x-mpegurl", fileName);
        }

        [HttpGet("{token}/download.zip")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult DownloadZip(string token)
        {
            var m = Service.GetByToken(token);
            if (m == null)
            {
                return NotFound();
            }

            var tracks = (m.Tracks ?? []).Select(t => (Track: t, Path: ResolveTrack(t))).Where(t => t.Path != null).ToList();
            if (tracks.Count == 0)
            {
                return NotFound();
            }

            var safeName = SanitizeName(m.Name);

            // Build M3U content with relative paths so it works inside the zip
            var m3uSb = new StringBuilder("#EXTM3U\n");
            foreach (var (t, _) in tracks)
            {
                var dur = (int)(t.Duration ?? 0);
                var display = string.IsNullOrEmpty(t.Artist)
                    ? (t.Title ?? Path.GetFileNameWithoutExtension(t.FilePath))
                    : $"{t.Artist} - {t.Title}";
                m3uSb.AppendLine($"#EXTINF:{dur},{display}");
                m3uSb.AppendLine(Path.GetFileName(t.FilePath));
            }

            var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                // M3U playlist
                var m3uEntry = zip.CreateEntry($"{safeName}/{safeName}.m3u", CompressionLevel.NoCompression);
                using (var w = new StreamWriter(m3uEntry.Open(), Encoding.UTF8))
                {
                    w.Write(m3uSb.ToString());
                }

                // Audio files
                foreach (var (t, path) in tracks)
                {
                    var entryName = $"{safeName}/{Path.GetFileName(t.FilePath)}";
                    var entry = zip.CreateEntry(entryName, CompressionLevel.NoCompression);
                    using var src = System.IO.File.OpenRead(path);
                    using var dst = entry.Open();
                    src.CopyTo(dst);
                }
            }

            ms.Position = 0;
            return File(ms, "application/zip", $"{safeName}.zip");
        }

        [HttpGet("{token}/tracks/{trackId}/download")]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult DownloadTrack(string token, string trackId)
        {
            var m = Service.GetByToken(token);
            if (m == null)
            {
                return NotFound();
            }

            var track = m.Tracks?.FirstOrDefault(t => t.Id == trackId);
            var path = track == null ? null : ResolveTrack(track);
            if (path == null)
            {
                return NotFound();
            }

            var ext = Path.GetExtension(track.FilePath).ToLowerInvariant();
            var contentType = ext switch
            {
                ".mp3" => "audio/mpeg",
                ".flac" => "audio/flac",
                ".wav" => "audio/wav",
                ".ogg" => "audio/ogg",
                ".aac" => "audio/aac",
                ".m4a" => "audio/mp4",
                ".opus" => "audio/opus",
                _ => "application/octet-stream",
            };

            // Range processing on: players seek, and AVPlayer (iOS/Safari) refuses a stream without it.
            return PhysicalFile(path, contentType, Path.GetFileName(track.FilePath), enableRangeProcessing: true);
        }

        private static string SanitizeName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var safe = string.Concat(name.Select(c => invalid.Contains(c) ? '_' : c)).Trim();
            return safe is "" or "." or ".." ? "playlist" : safe;
        }

        private string ResolveTrack(MixtapeTrack track)
        {
            var path = Library.GetTrack(track.FilePath) == null ? null : Library.ResolveLibraryPath(track.FilePath);
            return System.IO.File.Exists(path) ? path : null;
        }
    }
}
