// <copyright file="AnalysisImportsController.cs" company="John Narey">
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

namespace resonance.Analysis.API
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Security.Cryptography;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Analysis.Imports;
    using resonance.Common;

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Route("api/v{version:apiVersion}/analysis/imports")]
    [Authorize(Policy = AuthPolicy.FeatureLibrary)]
    public class AnalysisImportsController : ControllerBase
    {
        public AnalysisImportsController(IAnalysisService analysis, IImportedAnalysisStore store)
        {
            Analysis = analysis;
            Store = store;
        }

        private IAnalysisService Analysis { get; }
        private IImportedAnalysisStore Store { get; }

        [HttpPost("preview")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        [RequestSizeLimit(16 * 1024 * 1024)]
        public async Task<IActionResult> Preview([FromBody] ImportAnalysisRequest request, CancellationToken ct)
            => await Import(request, false, ct);

        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        [RequestSizeLimit(16 * 1024 * 1024)]
        public async Task<IActionResult> Commit([FromBody] ImportAnalysisRequest request, CancellationToken ct)
            => await Import(request, true, ct);

        [HttpGet("sources")]
        public async Task<IActionResult> Sources([FromQuery] string path, CancellationToken ct)
        {
            try
            {
                var resolved = ResolveLibraryPath(path);
                return Ok(await Store.List(MusicPath.ToRelative(resolved), ct));
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
        }

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] string collectionSha256, [FromQuery] string path, CancellationToken ct)
        {
            if (!ImportedAnalysisContract.IsSha256(collectionSha256) || string.IsNullOrWhiteSpace(path))
            {
                return BadRequest();
            }

            try
            {
                var match = await Match(path, ct);
                var snapshot = await Store.Get(collectionSha256, MusicPath.ToRelative(match.Path), ct);
                if (snapshot == null)
                {
                    return NotFound();
                }

                using var document = JsonDocument.Parse(snapshot.ExportJson);
                return Ok(new
                {
                    sourceKind = "rekordbox",
                    sourceTrust = "user-supplied-export",
                    collectionSha256,
                    sourceXmlSha256 = snapshot.SourceXmlSha256,
                    documentSha256 = snapshot.DocumentSha256,
                    allowedEndOverrunSeconds = snapshot.AllowedEndOverrunSeconds,
                    contentCurrent = match.Sha256 == snapshot.AudioSha256 && match.Bytes == snapshot.AudioBytes,
                    analysis = document.RootElement.Clone(),
                });
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (IOException)
            {
                return Conflict(new { status = "audio-unavailable" });
            }
        }

        private string ResolveLibraryPath(string suppliedPath)
        {
            if (string.IsNullOrWhiteSpace(suppliedPath))
            {
                throw new ArgumentException("Library path is required.");
            }

            var path = ImportedAnalysisContract.RequireLibraryPath(MusicPath.Root, suppliedPath);
            if (Analysis.ResolveMaskedFilename(path) == null)
            {
                throw new ArgumentException("Track is not indexed in the local share.");
            }

            return path;
        }

        private async Task<(string Path, string Sha256, long Bytes)> Match(string suppliedPath, CancellationToken ct)
        {
            var path = ResolveLibraryPath(suppliedPath);

            await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true);
            var length = file.Length;
            var digest = Convert.ToHexString(await SHA256.HashDataAsync(file, ct)).ToLowerInvariant();
            if (file.Length != length)
            {
                throw new IOException("Audio file changed while hashing.");
            }

            return (path, digest, length);
        }

        private async Task<IActionResult> Import(ImportAnalysisRequest request, bool commit, CancellationToken ct)
        {
            try
            {
                var snapshot = ImportedAnalysisContract.Validate(request);
                var match = await Match(request.LibraryPath, ct);
                if (snapshot.AudioSha256 != match.Sha256 || snapshot.AudioBytes != match.Bytes)
                {
                    return Conflict(new { status = "audio-mismatch", message = "Library file bytes do not match source export." });
                }

                var relative = MusicPath.ToRelative(match.Path);
                var existing = await Store.Get(request.CollectionSha256, relative, ct);
                if (existing != null && (existing.DocumentSha256 != snapshot.DocumentSha256
                    || existing.AllowedEndOverrunSeconds != request.AllowedEndOverrunSeconds
                    || existing.SourceXmlSha256 != request.SourceXmlSha256.ToLowerInvariant()))
                {
                    return Conflict(new { status = "existing-snapshot-preserved" });
                }

                var status = existing != null ? "already-imported" : "ready";
                if (commit && existing == null)
                {
                    if (await Store.Insert(request.CollectionSha256, relative, snapshot, request.AllowedEndOverrunSeconds, request.SourceXmlSha256, ct))
                    {
                        status = "imported";
                    }
                    else
                    {
                        existing = await Store.Get(request.CollectionSha256, relative, ct);
                        if (existing == null || existing.DocumentSha256 != snapshot.DocumentSha256
                            || existing.AllowedEndOverrunSeconds != request.AllowedEndOverrunSeconds
                    || existing.SourceXmlSha256 != request.SourceXmlSha256.ToLowerInvariant())
                        {
                            return Conflict(new { status = "concurrent-snapshot-preserved" });
                        }

                        status = "already-imported";
                    }
                }

                return Ok(new
                {
                    status,
                    libraryPath = relative,
                    sourceTrackId = snapshot.TrackId,
                    sourceKind = "rekordbox",
                    sourceTrust = "user-supplied-export",
                    audioSha256 = match.Sha256,
                    documentSha256 = snapshot.DocumentSha256,
                    nativeAnalysisChanged = false,
                    tagsChanged = false,
                });
            }
            catch (Exception exception) when (exception is ArgumentException || exception is JsonException
                || exception is InvalidOperationException || exception is KeyNotFoundException || exception is FormatException
                || exception is OverflowException)
            {
                return BadRequest(new { status = "invalid-import", message = exception.Message });
            }
            catch (IOException exception)
            {
                return Conflict(new { status = "audio-unavailable", message = exception.Message });
            }
        }
    }
}
