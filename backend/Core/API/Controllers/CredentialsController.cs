// <copyright file="CredentialsController.cs" company="John Narey">
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
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Options;
    using resonance.Configuration;
    using Serilog;
    using AppOptions = resonance.Options;

    /// <summary>
    ///     Credentials.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class CredentialsController : ControllerBase
    {
        public CredentialsController(
            IOptionsSnapshot<AppOptions> optionsSnapshot,
            ConnectionWatchdog connectionWatchdog)
        {
            OptionsSnapshot = optionsSnapshot;
            ConnectionWatchdog = connectionWatchdog;
        }

        private IOptionsSnapshot<AppOptions> OptionsSnapshot { get; }
        private ConnectionWatchdog ConnectionWatchdog { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Sessions.Auth);

        /// <summary>
        ///     Gets the stored Soulseek credentials.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("soulseek")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(SoulseekCredentialResponse), 200)]
        public IActionResult GetSoulseek()
        {
            return Ok(new SoulseekCredentialResponse(
                Username: OptionsSnapshot.Value.Soulseek.Username ?? string.Empty,
                Password: OptionsSnapshot.Value.Soulseek.Password ?? string.Empty));
        }

        /// <summary>
        ///     Updates the Soulseek credentials in the YAML configuration file and restarts the connection watchdog.
        /// </summary>
        /// <returns></returns>
        [HttpPut]
        [Route("soulseek")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        public IActionResult PutSoulseek([FromBody] SoulseekCredentialRequest request)
        {
            if (request == default || string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            {
                return BadRequest("Username and password are required");
            }

            try
            {
                var currentYaml = System.IO.File.Exists(Program.ConfigurationFile)
                    ? System.IO.File.ReadAllText(Program.ConfigurationFile)
                    : string.Empty;

                var updatedYaml = YamlConfigPatcher.Patch(currentYaml, "soulseek", new Dictionary<string, string>
                {
                    ["username"] = request.Username,
                    ["password"] = request.Password,
                });
                System.IO.File.WriteAllText(Program.ConfigurationFile, updatedYaml);

                Log.Information("Soulseek credentials updated for user {Username}", request.Username);

                ConnectionWatchdog.Restart();

                return NoContent();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to update Soulseek credentials: {Message}", ex.Message);
                return StatusCode(500, $"Failed to update credentials: {ex.Message}");
            }
        }

    }

    public record SoulseekCredentialResponse(string Username, string Password);
    public record SoulseekCredentialRequest(string Username, string Password);
}
