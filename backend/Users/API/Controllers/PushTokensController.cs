// <copyright file="PushTokensController.cs" company="John Narey">
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

namespace resonance.Users.API
{
    using System.ComponentModel.DataAnnotations;
    using System.Security.Claims;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Authentication;

    /// <summary>
    ///     Registers/unregisters a device's FCM push token, so the backend can wake the mobile app
    ///     with a background sync when the music library changes even while it's backgrounded or killed.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Authorize(Policy = AuthPolicy.Any)]
    public class PushTokensController : ControllerBase
    {
        public PushTokensController(PushTokenService pushTokens)
        {
            PushTokens = pushTokens;
        }

        private PushTokenService PushTokens { get; }

        private string Username => User.FindFirstValue(ClaimTypes.Name) ?? string.Empty;

        /// <summary>
        ///     Registers (or updates) the calling device's FCM push token.
        /// </summary>
        /// <param name="request">The device's push token, stable device id, and platform.</param>
        /// <returns></returns>
        [HttpPost]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public IActionResult Register([FromBody] RegisterPushTokenRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Token) || string.IsNullOrWhiteSpace(request?.DeviceId))
            {
                return BadRequest("A push token and device id are required");
            }

            PushTokens.Register(Username, request.DeviceId, request.Token, request.Platform);
            return Ok();
        }

        /// <summary>
        ///     Unregisters the given device's push token, e.g. on logout.
        /// </summary>
        /// <param name="deviceId">The stable id of the device to unregister.</param>
        /// <returns></returns>
        [HttpDelete("{deviceId}")]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public IActionResult Unregister([FromRoute] string deviceId)
        {
            if (string.IsNullOrWhiteSpace(deviceId))
            {
                return BadRequest("A device id is required");
            }

            PushTokens.Unregister(Username, deviceId);
            return Ok();
        }
    }

    /// <summary>
    ///     The request body for registering a device's push token.
    /// </summary>
    public class RegisterPushTokenRequest
    {
        /// <summary>
        ///     Gets or sets the FCM device push token.
        /// </summary>
        [Required]
        [StringLength(4096, MinimumLength = 1)]
        public string Token { get; set; }

        /// <summary>
        ///     Gets or sets the stable per-install device id (Android ID / iOS identifierForVendor).
        /// </summary>
        [Required]
        [StringLength(256, MinimumLength = 1)]
        public string DeviceId { get; set; }

        /// <summary>
        ///     Gets or sets the device platform ("android" or "ios"), informational only.
        /// </summary>
        [StringLength(32)]
        public string Platform { get; set; }
    }
}
