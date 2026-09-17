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
        // A requested waveform size below this is raised to it; fewer bars stop reading as a waveform.
        private const int MinWaveformBars = 16;

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

        /// <summary>Resolves a library path to the masked filename the edit endpoints below take.</summary>
        /// <returns></returns>
        [HttpGet("masked")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public IActionResult GetMaskedFilename([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path is required");
            }

            var masked = Analysis.ResolveMaskedFilename(path);
            return masked == null ? NotFound() : Ok(new MaskedFilenameResponse(masked));
        }

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
                // StartScanAsync only claims the single analysis queue and hands the scan to a
                // background task, so awaiting it is quick. Discarding the task instead (as this used
                // to) lost its "already in progress" exception, answering 202 for a scan that never ran.
                // An analysis always measures key, BPM, loudness and waveform together; there is no
                // per-metric choice, so whatever a client asks for, the scan covers all four.
                await Analysis.StartScanAsync((request ?? new AnalysisScanRequest()) with { Metrics = AnalysisMetrics.All });
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

        /// <summary>Returns cached waveform band peaks for a local file.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("waveform")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(WaveformResponse), 200)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetWaveform(
            [FromQuery] string path, CancellationToken ct, [FromQuery] bool cachedOnly = false, [FromQuery] int? bars = null)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path is required");
            }

            // Accepts either an absolute path (the player has one) or the stored root-relative
            // form (library rows carry that), since both name the same track.
            var full = resonance.Common.MusicPath.ToAbsolute(path);
            if (!System.IO.File.Exists(full))
            {
                return NotFound();
            }

            // 204, not 404: the file is there, its analysis just hasn't been computed yet.
            // Clients poll this endpoint while a scan runs, and the browser logs every 4xx as a
            // failed request no matter how the caller handles it — a few seconds of decoding
            // buried the console (and, through the log relay, the server's own Browser context)
            // in errors that described nothing wrong. NotFound above still means what it says:
            // a path that names no file at all.
            var data = await Analysis.GetWaveformAsync(full, ct, cachedOnly);
            if (data == null)
            {
                return NoContent();
            }

            // Stored waveforms run to ~75k bars a track -- a few MB of JSON across the four bands. A
            // client drawing a small fixed width (the mobile seek bar) asks for a few hundred bars and
            // gets the same shape for a sliver of the transfer. Without `bars`, nothing changes.
            if (bars is int wanted && wanted > 0 && wanted < data.NumBars)
            {
                wanted = System.Math.Max(wanted, MinWaveformBars);
                data = data with
                {
                    NumBars = wanted,
                    OverallPeaks = WaveformResampler.Resample(data.OverallPeaks, wanted),
                    LowPeaks = WaveformResampler.Resample(data.LowPeaks, wanted),
                    MidPeaks = WaveformResampler.Resample(data.MidPeaks, wanted),
                    HighPeaks = WaveformResampler.Resample(data.HighPeaks, wanted),
                };
            }

            var beatInfo = Analysis.GetBeatInfo(full);
            return Ok(new WaveformResponse(
                data.NumBars, data.OverallPeaks, data.LowPeaks, data.MidPeaks, data.HighPeaks,
                beatInfo.BeatOffsetSeconds, beatInfo.Beats, beatInfo.DownbeatOffsetSeconds, beatInfo.DownbeatConfidence,
                data.DurationSeconds, data.SampleRate, data.WaveformVersion));
        }

        /// <summary>Returns cached EBU R128 loudness for a local file.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("loudness")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(LoudnessResponse), 200)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetLoudness([FromQuery] string path, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path is required");
            }

            var full = resonance.Common.MusicPath.ToAbsolute(path);
            if (!System.IO.File.Exists(full))
            {
                return NotFound();
            }

            // 204 rather than 404 when the track simply hasn't been analysed yet; see GetWaveform.
            var data = await Analysis.GetLoudnessAsync(full, ct);
            if (data == null)
            {
                return NoContent();
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
