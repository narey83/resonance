// <copyright file="AnalysisController.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    ///     Audio analysis — BPM, musical key, waveform peaks and loudness for library tracks.
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    public class AnalysisController : ControllerBase
    {
        public AnalysisController(IAnalysisService analysisService)
        {
            Analysis = analysisService;
        }

        private IAnalysisService Analysis { get; }

        /// <summary>Returns the analysis status of all local audio files.</summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<TrackAnalysisInfo>), 200)]
        public IActionResult GetAll() => Ok(Analysis.GetAllTracks());

        /// <summary>Returns the current scan state.</summary>
        /// <returns></returns>
        [HttpGet("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(AnalysisScanState), 200)]
        public IActionResult GetScanState() => Ok(Analysis.ScanState);

        /// <summary>Starts an analysis scan for the requested metrics.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> StartScan([FromBody] AnalysisScanRequest request)
        {
            try
            {
                _ = Analysis.StartScanAsync(request ?? new AnalysisScanRequest());
                await Task.Yield();
                return Accepted();
            }
            catch (System.InvalidOperationException)
            {
                return Conflict("An analysis scan is already in progress.");
            }
        }

        /// <summary>Cancels the current scan.</summary>
        /// <returns></returns>
        [HttpDelete("scan")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult CancelScan() =>
            Analysis.CancelScan() ? NoContent() : NotFound("No scan is in progress.");

        /// <summary>Returns waveform band peaks for a local file, analysing it if not cached.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("waveform")]
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

            var data = await Analysis.GetWaveformAsync(path, path, ct);
            if (data == null)
            {
                return NotFound();
            }

            return Ok(new WaveformResponse(
                data.NumBars, data.OverallPeaks, data.LowPeaks, data.MidPeaks, data.HighPeaks));
        }

        /// <summary>Returns EBU R128 loudness for a local file, analysing it if not cached.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("loudness")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(LoudnessResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetLoudness([FromQuery] string path, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path is required");
            }

            if (!System.IO.File.Exists(path))
            {
                return NotFound();
            }

            var data = await Analysis.GetLoudnessAsync(path, path, ct);
            if (data == null)
            {
                return NotFound();
            }

            return Ok(new LoudnessResponse(data.IntegratedLufs, data.TruePeak, data.LoudnessRange));
        }

        /// <summary>Manually sets a track's BPM and/or key.</summary>
        /// <returns></returns>
        [HttpPut("{maskedFilename}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public IActionResult Set(string maskedFilename, [FromBody] SetAnalysisRequest request)
        {
            if (request == null || ((request.Bpm ?? 0) == 0 && string.IsNullOrWhiteSpace(request.Key)))
            {
                return BadRequest("A positive bpm and/or a key is required.");
            }

            try
            {
                if ((request.Bpm ?? 0) != 0)
                {
                    Analysis.SetBpm(maskedFilename, request.Bpm.Value);
                }

                if (!string.IsNullOrWhiteSpace(request.Key))
                {
                    Analysis.SetKey(maskedFilename, request.Key);
                }

                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Clears a track's BPM.</summary>
        /// <returns></returns>
        [HttpDelete("{maskedFilename}/bpm")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult ClearBpm(string maskedFilename)
        {
            try
            {
                Analysis.ClearBpm(maskedFilename);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Clears a track's key.</summary>
        /// <returns></returns>
        [HttpDelete("{maskedFilename}/key")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult ClearKey(string maskedFilename)
        {
            try
            {
                Analysis.ClearKey(maskedFilename);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }
    }
}
