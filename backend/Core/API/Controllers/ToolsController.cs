// <copyright file="ToolsController.cs" company="John Narey">
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

namespace resonance.Core.API;

using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance.Common;
using resonance.Common.Ffmpeg;
using Resonance.Integrations.YtDlp;

/// <summary>Administrator access to managed media dependencies.</summary>
[ApiController]
[ApiVersion("0")]
[Route("api/v{version:apiVersion}/tools")]
[Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
public sealed class ToolsController(IYtDlpService youtube, IFfmpegService ffmpeg, IHttpClientFactory clients) : ControllerBase
{
    private static string BgutilRequirements => ManagedBgutil.IsBundled
        ? "Update the backend image to upgrade the bundled bgutil provider and plugin."
        : "Native installation requires Node.js 22 or newer, npm and git on the backend PATH.";

    [HttpGet]
    public async Task<IActionResult> Get(bool check = false, CancellationToken cancellationToken = default)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var rows = new List<ToolStatus>();
        foreach (var id in new[] { "ytdlp", "ffmpeg", "deno", "bgutil" })
        {
            try
            {
                rows.Add(await Status(id, check, deadline.Token));
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }

                rows.Add(new(id, Name(id), null, null, id != "bgutil" || ManagedBgutil.CanUpdate, null, "Version check unavailable. Retry when the server has network access."));
            }
        }

        return Ok(rows);
    }

    [HttpPost("{id}/update")]
    public async Task<IActionResult> Update(string id, CancellationToken cancellationToken)
    {
        if (id is not ("ytdlp" or "ffmpeg" or "deno" or "bgutil"))
        {
            return BadRequest(new { message = "Unknown managed tool." });
        }

        if (id == "bgutil" && !ManagedBgutil.CanUpdate)
        {
            return BadRequest(new { message = BgutilRequirements });
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromMinutes(5));
        try
        {
            var version = id switch
            {
                "ytdlp" => await youtube.UpdateYtDlpAsync(deadline.Token),
                "ffmpeg" => await ffmpeg.UpdateAsync(deadline.Token),
                "bgutil" => await new ManagedBgutil(clients).UpdateAsync(deadline.Token),
                _ => await youtube.UpdateJavaScriptRuntimeAsync(deadline.Token),
            };
            return Ok(new { version });
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { message = id == "bgutil" ? ex.Message : "This tool could not be replaced. Check whether it is externally managed and review the backend logs." });
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or System.IO.IOException or System.ComponentModel.Win32Exception or JsonException)
        {
            return StatusCode(503, new { message = "The update did not complete. Retry later; the installed tool has been retained where possible." });
        }
    }

    private static string Name(string id) => id switch
    {
        "ytdlp" => "yt-dlp",
        "ffmpeg" => "FFmpeg & ffprobe",
        "deno" => "Deno",
        _ => "bgutil & Node runtime",
    };

    private async Task<ToolStatus> Status(string id, bool check, CancellationToken token)
    {
        string? current;
        string? latest = null;
        if (id == "ytdlp")
        {
            if (check)
            {
                var result = await youtube.CheckForUpdateAsync(token);
                current = result.Current;
                latest = result.Latest;
            }
            else
            {
                current = (await youtube.GetVersionsAsync(token)).YtDlpVersion;
            }
        }
        else if (id == "ffmpeg")
        {
            if (check)
            {
                var result = await ffmpeg.CheckForUpdateAsync(token);
                current = result.Current;
                latest = result.Latest;
            }
            else
            {
                current = await ffmpeg.GetVersionAsync(token);
            }
        }
        else if (id == "deno")
        {
            (current, latest) = await youtube.GetJavaScriptRuntimeVersionAsync(check, token);
        }
        else
        {
            return await BgutilStatus(check, token);
        }

        var available = latest != null ? current?.Trim().TrimStart('v') != latest.Trim().TrimStart('v') : (bool?)null;
        return new(id, Name(id), current, latest, true, available, null);
    }

    private async Task<ToolStatus> BgutilStatus(bool check, CancellationToken token)
    {
        var directory = ManagedBgutil.ActiveDirectory();
        var current = ManagedBgutil.InstalledVersion(directory);
        var canUpdate = ManagedBgutil.CanUpdate;
        var note = canUpdate ? null : BgutilRequirements;
        if (current == null)
        {
            using var probe = CancellationTokenSource.CreateLinkedTokenSource(token);
            probe.CancelAfter(TimeSpan.FromSeconds(2));
            try
            {
                using var client = clients.CreateClient();
                var result = await client.GetFromJsonAsync<JsonElement>("http://127.0.0.1:4416/ping", probe.Token);
                current = result.TryGetProperty("version", out var version) ? version.GetString() : null;
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException)
            {
                token.ThrowIfCancellationRequested();
            }
        }

        string? latest = null;
        if (check)
        {
            try
            {
                latest = await new ManagedToolInstaller(clients).LatestVersionAsync(ManagedBgutil.Repository, token);
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException)
            {
                note = "Could not check the latest bgutil release. Try again later.";
            }
        }

        bool? available = null;
        if (Version.TryParse(latest?.TrimStart('v'), out var release))
        {
            available = (canUpdate && directory == null) ||
                !Version.TryParse(current?.TrimStart('v'), out var installed) || installed < release;
        }

        return new("bgutil", Name("bgutil"), current, latest, canUpdate, available, note);
    }

    public sealed record ToolStatus(string Id, string Name, string? Current, string? Latest, bool CanUpdate, bool? UpdateAvailable, string? Note);
}
