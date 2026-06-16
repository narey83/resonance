// <copyright file="FfmpegController.cs" company="JP Dillingham">
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

namespace resonance.Common.Ffmpeg.API;

using System;
using System.Threading;
using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance;

[Route("api/v{version:apiVersion}/ffmpeg")]
[ApiVersion("0")]
[Produces("application/json")]
[Authorize(Policy = AuthPolicy.Any)]
public class FfmpegController : ControllerBase
{
    public FfmpegController(IFfmpegService ffmpeg)
    {
        Ffmpeg = ffmpeg;
    }

    private IFfmpegService Ffmpeg { get; }

    [HttpGet("version")]
    public async Task<IActionResult> GetVersion(CancellationToken cancellationToken)
        => Ok(new { version = await Ffmpeg.GetVersionAsync(cancellationToken) });

    [HttpGet("update-check")]
    public async Task<IActionResult> CheckForUpdate(CancellationToken cancellationToken)
    {
        var (current, latest, updateAvailable) = await Ffmpeg.CheckForUpdateAsync(cancellationToken);
        return Ok(new { current, latest, updateAvailable });
    }

    [HttpPost("update")]
    public async Task<IActionResult> Update(CancellationToken cancellationToken)
    {
        try
        {
            var newVersion = await Ffmpeg.UpdateAsync(cancellationToken);
            return Ok(new { version = newVersion });
        }
        catch (Exception ex)
        {
            return StatusCode(500, ex.Message);
        }
    }
}
