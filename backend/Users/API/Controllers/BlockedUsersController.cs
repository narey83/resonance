// <copyright file="BlockedUsersController.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using resonance.Core.API;
    using resonance.Users.Blocking;

    /// <summary>
    ///     The shared list of blocked Soulseek users. Mutations broadcast the updated
    ///     list and options over the application hub so every connected client
    ///     updates instantly.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Authorize(Policy = AuthPolicy.Any)]
    public class BlockedUsersController : ControllerBase
    {
        public BlockedUsersController(BlockedUsersService blockedUsersService, IHubContext<ApplicationHub> applicationHub, resonance.Telemetry.ReportsService reports)
        {
            BlockedUsers = blockedUsersService;
            ApplicationHub = applicationHub;
            Reports = reports;
        }

        private BlockedUsersService BlockedUsers { get; }
        private IHubContext<ApplicationHub> ApplicationHub { get; }
        private resonance.Telemetry.ReportsService Reports { get; }

        /// <summary>
        ///     Gets the block lists (users, IPs, places) along with the blocking options.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [ProducesResponseType(200)]
        public IActionResult Get() => Ok(ApplicationHubExtensions.BuildBlockedUsersPayload(BlockedUsers));

        /// <summary>
        ///     Gets the distinct countries and cities observed from peer connections, for the
        ///     block-by-location dropdowns.
        /// </summary>
        /// <returns></returns>
        [HttpGet("geo")]
        [ProducesResponseType(200)]
        public IActionResult GetKnownLocations() => Ok(Reports.GetKnownLocations());

        /// <summary>
        ///     Updates the blocking options.
        /// </summary>
        /// <param name="options">The blocking options to apply.</param>
        /// <returns></returns>
        [HttpPut("options")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(BlockedUserOptions), 200)]
        public async Task<IActionResult> SetOptions([FromBody] BlockedUserOptions options)
        {
            var updated = BlockedUsers.SetOptions(options);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(updated);
        }

        /// <summary>
        ///     Blocks the specified IP address or CIDR range.
        /// </summary>
        /// <param name="request">The address or CIDR range to block, and an optional reason.</param>
        /// <returns></returns>
        [HttpPost("ips")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedIp>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> BlockIp([FromBody] BlockIpRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Cidr))
            {
                return BadRequest("An IP address or CIDR range is required");
            }

            IReadOnlyList<BlockedIp> ips;

            try
            {
                ips = BlockedUsers.BlockIp(request.Cidr, request.Reason);
            }
            catch (System.ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(ips);
        }

        /// <summary>
        ///     Unblocks the specified IP address or CIDR range (passed as a query parameter
        ///     because CIDRs contain slashes).
        /// </summary>
        /// <param name="cidr">The address or CIDR range to unblock.</param>
        /// <returns></returns>
        [HttpDelete("ips")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedIp>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> UnblockIp([FromQuery] string cidr)
        {
            if (string.IsNullOrWhiteSpace(cidr))
            {
                return BadRequest("An IP address or CIDR range is required");
            }

            var ips = BlockedUsers.UnblockIp(cidr);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(ips);
        }

        /// <summary>
        ///     Blocks a location (country, optionally narrowed to a city).
        /// </summary>
        /// <param name="request">The country, and optionally the city, to block.</param>
        /// <returns></returns>
        [HttpPost("places")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedPlace>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> BlockPlace([FromBody] BlockPlaceRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Country))
            {
                return BadRequest("A country is required");
            }

            var places = BlockedUsers.BlockPlace(request.Country, request.City, request.Reason);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(places);
        }

        /// <summary>
        ///     Unblocks the location with the specified id.
        /// </summary>
        /// <param name="id">The id of the blocked location.</param>
        /// <returns></returns>
        [HttpDelete("places/{id:int}")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedPlace>), 200)]
        public async Task<IActionResult> UnblockPlace([FromRoute] int id)
        {
            var places = BlockedUsers.UnblockPlace(id);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(places);
        }

        /// <summary>
        ///     Blocks the specified user.
        /// </summary>
        /// <param name="username">The username of the user to block.</param>
        /// <param name="request">An optional reason describing why the user was blocked.</param>
        /// <returns></returns>
        [HttpPut("{username}")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedUser>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Block([FromRoute, UrlEncoded] string username, [FromBody] BlockUserRequest request = null)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                return BadRequest("Username is required");
            }

            var users = BlockedUsers.Block(username.Trim(), request?.Reason);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(users);
        }

        /// <summary>
        ///     Unblocks the specified user.
        /// </summary>
        /// <param name="username">The username of the user to unblock.</param>
        /// <returns></returns>
        [HttpDelete("{username}")]
        [ProducesResponseType(typeof(IReadOnlyList<BlockedUser>), 200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Unblock([FromRoute, UrlEncoded] string username)
        {
            if (string.IsNullOrWhiteSpace(username))
            {
                return BadRequest("Username is required");
            }

            var users = BlockedUsers.Unblock(username.Trim());
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers);
            return Ok(users);
        }
    }

    /// <summary>
    ///     The request body for blocking an IP address or CIDR range.
    /// </summary>
    public class BlockIpRequest
    {
        /// <summary>
        ///     Gets or sets the address or CIDR range to block.
        /// </summary>
        public string Cidr { get; set; }

        /// <summary>
        ///     Gets or sets an optional note describing why the address was blocked.
        /// </summary>
        public string Reason { get; set; }
    }

    /// <summary>
    ///     The request body for blocking a location.
    /// </summary>
    public class BlockPlaceRequest
    {
        /// <summary>
        ///     Gets or sets the country name or two-letter ISO code to block.
        /// </summary>
        public string Country { get; set; }

        /// <summary>
        ///     Gets or sets the optional city narrowing the rule.
        /// </summary>
        public string City { get; set; }

        /// <summary>
        ///     Gets or sets an optional note describing why the location was blocked.
        /// </summary>
        public string Reason { get; set; }
    }

    /// <summary>
    ///     The request body for blocking a user.
    /// </summary>
    public class BlockUserRequest
    {
        /// <summary>
        ///     Gets or sets an optional note describing why the user was blocked.
        /// </summary>
        public string Reason { get; set; }
    }
}
