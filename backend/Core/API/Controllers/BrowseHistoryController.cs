// <copyright file="BrowseHistoryController.cs" company="John Narey">
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

namespace resonance.Core.API.Controllers;

using System.Collections.Generic;
using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using resonance.Core.BrowseHistory;

/// <summary>
///     The shared history of browsed users. Mutations broadcast the updated list
///     over the browse hub so every connected client updates instantly.
/// </summary>
[Route("api/v{version:apiVersion}/[controller]")]
[ApiVersion("0")]
[ApiController]
[Produces("application/json")]
[Authorize(Policy = AuthPolicy.Any)]
public class BrowseHistoryController : ControllerBase
{
    public BrowseHistoryController(BrowseHistoryService browseHistoryService, IHubContext<BrowseHub> browseHub)
    {
        BrowseHistory = browseHistoryService;
        BrowseHub = browseHub;
    }

    private BrowseHistoryService BrowseHistory { get; }
    private IHubContext<BrowseHub> BrowseHub { get; }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<string>), 200)]
    public IActionResult Get() => Ok(BrowseHistory.GetAll());

    [HttpPut("{username}")]
    [ProducesResponseType(typeof(IReadOnlyList<string>), 200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Add([FromRoute, UrlEncoded] string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        var history = BrowseHistory.Add(username.Trim());
        await BrowseHub.BroadcastHistoryAsync(history);
        return Ok(history);
    }

    [HttpDelete("{username}")]
    [ProducesResponseType(typeof(IReadOnlyList<string>), 200)]
    [ProducesResponseType(400)]
    public async Task<IActionResult> Remove([FromRoute, UrlEncoded] string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        var history = BrowseHistory.Remove(username.Trim());
        await BrowseHub.BroadcastHistoryAsync(history);
        return Ok(history);
    }
}
