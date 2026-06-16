// <copyright file="KeyAnalysisController.cs" company="JP Dillingham">
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

namespace resonance.KeyAnalysis.API
{
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    ///     Key analysis — detect and manage musical keys for shared audio files.
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class KeyAnalysisController : ControllerBase
    {
        public KeyAnalysisController(IKeyAnalysisService keyAnalysisService)
        {
            Keys = keyAnalysisService;
        }

        private IKeyAnalysisService Keys { get; }

        /// <summary>Returns key status for all local audio files.</summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<TrackKeyInfo>), 200)]
        public IActionResult GetAll() => Ok(Keys.GetAllTracksWithKeyStatus());

        /// <summary>Returns the current scan state.</summary>
        /// <returns></returns>
        [HttpGet("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(KeyScanState), 200)]
        public IActionResult GetScanState() => Ok(Keys.ScanState);

        /// <summary>Starts a key analysis scan.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> StartScan([FromBody] KeyScanRequest request)
        {
            try
            {
                _ = Keys.StartScanAsync(request ?? new KeyScanRequest());
                await Task.Yield();
                return Accepted();
            }
            catch (InvalidOperationException)
            {
                return Conflict("A key analysis scan is already in progress.");
            }
        }

        /// <summary>Cancels the current scan.</summary>
        /// <returns></returns>
        [HttpDelete("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult CancelScan()
        {
            if (Keys.CancelScan())
            {
                return NoContent();
            }

            return NotFound("No scan is in progress.");
        }

        /// <summary>Sets the key for a specific track.</summary>
        /// <returns></returns>
        [HttpPut("{maskedFilename}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        public IActionResult SetKey(string maskedFilename, [FromBody] SetKeyRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Key))
            {
                return BadRequest("Key is required.");
            }

            try
            {
                Keys.SetKey(maskedFilename, request.Key);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Clears the key for a specific track.</summary>
        /// <returns></returns>
        [HttpDelete("{maskedFilename}/key")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public IActionResult ClearKey(string maskedFilename)
        {
            try
            {
                Keys.ClearKey(maskedFilename);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }
    }

    /// <summary>Request body for setting a key on a track.</summary>
    public record SetKeyRequest(string Key);
}
