// <copyright file="WaveformController.cs" company="JP Dillingham">
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

namespace resonance.WaveformAnalysis.API
{
    using System;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class WaveformController : ControllerBase
    {
        public WaveformController(IWaveformService waveformService)
        {
            Waveform = waveformService;
        }

        private IWaveformService Waveform { get; }

        /// <summary>Returns pre-computed (or on-demand computed) waveform data for a local file path.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(WaveformResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetWaveform([FromQuery] string path, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path is required");
            }

            if (!System.IO.File.Exists(path))
            {
                return NotFound();
            }

            var data = await Waveform.GetOrAnalyzeAsync(path, path, ct);
            if (data == null)
            {
                return NotFound();
            }

            return Ok(new WaveformResponse(
                data.NumBars,
                data.OverallPeaks,
                data.LowPeaks,
                data.MidPeaks,
                data.HighPeaks));
        }

        /// <summary>Returns the current scan state.</summary>
        /// <returns></returns>
        [HttpGet("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(WaveformScanState), 200)]
        public IActionResult GetScanState() => Ok(Waveform.ScanState);

        /// <summary>Starts a background waveform scan of all library tracks.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> StartScan([FromBody] WaveformScanRequest request)
        {
            try
            {
                _ = Waveform.StartScanAsync(request ?? new WaveformScanRequest());
                await Task.Yield();
                return Accepted();
            }
            catch (InvalidOperationException)
            {
                return Conflict("A waveform scan is already in progress.");
            }
        }

        /// <summary>Cancels the current scan.</summary>
        /// <returns></returns>
        [HttpDelete("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult CancelScan()
        {
            var cancelled = Waveform.CancelScan();
            return cancelled ? Ok() : NotFound("No scan is currently in progress.");
        }
    }
}
