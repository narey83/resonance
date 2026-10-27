// <copyright file="BridgeController.Appearance.cs" company="John Narey">
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
    using System.Text.Json;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Core.Preferences;

    /// <summary>
    /// Shares only the appearance name with an existing paired Bridge.
    /// </summary>
    public partial class BridgeController
    {
        [AllowAnonymous]
        [HttpGet("appearance")]
        public IActionResult Appearance([FromServices] PreferencesService preferences)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            Response.Headers.CacheControl = "no-store";
            var value = preferences.Get("resonance-theme");
            var selected = value?.ValueKind == JsonValueKind.String ? value.Value.GetString() : null;
            var theme = selected switch
            {
                "light" or "amoled" or "midnight" or "violet" or "ember" => selected,
                "dark" or "dim" => "amoled",
                _ => "system",
            };
            return Ok(new { theme });
        }
    }
}
