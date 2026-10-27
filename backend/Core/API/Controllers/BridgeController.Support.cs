// <copyright file="BridgeController.Support.cs" company="John Narey">
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

// SPDX-License-Identifier: AGPL-3.0-only
namespace resonance.Core.API
{
    using System;
    using System.Linq;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    /// Provides credential-free Bridge support status for administrators.
    /// </summary>
    public partial class BridgeController
    {
        [HttpGet("diagnostics")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult Diagnostics()
        {
            return Ok(new
            {
                application = "Resonance Bridge server",
                timestamp = DateTimeOffset.UtcNow,
                version = typeof(BridgeController).Assembly.GetName().Version?.ToString(),
                library = batches?.Status,
                exportWorkerAvailable = exports?.Enabled == true,
                activeConnections = Pairings.Count(p => p.Value.Expires > DateTimeOffset.UtcNow),
                logSource = "Bridge",
                guidance = exports?.Enabled == true
                    ? "Review Bridge events in System logs for readiness, batch preparation and transfer failures."
                    : "Export worker is not configured. Pairing and software updates are available; library sync is waiting for server setup.",
                privacy = "No connection credentials, tokens, local file paths or music are included.",
            });
        }
    }
}
