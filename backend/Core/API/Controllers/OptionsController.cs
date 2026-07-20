// <copyright file="OptionsController.cs" company="JP Dillingham">
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

using Microsoft.Extensions.Options;

namespace resonance.Core.API
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Reflection;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Configuration;
    using resonance.Configuration;
    using resonance.Validation;
    using Serilog;

    /// <summary>
    ///     Options.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class OptionsController : ControllerBase
    {
        public OptionsController(
            OptionsAtStartup optionsAtStartup,
            IOptionsSnapshot<Options> optionsSnapshot,
            IStateMutator<State> stateMutator)
        {
            OptionsAtStartup = optionsAtStartup;
            OptionsSnapshot = optionsSnapshot;
            StateMutator = stateMutator;
        }

        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private OptionsAtStartup OptionsAtStartup { get; }
        private IStateMutator<State> StateMutator { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Application);

        /// <summary>
        ///     Gets the current application options.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Options), 200)]
        public IActionResult Current()
        {
            return Ok(OptionsSnapshot.Value.Redact());
        }

        /// <summary>
        ///     Overlay the application options with new values.
        /// </summary>
        /// <param name="overlay">The overlay to apply.</param>
        /// <returns></returns>
        [HttpPatch]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(OptionsOverlay), 200)]
        public IActionResult ApplyOverlay([FromBody] OptionsOverlay overlay)
        {
            if (overlay is null)
            {
                return NoContent();
            }

            if (!overlay.TryValidate(out var result))
            {
                Log.Warning("Options patch validation failed: {Message}", result.GetResultString());
                return BadRequest(result.GetResultString());
            }

            try
            {
                Program.ApplyConfigurationOverlay(overlay);
                return Ok(Program.ConfigurationOverlay?.Redact());
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to apply options patch: {Message}", ex.Message);
                return StatusCode(500, $"Failed to apply options patch: {ex.Message}");
            }
        }

        /// <summary>
        ///     Gets the application options provided at startup.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("startup")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Options), 200)]
        public IActionResult Startup()
        {
            return Ok(OptionsAtStartup.Redact());
        }

        /// <summary>
        ///     Gets the debug view of the current application options.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("debug")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(typeof(string), 200)]
        public IActionResult Debug()
        {
            if (!OptionsAtStartup.Debug)
            {
                return Forbid();
            }

            // retrieve the IConfigurationRoot instance with reflection to avoid
            // exposing it as a public member of Program.
            var property = typeof(Program).GetProperty("Configuration", BindingFlags.NonPublic | BindingFlags.Static);
            var configurationRoot = (IConfigurationRoot)property.GetValue(null, null);

            return Ok(configurationRoot.GetDebugView());
        }

        [HttpGet]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [Route("yaml/location")]
        public IActionResult GetYamlFileLocation()
        {
            return Ok("Database (settings table)");
        }

        [HttpGet]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [Route("yaml")]
        public IActionResult GetYamlFile()
        {
            try
            {
                var yaml = SettingsYaml.ToYaml(Program.SettingsStore.GetAll(), Program.AppName);
                return Ok(yaml);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to read configuration: {Message}", ex.Message);
                return StatusCode(500, $"Failed to read configuration: {ex.Message}");
            }
        }

        [HttpPut]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [Route("yaml")]
        public IActionResult UpdateYamlFile([FromBody] string yaml)
        {
            if (!TryValidateYaml(yaml, out var error))
            {
                Log.Error(error, "Failed to validate configuration");
                return BadRequest(error);
            }

            try
            {
                // Replace the whole document (retaining snake_case), but never persist the bootstrap database
                // keys — the connection string is environment-only and must not live in the database.
                var databasePrefix = $"{Program.AppName}:database:";
                var settings = SettingsYaml.Flatten(yaml, Program.AppName)
                    .Where(kvp => !kvp.Key.StartsWith(databasePrefix, StringComparison.OrdinalIgnoreCase))
                    .ToDictionary(kvp => kvp.Key, kvp => kvp.Value);

                Program.SettingsStore.Replace(settings);
                Program.ReloadSettings();
                return Ok();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to save settings: {Message}", ex.Message);
                return StatusCode(500, $"Failed to save settings: {ex.Message}");
            }
        }

        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any)]
        [Route("yaml/validate")]
        public IActionResult ValidateYamlFile([FromBody] string yaml)
        {
            if (!TryValidateYaml(yaml, out var error))
            {
                return Ok(error);
            }

            return Ok();
        }

        private bool TryValidateYaml(string yaml, out string error)
        {
            error = null;

            try
            {
                // Validate the document as it would actually be applied: the built-in defaults and environment
                // variables (which supply the bootstrap-only database connection string) underneath the
                // submitted document. Keys are normalized to the form the binder expects.
                var overlay = SettingsYaml.Flatten(yaml, Program.AppName)
                    .ToDictionary(kvp => SettingsYaml.Normalize(kvp.Key), kvp => kvp.Value);

                var configuration = new ConfigurationBuilder()
                    .AddDefaultValues(targetType: typeof(Options))
                    .AddEnvironmentVariables(targetType: typeof(Options), prefix: Program.EnvironmentVariablePrefix)
                    .AddInMemoryCollection(overlay)
                    .Build();

                var options = new Options();
                configuration.GetSection(Program.AppName).Bind(options, o => o.BindNonPublicProperties = true);

                if (!options.TryValidate(out var result))
                {
                    error = result.GetResultView();
                    return false;
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Configuration validation failed");

                error = ex.Message;

                if (ex.InnerException != null)
                {
                    error += $": {ex.InnerException.Message}";
                }

                return false;
            }

            return true;
        }
    }
}
