// <copyright file="YtDlpController.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp.API.Controllers;

using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using resonance;

[Route("api/v{version:apiVersion}/ytdlp")]
[ApiVersion("0")]
[Produces("application/json")]
[Authorize(Policy = AuthPolicy.Any)]
public class YtDlpController : ControllerBase
{
    public YtDlpController(IYtDlpService service)
    {
        Service = service;
    }

    private IYtDlpService Service { get; }

    // ── Jobs ────────────────────────────────────────────────────────────────
    [HttpGet("jobs")]
    public IActionResult ListJobs() => Ok(Service.ListJobs());

    [HttpPost("jobs")]
    [Consumes("application/json")]
    public async Task<IActionResult> SubmitJob([FromBody] SubmitJobRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Url))
        {
            return BadRequest("url is required");
        }

        var job = await Service.SubmitAsync(request.Url, request.OutputDirectory, request.AudioFormat, request.AudioQuality, request.DefaultGenre, request.MinTrackDurationSeconds, request.MaxTrackDurationSeconds, request.ConvertOnCompletionFormat, cancellationToken);
        return Ok(job);
    }

    [HttpGet("jobs/{jobId:guid}/tracks")]
    public async Task<IActionResult> GetTracks(Guid jobId)
    {
        var tracks = await Service.GetTracksAsync(jobId);
        return Ok(tracks);
    }

    [HttpGet("tag-errors")]
    public async Task<IActionResult> GetTagErrors()
    {
        var tracks = await Service.GetTagErrorTracksAsync();
        return Ok(tracks);
    }

    [HttpDelete("jobs/{jobId:guid}")]
    public async Task<IActionResult> RemoveJob(Guid jobId)
    {
        await Service.RemoveJobAsync(jobId);
        return NoContent();
    }

    [HttpPost("jobs/{jobId:guid}/cancel")]
    public async Task<IActionResult> CancelJob(Guid jobId)
    {
        await Service.CancelJobAsync(jobId);
        return NoContent();
    }

    [HttpPost("jobs/{jobId:guid}/pause")]
    public async Task<IActionResult> PauseJob(Guid jobId)
    {
        await Service.PauseJobAsync(jobId);
        return NoContent();
    }

    [HttpPost("jobs/{jobId:guid}/resume")]
    public async Task<IActionResult> ResumeJob(Guid jobId)
    {
        await Service.ResumeJobAsync(jobId);
        return NoContent();
    }

    [HttpPost("jobs/{jobId:guid}/retry-failed")]
    public async Task<IActionResult> RetryFailed(Guid jobId)
    {
        await Service.RetryFailedTracksAsync(jobId);
        return NoContent();
    }

    [HttpPost("jobs/{jobId:guid}/reconcile")]
    public async Task<IActionResult> ReconcileJob(Guid jobId)
    {
        await Service.ReconcileJobAsync(jobId);
        return NoContent();
    }

    // ── Tracks ──────────────────────────────────────────────────────────────
    [HttpDelete("tracks/{trackId:guid}")]
    public async Task<IActionResult> CancelTrack(Guid trackId)
    {
        await Service.CancelTrackAsync(trackId);
        return NoContent();
    }

    [HttpPost("tracks/{trackId:guid}/retry-tags")]
    public async Task<IActionResult> RetryTags(Guid trackId)
    {
        await Service.RetryTagWritingAsync(trackId);
        return NoContent();
    }

    // ── Search ──────────────────────────────────────────────────────────────
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string q,
        [FromQuery] int limit = 25,
        [FromQuery] string? type = null,
        [FromQuery] string? duration = null,
        [FromQuery] string? uploadDate = null,
        [FromQuery] string? sort = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(q))
        {
            return BadRequest("q is required");
        }

        limit = Math.Clamp(limit, 1, 50);
        var results = await Service.SearchAsync(q, limit, type, duration, uploadDate, sort, cancellationToken);
        return Ok(results);
    }

    // ── Versions ─────────────────────────────────────────────────────────────
    [HttpGet("versions")]
    public async Task<IActionResult> GetVersions(CancellationToken cancellationToken)
    {
        var (ytdlp, ffmpeg) = await Service.GetVersionsAsync(cancellationToken);
        return Ok(new { ytDlp = ytdlp, ffmpeg });
    }

    [HttpGet("update-check")]
    public async Task<IActionResult> CheckForUpdate(CancellationToken cancellationToken)
    {
        var (current, latest, updateAvailable) = await Service.CheckForUpdateAsync(cancellationToken);
        return Ok(new { current, latest, updateAvailable });
    }

    [HttpPost("update")]
    public async Task<IActionResult> Update(CancellationToken cancellationToken)
    {
        try
        {
            var newVersion = await Service.UpdateYtDlpAsync(cancellationToken);
            return Ok(new { version = newVersion });
        }
        catch (Exception ex)
        {
            return StatusCode(500, ex.Message);
        }
    }

    [HttpPost("backfill-durations")]
    public async Task<IActionResult> BackfillDurations(CancellationToken cancellationToken)
    {
        var (updated, failed, skipped) = await Service.BackfillDurationsAsync(cancellationToken);
        return Ok(new { updated, failed, skipped });
    }

    // ── Cookies ─────────────────────────────────────────────────────────────
    [HttpGet("cookies")]
    public IActionResult GetCookieStatus()
    {
        var cookiePath = Path.Combine(resonance.Program.AppDirectory, "ytdlp-cookies.txt");
        if (!System.IO.File.Exists(cookiePath))
        {
            return Ok(new { present = false, uploadedAt = (DateTime?)null });
        }

        var uploadedAt = System.IO.File.GetLastWriteTimeUtc(cookiePath);
        return Ok(new { present = true, uploadedAt });
    }

    [HttpPost("cookies")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> UploadCookies(IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest("No file provided");
        }

        string content;
        using (var reader = new StreamReader(file.OpenReadStream()))
        {
            content = await reader.ReadToEndAsync(cancellationToken);
        }

        // yt-dlp requires Netscape format: comment lines plus tab-separated cookie lines.
        // An invalid file silently breaks every search and download, so reject it here.
        var hasCookieLine = content
            .Split('\n')
            .Any(line => !line.StartsWith('#') && line.Split('\t').Length >= 7);

        if (!hasCookieLine)
        {
            return BadRequest("Not a Netscape-format cookies file. Export with a \"Get cookies.txt\"-style browser extension and upload that file.");
        }

        // Write to a temp file first so an aborted upload can't leave a broken cookie file behind
        var cookiePath = Path.Combine(resonance.Program.AppDirectory, "ytdlp-cookies.txt");
        var tempPath = cookiePath + ".tmp";
        await System.IO.File.WriteAllTextAsync(tempPath, content, cancellationToken);
        System.IO.File.Move(tempPath, cookiePath, overwrite: true);

        return Ok(new { present = true, uploadedAt = DateTime.UtcNow });
    }

    [HttpDelete("cookies")]
    public IActionResult DeleteCookies()
    {
        var cookiePath = Path.Combine(resonance.Program.AppDirectory, "ytdlp-cookies.txt");
        if (System.IO.File.Exists(cookiePath))
        {
            System.IO.File.Delete(cookiePath);
        }

        return NoContent();
    }
}

public record SubmitJobRequest(
    string Url,
    string? OutputDirectory,
    string? AudioFormat,
    int? AudioQuality,
    string? DefaultGenre,
    int? MinTrackDurationSeconds,
    int? MaxTrackDurationSeconds,
    string? ConvertOnCompletionFormat);
