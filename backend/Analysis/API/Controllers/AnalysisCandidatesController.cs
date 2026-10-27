// <copyright file="AnalysisCandidatesController.cs" company="John Narey">
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
    using System.IO;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Analysis.Candidates;

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Route("api/v{version:apiVersion}/analysis/candidates")]
    [Authorize(Policy = AuthPolicy.FeatureLibrary)]
    public class AnalysisCandidatesController : ControllerBase
    {
        public AnalysisCandidatesController(CandidateAnalysisService candidates) => Candidates = candidates;

        private CandidateAnalysisService Candidates { get; }

        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public async Task<IActionResult> Analyze([FromBody] CandidateAnalysisRequest request, CancellationToken ct)
        {
            try
            {
                var job = await Candidates.Analyze(request, ct);
                return Ok(new { job, sourceKind = "independent-candidate", existingAnalysisChanged = false });
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (InvalidOperationException exception)
            {
                return StatusCode(503, exception.Message);
            }
            catch (IOException)
            {
                return Conflict("Source audio is unavailable.");
            }
        }

        [HttpGet]
        public async Task<IActionResult> List([FromQuery] string path, CancellationToken ct)
        {
            try
            {
                return Ok(new { enabled = Candidates.Enabled, jobs = await Candidates.List(path, ct) });
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (InvalidOperationException)
            {
                return Ok(new { enabled = false, jobs = Array.Empty<CandidateJob>() });
            }
        }

        [HttpGet("enhanced")]
        public async Task<IActionResult> Enhanced([FromQuery] string path, CancellationToken ct)
        {
            try
            {
                var result = await Candidates.LatestEnhanced(path, ct);
                if (result == null)
                {
                    return Ok(new { available = false, enabled = Candidates.Enabled });
                }

                var features = result.Value.Analysis.GetProperty("features");
                var beats = features.GetProperty("beats").GetProperty("result");
                var phrases = features.GetProperty("semanticPhrases").GetProperty("result");
                var voice = features.GetProperty("vocalPresence").GetProperty("result");
                return Ok(new
                {
                    available = true, jobId = result.Value.Job.JobId, source = "independent-enhanced", experimental = true,
                    durationSeconds = result.Value.Analysis.GetProperty("durationSeconds"),
                    beats = beats.GetProperty("beats_seconds"), downbeats = beats.GetProperty("downbeats_seconds"),
                    musicalPhrases = phrases.GetProperty("segments"),
                    djPhrases = phrases.TryGetProperty("djStructure", out var dj) ? dj.GetProperty("segments") : default(System.Text.Json.JsonElement?),
                    djPhraseAnalysis = phrases.TryGetProperty("djStructure", out var arrangement) ? new
                    {
                        revision = arrangement.TryGetProperty("revision", out var revision) ? revision.GetString() : null,
                        automatic = arrangement.TryGetProperty("automatic", out var automatic) && automatic.ValueKind == System.Text.Json.JsonValueKind.True,
                        genreContext = arrangement.TryGetProperty("genreContext", out var context) ? context : default(System.Text.Json.JsonElement?),
                        diagnostics = arrangement.TryGetProperty("boundaryDiagnostics", out var diagnostics) ? diagnostics : default(System.Text.Json.JsonElement?),
                    }
                    : null,
                    singing = voice.GetProperty("segments"),
                    processedVoice = voice.TryGetProperty("processedVoice", out var speech) && speech.TryGetProperty("sustainedSegments", out var spans) ? spans : default(System.Text.Json.JsonElement?),
                    cues = features.TryGetProperty("cues", out var cues) && cues.TryGetProperty("result", out var cueResult) ? cueResult : default(System.Text.Json.JsonElement?),
                    genre = features.GetProperty("genre").GetProperty("result"),
                });
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (IOException)
            {
                return Ok(new { available = false, enabled = Candidates.Enabled });
            }
        }

        [HttpGet("{jobId}")]
        public async Task<IActionResult> Read(string jobId, CancellationToken ct)
        {
            try
            {
                var result = await Candidates.Read(jobId, ct);
                return Ok(new { job = result.Job, analysis = result.Analysis, contentCurrent = result.ContentCurrent });
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (InvalidOperationException exception)
            {
                return StatusCode(503, exception.Message);
            }
            catch (IOException)
            {
                return Conflict("Candidate source audio is unavailable.");
            }
        }
    }
}
