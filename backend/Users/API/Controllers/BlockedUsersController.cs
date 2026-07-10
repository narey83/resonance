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
        public BlockedUsersController(BlockedUsersService blockedUsersService, IHubContext<ApplicationHub> applicationHub)
        {
            BlockedUsers = blockedUsersService;
            ApplicationHub = applicationHub;
        }

        private BlockedUsersService BlockedUsers { get; }
        private IHubContext<ApplicationHub> ApplicationHub { get; }

        /// <summary>
        ///     Gets the list of blocked users along with the blocking options.
        /// </summary>
        [HttpGet]
        [ProducesResponseType(typeof(BlockedUsersResponse), 200)]
        public IActionResult Get() => Ok(new BlockedUsersResponse
        {
            Users = BlockedUsers.GetAll(),
            Options = BlockedUsers.GetOptions(),
        });

        /// <summary>
        ///     Updates the blocking options.
        /// </summary>
        [HttpPut("options")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(BlockedUserOptions), 200)]
        public async Task<IActionResult> SetOptions([FromBody] BlockedUserOptions options)
        {
            var updated = BlockedUsers.SetOptions(options);
            await ApplicationHub.BroadcastBlockedUsersAsync(BlockedUsers.GetAll(), updated);
            return Ok(updated);
        }

        /// <summary>
        ///     Blocks the specified user.
        /// </summary>
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
            await ApplicationHub.BroadcastBlockedUsersAsync(users, BlockedUsers.GetOptions());
            return Ok(users);
        }

        /// <summary>
        ///     Unblocks the specified user.
        /// </summary>
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
            await ApplicationHub.BroadcastBlockedUsersAsync(users, BlockedUsers.GetOptions());
            return Ok(users);
        }
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

    /// <summary>
    ///     The blocked users list and options, returned together so clients can
    ///     seed their state in a single request.
    /// </summary>
    public class BlockedUsersResponse
    {
        /// <summary>
        ///     Gets or sets the blocked users, most recently blocked first.
        /// </summary>
        public IReadOnlyList<BlockedUser> Users { get; set; }

        /// <summary>
        ///     Gets or sets the blocking options.
        /// </summary>
        public BlockedUserOptions Options { get; set; }
    }
}
