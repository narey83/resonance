// <copyright file="CredentialsController.cs" company="JP Dillingham">
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

namespace resonance.Core.API
{
    using System;
    using System.IO;
    using System.Text;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Options;
    using Serilog;
    using YamlDotNet.RepresentationModel;
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

                var updatedYaml = PatchCredentialsInYaml(currentYaml, request.Username, request.Password);
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

        private static string PatchCredentialsInYaml(string yaml, string username, string password)
        {
            var yamlStream = new YamlStream();

            if (!string.IsNullOrWhiteSpace(yaml))
            {
                yamlStream.Load(new StringReader(yaml));
            }

            YamlMappingNode root;
            if (yamlStream.Documents.Count == 0)
            {
                root = new YamlMappingNode();
                yamlStream.Documents.Add(new YamlDocument(root));
            }
            else
            {
                root = (YamlMappingNode)yamlStream.Documents[0].RootNode;
            }

            YamlNode soulseekKey = null;
            foreach (var key in root.Children.Keys)
            {
                if (key is YamlScalarNode s && s.Value == "soulseek")
                {
                    soulseekKey = key;
                    break;
                }
            }

            YamlMappingNode soulseekSection;
            if (soulseekKey == null)
            {
                soulseekSection = new YamlMappingNode();
                root.Children.Add(new YamlScalarNode("soulseek"), soulseekSection);
            }
            else
            {
                soulseekSection = (YamlMappingNode)root.Children[soulseekKey];
            }

            SetOrUpdate(soulseekSection, "username", username);
            SetOrUpdate(soulseekSection, "password", password);

            var sb = new StringBuilder();
            yamlStream.Save(new StringWriter(sb), assignAnchors: false);
            return sb.ToString().Trim();
        }

        private static void SetOrUpdate(YamlMappingNode node, string key, string value)
        {
            YamlNode existingKey = null;
            foreach (var k in node.Children.Keys)
            {
                if (k is YamlScalarNode s && s.Value == key)
                {
                    existingKey = k;
                    break;
                }
            }

            if (existingKey != null)
            {
                node.Children[existingKey] = new YamlScalarNode(value);
            }
            else
            {
                node.Children.Add(new YamlScalarNode(key), new YamlScalarNode(value));
            }
        }
    }

    public record SoulseekCredentialResponse(string Username, string Password);
    public record SoulseekCredentialRequest(string Username, string Password);
}
