// <copyright file="UpnpController.cs" company="John Narey">
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

namespace resonance.Integrations.Upnp.API.Controllers;

using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

/// <summary>
///     UPnP port mapping status and manual retry.
/// </summary>
[Route("api/v{version:apiVersion}/upnp")]
[ApiVersion("0")]
[Produces("application/json")]
[Authorize(Policy = AuthPolicy.Any)]
public class UpnpController : ControllerBase
{
    public UpnpController(UpnpService service, IStateMonitor<State> stateMonitor)
    {
        Service = service;
        StateMonitor = stateMonitor;
    }

    private UpnpService Service { get; }
    private IStateMonitor<State> StateMonitor { get; }

    /// <summary>
    ///     Forces an immediate rediscovery and mapping attempt, then returns the resulting status.
    /// </summary>
    /// <returns>The resulting <see cref="UpnpState"/>.</returns>
    [HttpPost("retry")]
    public async Task<IActionResult> Retry()
    {
        await Service.RetryNowAsync();

        return Ok(StateMonitor.CurrentValue.Upnp);
    }
}
