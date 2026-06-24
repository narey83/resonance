// <copyright file="AccountsController.cs" company="John Narey">
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

namespace resonance.Core.API
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Security.Claims;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Authentication;

    /// <summary>
    ///     App user account management.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class AccountsController : ControllerBase
    {
        public AccountsController(AppUserService userService, SessionService sessionService)
        {
            Users = userService;
            Sessions = sessionService;
        }

        private AppUserService Users { get; }
        private SessionService Sessions { get; }

        /// <summary>Lists all app users. Admin only.</summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(IEnumerable<UserResponse>), 200)]
        public IActionResult List()
        {
            var users = Users.GetAll().Select(ToResponse);
            return Ok(users);
        }

        /// <summary>Creates a new app user. Admin only.</summary>
        /// <returns></returns>
        [HttpPost]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(UserResponse), 201)]
        [ProducesResponseType(400)]
        [ProducesResponseType(409)]
        public IActionResult Create([FromBody] CreateUserRequest request)
        {
            if (request == default || string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            {
                return BadRequest("Username and password are required");
            }

            if (!Enum.TryParse<Role>(request.Role, ignoreCase: true, out var role) || role is not (Role.Administrator or Role.ReadWrite))
            {
                return BadRequest("Role must be 'Administrator' or 'ReadWrite'");
            }

            try
            {
                var user = Users.Create(request.Username, request.Password, role, request.FullName);
                return CreatedAtAction(nameof(Get), new { username = user.Username }, ToResponse(user));
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
        }

        /// <summary>Gets details for a specific user. Admin may query anyone; users may only query themselves.</summary>
        /// <returns></returns>
        [HttpGet("{username}")]
        [Authorize(Policy = AuthPolicy.JwtOnly)]
        [ProducesResponseType(typeof(UserResponse), 200)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public IActionResult Get(string username)
        {
            if (!IsAdminOrSelf(username))
            {
                return Forbid();
            }

            var user = Users.Get(username);
            if (user is null)
            {
                return NotFound();
            }

            return Ok(ToResponse(user));
        }

        /// <summary>Changes a user's password. Admin may change anyone's; users may only change their own.</summary>
        /// <returns></returns>
        [HttpPut("{username}/password")]
        [Authorize(Policy = AuthPolicy.JwtOnly)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public IActionResult ChangePassword(string username, [FromBody] ChangePasswordRequest request)
        {
            if (!IsAdminOrSelf(username))
            {
                return Forbid();
            }

            if (string.IsNullOrWhiteSpace(request?.Password))
            {
                return BadRequest("Password is required");
            }

            try
            {
                Users.UpdatePassword(username, request.Password);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Changes a user's username. Admin or self. Revokes all existing sessions.</summary>
        /// <returns></returns>
        [HttpPut("{username}/username")]
        [Authorize(Policy = AuthPolicy.JwtOnly)]
        [ProducesResponseType(typeof(UserResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult ChangeUsername(string username, [FromBody] ChangeUsernameRequest request)
        {
            if (!IsAdminOrSelf(username))
            {
                return Forbid();
            }

            if (string.IsNullOrWhiteSpace(request?.Username))
            {
                return BadRequest("Username is required");
            }

            try
            {
                // revoke sessions before rename so they can be found by the old name
                Sessions.RevokeAll(username);
                var newUsername = Users.UpdateUsername(username, request.Username);
                var user = Users.Get(newUsername);
                return Ok(ToResponse(user));
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
        }

        /// <summary>Updates a user's full name. Admin or self.</summary>
        /// <returns></returns>
        [HttpPut("{username}/fullname")]
        [Authorize(Policy = AuthPolicy.JwtOnly)]
        [ProducesResponseType(204)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public IActionResult ChangeFullName(string username, [FromBody] ChangeFullNameRequest request)
        {
            if (!IsAdminOrSelf(username))
            {
                return Forbid();
            }

            try
            {
                Users.UpdateFullName(username, request?.FullName);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Changes a user's role. Admin only.</summary>
        /// <returns></returns>
        [HttpPut("{username}/role")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public IActionResult ChangeRole(string username, [FromBody] ChangeRoleRequest request)
        {
            if (!Enum.TryParse<Role>(request?.Role, ignoreCase: true, out var role) || role is not (Role.Administrator or Role.ReadWrite))
            {
                return BadRequest("Role must be 'Administrator' or 'ReadWrite'");
            }

            try
            {
                Users.UpdateRole(username, role);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
        }

        /// <summary>Deletes a user. Admin only. Cannot delete the last admin.</summary>
        /// <returns></returns>
        [HttpDelete("{username}")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult Delete(string username)
        {
            try
            {
                Users.Delete(username);
                Sessions.RevokeAll(username);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
        }

        private bool IsAdminOrSelf(string username)
        {
            var callerRole = User.FindFirstValue(ClaimTypes.Role);
            var callerName = User.FindFirstValue(ClaimTypes.Name);
            return callerRole == Role.Administrator.ToString() || callerName == username;
        }

        private static UserResponse ToResponse(AppUser u) => new(
            u.Username,
            u.FullName,
            u.Role.ToString(),
            u.CreatedAt);
    }

    public record UserResponse(string Username, string FullName, string Role, DateTime CreatedAt);
    public record CreateUserRequest(string Username, string Password, string Role = "ReadWrite", string FullName = null);
    public record ChangePasswordRequest(string Password);
    public record ChangeUsernameRequest(string Username);
    public record ChangeFullNameRequest(string FullName);
    public record ChangeRoleRequest(string Role);
}
