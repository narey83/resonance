// <copyright file="DiscoveryController.cs" company="John Narey">
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

namespace resonance.MusicLibrary.API;

using System;
using System.Linq;
using System.Security.Claims;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using resonance.Common;
using resonance.MusicLibrary.Workspace;

[ApiController]
[ApiVersion("0")]
[Route("api/v{version:apiVersion}/musiclibrary/discovery")]
[Authorize(Policy = AuthPolicy.FeatureLibrary)]
public class DiscoveryController(WorkspaceStore store) : ControllerBase
{
    private string Username => User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
    [HttpGet("notes")]
    public IActionResult Notes() => Ok(store.ListTrackPreparation(Username).Select(note => note with { Path = MusicPath.ToAbsolute(note.Path) }));
    [HttpPut("notes")]
    public IActionResult SaveNotes([FromBody] TrackPreparation request)
    {
        try
        {
            var saved = store.SaveTrackPreparation(Username, request);
            return Ok(saved with { Path = MusicPath.ToAbsolute(saved.Path) });
        }
        catch (ArgumentException error)
        {
            return BadRequest(new { message = error.Message });
        }
        catch (InvalidOperationException error)
        {
            return Conflict(new { message = error.Message });
        }
    }

    [HttpGet("wishes")]
    public IActionResult Wishes() => Ok(store.ListWishes(Username));
    [HttpPost("wishes")]
    public IActionResult AddWish([FromBody] WishRequest request)
    {
        try
        {
            return Ok(store.AddWish(Username, request?.Query));
        }
        catch (ArgumentException error)
        {
            return BadRequest(new { message = error.Message });
        }
    }

    [HttpDelete("wishes/{id}")]
    public IActionResult DeleteWish(string id)
    {
        store.DeleteWish(Username, id);
        return NoContent();
    }

    public record WishRequest(string Query);
}
