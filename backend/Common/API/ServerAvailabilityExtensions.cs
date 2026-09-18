// <copyright file="ServerAvailabilityExtensions.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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

namespace resonance.Common.API
{
    using System;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.DependencyInjection;
    using Soulseek;

    /// <summary>
    ///     Lets a controller answer "the Soulseek server connection is down" as a 503 rather than a 500.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         The pipeline already maps this for exceptions that reach it unhandled, but most controllers
    ///         catch broadly and convert to a 500 first, so the middleware never sees them. A request for
    ///         319 files was answered with "500 The server connection must be connected and logged in
    ///         (currently: Disconnected)" — an accurate message with the wrong status on it, telling the
    ///         client the request was broken when the application was briefly offline and reconnecting.
    ///     </para>
    ///     <para>
    ///         Used as a fallthrough, so the ordinary failure path is unchanged, as in
    ///         <c>return this.ServerUnavailable(ex) ?? StatusCode(500, ex.Message);</c> here.
    ///     </para>
    /// </remarks>
    public static class ServerAvailabilityExtensions
    {
        /// <summary>
        ///     Returns a 503 when <paramref name="exception"/> was caused by the server connection being
        ///     unavailable, and null when it was not.
        /// </summary>
        /// <param name="controller">The controller handling the request.</param>
        /// <param name="exception">The failure being dispositioned.</param>
        /// <returns>A 503 result, or null when this is not a connection-state failure.</returns>
        public static IActionResult ServerUnavailable(this ControllerBase controller, Exception exception)
        {
            // The client raises a plain InvalidOperationException for this, so there is no typed exception
            // to catch; its own state is what says whether the connection was usable.
            if (exception is not InvalidOperationException)
            {
                return null;
            }

            var client = controller?.HttpContext?.RequestServices?.GetService<ISoulseekClient>();

            if (client is null)
            {
                return null;
            }

            if (client.State.HasFlag(SoulseekClientStates.Connected)
                && client.State.HasFlag(SoulseekClientStates.LoggedIn))
            {
                return null;
            }

            // The watchdog reconnects in seconds when the server is reachable, so a client that retries
            // shortly is likely to succeed.
            controller.Response.Headers.RetryAfter = "5";

            return controller.StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                "The Soulseek server connection is not available; try again shortly.");
        }
    }
}
