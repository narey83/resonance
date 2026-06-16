// <copyright file="TagsController.cs" company="JP Dillingham">
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

namespace resonance.Shares.API
{
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Transfers;
    using resonance.Transfers.Uploads;

    /// <summary>
    ///     ID3 tag editor.
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class TagsController : ControllerBase
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="TagsController"/> class.
        /// </summary>
        public TagsController(IShareService shareService, IUploadService uploadService)
        {
            Shares = shareService;
            Uploads = uploadService;
        }

        private IShareService Shares { get; }
        private IUploadService Uploads { get; }

        /// <summary>
        ///     Returns the list of shared files that have tag metadata.
        /// </summary>
        /// <response code="200">The request completed successfully.</response>
        /// <returns></returns>
        [HttpGet("tagged")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<TaggedFile>), 200)]
        public IActionResult GetTagged()
        {
            return Ok(Shares.GetTaggedFiles());
        }

        /// <summary>
        ///     Returns the list of shared files that have no tag metadata.
        /// </summary>
        /// <response code="200">The request completed successfully.</response>
        /// <returns></returns>
        [HttpGet("untagged")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<UntaggedFile>), 200)]
        public IActionResult GetUntagged()
        {
            return Ok(Shares.GetUntaggedFiles());
        }

        /// <summary>
        ///     Writes tag data to the specified file and updates the share cache.
        /// </summary>
        /// <param name="maskedFilename">The masked filename identifying the file.</param>
        /// <param name="tags">The tag data to write.</param>
        /// <response code="204">Tags written successfully.</response>
        /// <response code="400">The request body is invalid.</response>
        /// <response code="404">The file was not found in the share cache.</response>
        /// <response code="422">The file could not be opened or the format is unsupported.</response>
        /// <returns></returns>
        [HttpPut("{maskedFilename}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        [ProducesResponseType(422)]
        public IActionResult WriteTags(string maskedFilename, [FromBody] FileTags tags)
        {
            if (tags == null)
            {
                return BadRequest("Tag data is required");
            }

            try
            {
                Shares.WriteFileTags(maskedFilename, tags);
                return StatusCode(204);
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (IOException ex)
            {
                return UnprocessableEntity($"Could not write tags: {ex.Message}");
            }
            catch (TagLib.UnsupportedFormatException ex)
            {
                return UnprocessableEntity($"Unsupported format: {ex.Message}");
            }
        }

        /// <summary>
        ///     Renames a directory on the filesystem and updates the share cache.
        /// </summary>
        /// <param name="request">The rename request containing the masked directory and new leaf name.</param>
        /// <response code="204">Directory renamed successfully.</response>
        /// <response code="400">The request is invalid.</response>
        /// <response code="404">The directory was not found in the share cache.</response>
        /// <response code="409">The directory has active uploads and cannot be renamed.</response>
        /// <returns></returns>
        [HttpPost("directories/rename")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult RenameDirectory([FromBody] RenameDirectoryRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.MaskedDirectory) || string.IsNullOrWhiteSpace(request.NewName))
            {
                return BadRequest("MaskedDirectory and NewName are required");
            }

            if (request.NewName.IndexOfAny(['/', '\\']) >= 0)
            {
                return BadRequest("NewName must not contain path separators");
            }

            var prefix = request.MaskedDirectory + '\\';
            var activeUploads = Uploads.List(
                t => !t.Removed && t.Filename.StartsWith(prefix) && !TransferStateCategories.Completed.Contains(t.State),
                includeRemoved: false);

            if (activeUploads.Count > 0)
            {
                return Conflict($"Directory has {activeUploads.Count} active upload{(activeUploads.Count == 1 ? string.Empty : "s")} and cannot be renamed");
            }

            try
            {
                Shares.RenameDirectory(request.MaskedDirectory, request.NewName);
                return StatusCode(204);
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (IOException ex)
            {
                return UnprocessableEntity($"Could not rename directory: {ex.Message}");
            }
        }
    }

    public record RenameDirectoryRequest(string MaskedDirectory, string NewName);
}
