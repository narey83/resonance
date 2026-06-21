// <copyright file="BpmAnalysisController.cs" company="JP Dillingham">
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

namespace resonance.BpmAnalysis.API
{
    using System;
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    ///     BPM analysis — detect and manage BPM values for shared audio files.
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class BpmAnalysisController : ControllerBase
    {
        public BpmAnalysisController(IBpmAnalysisService bpmAnalysisService)
        {
            Bpm = bpmAnalysisService;
        }

        private IBpmAnalysisService Bpm { get; }

        /// <summary>Returns BPM status for all local audio files.</summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<TrackBpmInfo>), 200)]
        public IActionResult GetAll() => Ok(Bpm.GetAllTracksWithBpmStatus());

        /// <summary>Returns the current scan state.</summary>
        /// <returns></returns>
        [HttpGet("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(BpmScanState), 200)]
        public IActionResult GetScanState() => Ok(Bpm.ScanState);

        /// <summary>Starts a BPM analysis scan.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> StartScan([FromBody] BpmScanRequest request)
        {
            try
            {
                _ = Bpm.StartScanAsync(request ?? new BpmScanRequest());
                await Task.Yield();
                return Accepted();
            }
            catch (InvalidOperationException)
            {
                return Conflict("A BPM analysis scan is already in progress.");
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
            if (Bpm.CancelScan())
            {
                return NoContent();
            }

            return NotFound("No scan is in progress.");
        }

        /// <summary>Sets the BPM for a specific track.</summary>
        /// <returns></returns>
        [HttpPut("{maskedFilename}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        public IActionResult SetBpm(string maskedFilename, [FromBody] SetBpmRequest request)
        {
            if (request?.Bpm == null || request.Bpm == 0)
            {
                return BadRequest("BPM must be a positive integer.");
            }

            try
            {
                Bpm.SetBpm(maskedFilename, request.Bpm.Value);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Clears the BPM for a specific track.</summary>
        /// <returns></returns>
        [HttpDelete("{maskedFilename}/bpm")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public IActionResult ClearBpm(string maskedFilename)
        {
            try
            {
                Bpm.ClearBpm(maskedFilename);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }
    }

    /// <summary>Request body for setting BPM on a track.</summary>
    public record SetBpmRequest(uint? Bpm);
}
