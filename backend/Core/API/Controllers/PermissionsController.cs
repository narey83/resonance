// <copyright file="PermissionsController.cs" company="John Narey">
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
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Authentication;

    /// <summary>
    ///     Role permission matrix management. Admin only.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
    public class PermissionsController : ControllerBase
    {
        public PermissionsController(PermissionService permissions)
        {
            Permissions = permissions;
        }

        private PermissionService Permissions { get; }

        /// <summary>Returns the full role × feature permission matrix.</summary>
        /// <returns></returns>
        [HttpGet]
        [ProducesResponseType(typeof(PermissionMatrixResponse), 200)]
        public IActionResult GetMatrix()
        {
            var roles = Permissions.GetRoles().ToList();
            var matrix = Permissions.GetMatrix().ToList();

            var permissions = matrix.Select(p => new PermissionEntry(p.RoleName, p.FeatureKey, p.Allowed)).ToList();

            // Administrator row: always fully allowed (not stored, added synthetically)
            foreach (var feature in Feature.All)
            {
                if (!permissions.Any(p => p.RoleName == Role.Administrator.ToString() && p.FeatureKey == feature))
                {
                    permissions.Add(new PermissionEntry(Role.Administrator.ToString(), feature, true));
                }
            }

            return Ok(new PermissionMatrixResponse(
                roles.Select(r => new RoleEntry(r.Name, r.IsBuiltIn)).ToList(),
                Feature.All.Select(k => new FeatureEntry(k, Feature.DisplayNames[k])).ToList(),
                permissions));
        }

        /// <summary>Creates a new custom role.</summary>
        /// <returns></returns>
        [HttpPost("roles")]
        [ProducesResponseType(typeof(RoleEntry), 201)]
        [ProducesResponseType(400)]
        [ProducesResponseType(409)]
        public IActionResult CreateRole([FromBody] CreateRoleRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Name))
            {
                return BadRequest("Role name is required");
            }

            try
            {
                var role = Permissions.CreateRole(request.Name);
                return Created($"/api/v0/permissions/roles/{role.Name}", new RoleEntry(role.Name, role.IsBuiltIn));
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
        }

        /// <summary>Deletes a custom role. Built-in roles cannot be deleted.</summary>
        /// <returns></returns>
        [HttpDelete("roles/{name}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult DeleteRole(string name)
        {
            try
            {
                Permissions.DeleteRole(name);
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

        /// <summary>Sets whether a role is allowed access to a feature.</summary>
        /// <returns></returns>
        [HttpPut("{roleName}/{featureKey}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult SetPermission(string roleName, string featureKey, [FromBody] SetPermissionRequest request)
        {
            if (roleName == Role.Administrator.ToString())
            {
                return Conflict("Administrator permissions cannot be modified");
            }

            try
            {
                Permissions.SetPermission(roleName, featureKey, request?.Allowed ?? true);
                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }
    }

    public record PermissionMatrixResponse(
        IEnumerable<RoleEntry> Roles,
        IEnumerable<FeatureEntry> Features,
        IEnumerable<PermissionEntry> Permissions);

    public record RoleEntry(string Name, bool IsBuiltIn);
    public record FeatureEntry(string Key, string DisplayName);
    public record PermissionEntry(string RoleName, string FeatureKey, bool Allowed);
    public record CreateRoleRequest(string Name);
    public record SetPermissionRequest(bool Allowed);
}
