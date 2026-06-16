// <copyright file="ConverterController.cs" company="JP Dillingham">
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

namespace resonance.MusicLibrary.Converter.API.Controllers;

using System;
using System.Linq;
using System.Text;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance;

[ApiController]
[ApiVersion("0")]
[Produces("application/json")]
[Consumes("application/json")]
[Route("api/v{version:apiVersion}/converter")]
[Authorize(Policy = AuthPolicy.FeatureLibrary)]
public class ConverterController : ControllerBase
{
    public ConverterController(IConverterService service)
    {
        Service = service;
    }

    private IConverterService Service { get; }

    [HttpGet("jobs")]
    public IActionResult ListJobs() => Ok(Service.List());

    [HttpGet("jobs/{id:guid}")]
    public IActionResult GetJob(Guid id)
    {
        var job = Service.Get(id);
        return job is null ? NotFound() : Ok(job);
    }

    [HttpPost("jobs")]
    public IActionResult Start([FromBody] StartConversionRequest request)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Format))
        {
            return BadRequest("format is required");
        }

        if ((request.Paths is null || request.Paths.Length == 0) &&
            (request.Folders is null || request.Folders.Length == 0))
        {
            return BadRequest("at least one file or folder is required");
        }

        var files = DecodeAll(request.Paths);
        var folders = DecodeAll(request.Folders);

        try
        {
            var job = Service.Start(files, folders, request.Format, request.Quality ?? 2);
            return Ok(job);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }
    }

    [HttpPost("jobs/{id:guid}/cancel")]
    public IActionResult Cancel(Guid id)
    {
        Service.Cancel(id);
        return NoContent();
    }

    // Paths arrive base64-encoded (matching the library's delete-batch-local convention) so
    // arbitrary local paths survive transport without route/query escaping issues.
    private static string[] DecodeAll(string[]? encoded)
    {
        if (encoded is null)
        {
            return Array.Empty<string>();
        }

        return encoded
            .Select(e =>
            {
                try
                {
                    return Encoding.UTF8.GetString(Convert.FromBase64String(e));
                }
                catch
                {
                    return null;
                }
            })
            .Where(p => !string.IsNullOrEmpty(p))
            .Select(p => p!)
            .ToArray();
    }
}

public record StartConversionRequest(string[]? Paths, string[]? Folders, string Format, int? Quality);
