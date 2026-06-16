// <copyright file="FilesController.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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

using Microsoft.Extensions.Options;

namespace resonance.Files.API
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel.DataAnnotations;
    using System.IO;
    using System.Linq;
    using System.Security;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Serilog;

    public record CreateDirectoryRequest(string Path);

    /// <summary>
    ///     Files.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class FilesController : ControllerBase
    {
        public FilesController(
            FileService fileService,
            IOptionsSnapshot<Options> optionsSnapshot)
        {
            Files = fileService;
            OptionsSnapshot = optionsSnapshot;
        }

        private FileService Files { get; }
        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private ILogger Log { get; set; } = Serilog.Log.ForContext("SourceContext", Logs.Files);

        /// <summary>
        ///     Streams a file from the downloads directory with HTTP range support.
        /// </summary>
        /// <param name="path">The relative path of the file within the downloads directory.</param>
        /// <returns></returns>
        /// <response code="200">The file content.</response>
        /// <response code="400">The path is missing or invalid.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">The path resolves outside the downloads directory.</response>
        /// <response code="404">The file was not found.</response>
        [HttpGet("downloads/stream")]
        [Authorize(Policy = AuthPolicy.Any)]
        [Produces("audio/mpeg", "audio/flac", "audio/ogg", "audio/wav", "audio/mp4", "audio/aac")]
        public IActionResult StreamDownloadFile([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("Path is required.");
            }

            var downloadsRoot = Path.GetFullPath(OptionsSnapshot.Value.Directories.Downloads);
            var localPath = Path.GetFullPath(Path.Combine(
                downloadsRoot,
                path.Replace('\\', Path.DirectorySeparatorChar)
                    .Replace('/', Path.DirectorySeparatorChar)
                    .TrimStart(Path.DirectorySeparatorChar)));

            if (!localPath.StartsWith(downloadsRoot + Path.DirectorySeparatorChar) && localPath != downloadsRoot)
            {
                return Forbid();
            }

            if (!System.IO.File.Exists(localPath))
            {
                return NotFound();
            }

            var extension = Path.GetExtension(localPath).TrimStart('.').ToLowerInvariant();
            var contentType = extension switch
            {
                "mp3" => "audio/mpeg",
                "flac" => "audio/flac",
                "ogg" => "audio/ogg",
                "wav" => "audio/wav",
                "m4a" => "audio/mp4",
                "aac" => "audio/aac",
                "opus" => "audio/ogg; codecs=opus",
                "aiff" or "aif" => "audio/aiff",
                _ => "audio/mpeg",
            };

            return PhysicalFile(localPath, contentType, enableRangeProcessing: true);
        }

        /// <summary>
        ///     Lists the contents of the downloads directory.
        /// </summary>
        /// <param name="recursive">An optional value indicating whether to recursively list subdirectories and files.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        [HttpGet("downloads/directories")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(FilesystemDirectory), 200)]
        [ProducesResponseType(401)]
        public Task<IActionResult> GetDownloadContentsAsync([FromQuery] bool recursive = false)
            => ListDirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Downloads, base64SubdirectoryName: null, recursive);

        /// <summary>
        ///     Lists the contents of the specified subdirectory within the downloads directory.
        /// </summary>
        /// <param name="base64SubdirectoryName">The relative, base 64 encoded, name of the subdirectory to list.</param>
        /// <param name="recursive">An optional value indicating whether to recursively list subdirectories and files.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpGet("downloads/directories/{base64SubdirectoryName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(FilesystemDirectory), 200)]
        [ProducesResponseType(401)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public Task<IActionResult> GetDownloadSubdirectoryContentsAsync([FromRoute] string base64SubdirectoryName, [FromQuery] bool recursive = false)
            => ListDirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Downloads, base64SubdirectoryName, recursive);

        /// <summary>
        ///     Deletes the specified subdirectory within the downloads directory.
        /// </summary>
        /// <param name="base64SubdirectoryName">The relative, base 64 encoded, name of the subdirectory to delete.</param>
        /// <returns></returns>
        /// <response code="204">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpDelete("downloads/directories/{base64SubdirectoryName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public Task<IActionResult> DeleteDownloadSubdirectoryAsync([FromRoute] string base64SubdirectoryName)
            => DeleteSubdirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Downloads, base64SubdirectoryName);

        /// <summary>
        ///     Deletes the specified file within the downloads directory.
        /// </summary>
        /// <param name="base64FileName">The relative, base 64 encoded, name of the file to delete.</param>
        /// <returns></returns>
        /// <response code="204">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpDelete("downloads/files/{base64FileName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public Task<IActionResult> DeleteDownloadFileAsync([FromRoute] string base64FileName)
            => DeleteFileAsync(rootDirectory: OptionsSnapshot.Value.Directories.Downloads, base64FileName);

        /// <summary>
        ///     Lists the contents of the downloads directory.
        /// </summary>
        /// <param name="recursive">An optional value indicating whether to recursively list subdirectories and files.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        [HttpGet("incomplete/directories")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(FilesystemDirectory), 200)]
        public Task<IActionResult> GetIncompleteContentsAsync([FromQuery] bool recursive = false)
            => ListDirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Incomplete, base64SubdirectoryName: null, recursive);

        /// <summary>
        ///     Lists the contents of the specified subdirectory within the incomplete directory.
        /// </summary>
        /// <param name="base64SubdirectoryName">The relative, base 64 encoded, name of the subdirectory to list.</param>
        /// <param name="recursive">An optional value indicating whether to recursively list subdirectories and files.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpGet("incomplete/directories/{base64SubdirectoryName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(FilesystemDirectory), 200)]
        public Task<IActionResult> GetIncompleteSubdirectoryContentsAsync([FromRoute, Required] string base64SubdirectoryName, [FromQuery] bool recursive = false)
            => ListDirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Incomplete, base64SubdirectoryName, recursive);

        /// <summary>
        ///     Deletes the specified subdirectory within the downloads directory.
        /// </summary>
        /// <param name="base64SubdirectoryName">The relative, base 64 encoded, name of the subdirectory to delete.</param>
        /// <returns></returns>
        /// <response code="204">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpDelete("incomplete/directories/{base64SubdirectoryName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public Task<IActionResult> DeleteIncompleteSubdirectoryAsync([FromRoute] string base64SubdirectoryName)
            => DeleteSubdirectoryAsync(rootDirectory: OptionsSnapshot.Value.Directories.Incomplete, base64SubdirectoryName);

        /// <summary>
        ///     Deletes the specified file within the downloads directory.
        /// </summary>
        /// <param name="base64FileName">The relative, base 64 encoded, name of the file to delete.</param>
        /// <returns></returns>
        /// <response code="204">The request completed successfully.</response>
        /// <response code="401">Authentication failed.</response>
        /// <response code="403">Access to the specified subdirectory was denied.</response>
        /// <response code="404">The specified subdirectory does not exist.</response>
        [HttpDelete("incomplete/files/{base64FileName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public Task<IActionResult> DeleteIncompleteFileAsync([FromRoute] string base64FileName)
            => DeleteFileAsync(rootDirectory: OptionsSnapshot.Value.Directories.Incomplete, base64FileName);

        /// <summary>
        ///     Browses subdirectories at an arbitrary path on the host filesystem.
        /// </summary>
        /// <returns></returns>
        [HttpGet("directories")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(401)]
        [ProducesResponseType(404)]
        public IActionResult BrowseDirectories([FromQuery] string path = "/")
        {
            try
            {
                path = Path.GetFullPath(path ?? "/");

                if (!Directory.Exists(path))
                {
                    return NotFound();
                }

                var parent = Directory.GetParent(path)?.FullName;

                var directories = new List<object>();
                try
                {
                    foreach (var dir in Directory.GetDirectories(path).OrderBy(d => Path.GetFileName(d), StringComparer.OrdinalIgnoreCase))
                    {
                        directories.Add(new { name = Path.GetFileName(dir), path = dir });
                    }
                }
                catch (UnauthorizedAccessException)
                {
                }

                return Ok(new { path, parent, directories });
            }
            catch (UnauthorizedAccessException)
            {
                return Forbid();
            }
            catch (DirectoryNotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>
        ///     Creates a new directory at the specified path.
        /// </summary>
        /// <returns></returns>
        [HttpPost("directories")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(401)]
        [ProducesResponseType(403)]
        public IActionResult CreateDirectory([FromBody] CreateDirectoryRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Path))
            {
                return BadRequest("Path is required.");
            }

            try
            {
                var path = Path.GetFullPath(request.Path);
                Directory.CreateDirectory(path);
                return Ok(new { path });
            }
            catch (UnauthorizedAccessException)
            {
                return Forbid();
            }
            catch (Exception ex)
            {
                return BadRequest(ex.Message);
            }
        }

        private async Task<IActionResult> ListDirectoryAsync(string rootDirectory, string base64SubdirectoryName = null, bool recursive = false)
        {
            var requestedDir = (base64SubdirectoryName ?? string.Empty)
                .FromBase64()
                .Replace('\\', Path.DirectorySeparatorChar)
                .Replace('/', Path.DirectorySeparatorChar);

            requestedDir = Path.GetFullPath(Path.Combine(rootDirectory, requestedDir));

            Log.Debug("Listing directory '{Directory}'", requestedDir);

            try
            {
                var response = await Files.ListContentsAsync(
                    directory: requestedDir,
                    enumerationOptions: new EnumerationOptions
                    {
                        AttributesToSkip = FileAttributes.System,
                        RecurseSubdirectories = recursive,
                    });

                return Ok(response);
            }
            catch (SecurityException)
            {
                Log.Warning("Directory listing of '{Directory}' forbidden", requestedDir);
                return Forbid();
            }
            catch (NotFoundException)
            {
                Log.Debug("Directory '{Directory}' not found", requestedDir);
                return NotFound();
            }
        }

        private async Task<IActionResult> DeleteSubdirectoryAsync(string rootDirectory, string base64SubdirectoryName)
        {
            if (!OptionsSnapshot.Value.RemoteFileManagement)
            {
                return Forbid();
            }

            var requestedDir = base64SubdirectoryName
                .FromBase64()
                .Replace('\\', Path.DirectorySeparatorChar)
                .Replace('/', Path.DirectorySeparatorChar)
                .TrimStart(Path.DirectorySeparatorChar);

            requestedDir = Path.GetFullPath(Path.Combine(rootDirectory, requestedDir));

            Log.Information("Deleting directory '{Directory}'", requestedDir);

            try
            {
                var results = await Files.DeleteDirectoriesAsync(requestedDir);

                return results[requestedDir].Match(
                    success => NoContent(),
                    failure => throw failure);
            }
            catch (SecurityException)
            {
                Log.Warning("Directory deletion of '{Directory}' forbidden", requestedDir);
                return Forbid();
            }
            catch (NotFoundException)
            {
                Log.Information("Directory '{Directory}' not found", requestedDir);
                return NotFound();
            }
        }

        private async Task<IActionResult> DeleteFileAsync(string rootDirectory, string base64FileName)
        {
            if (!OptionsSnapshot.Value.RemoteFileManagement)
            {
                return Forbid();
            }

            var requestedFilename = base64FileName
                .FromBase64()
                .Replace('\\', Path.DirectorySeparatorChar)
                .Replace('/', Path.DirectorySeparatorChar)
                .TrimStart(Path.DirectorySeparatorChar);

            requestedFilename = Path.GetFullPath(Path.Combine(rootDirectory, requestedFilename));

            Log.Information("Deleting file '{File}'", requestedFilename);

            try
            {
                var results = await Files.DeleteFilesAsync(requestedFilename);

                return results[requestedFilename].Match(
                    success => NoContent(),
                    failure => throw failure);
            }
            catch (SecurityException)
            {
                Log.Warning("File deletion of '{File}' forbidden", requestedFilename);
                return Forbid();
            }
            catch (NotFoundException)
            {
                Log.Information("File '{File}' not found", requestedFilename);
                return NotFound();
            }
        }
    }
}
