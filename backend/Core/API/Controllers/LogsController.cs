// <copyright file="LogsController.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using Serilog;

    /// <summary>
    ///     Logs.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class LogsController : ControllerBase
    {
        public LogsController(IHubContext<LogsHub> logHub)
        {
            LogHub = logHub;
        }

        private IHubContext<LogsHub> LogHub { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Application);

        /// <summary>
        ///     Gets the last few application logs.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult Get()
        {
            return Ok(Program.LogBuffer);
        }

        /// <summary>
        ///     Accepts a browser console log entry and injects it into the application log stream.
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult Post([FromBody] BrowserLogEntry entry)
        {
            if (string.IsNullOrWhiteSpace(entry?.Message))
            {
                return BadRequest();
            }

            var level = entry.Level?.ToUpperInvariant() switch
            {
                "ERROR" => "Error",
                "WARN" or "WARNING" => "Warning",
                _ => "Information",
            };

            var context = string.IsNullOrWhiteSpace(entry.Context) ? resonance.Logs.Browser : entry.Context;

            var record = new LogRecord()
            {
                Timestamp = DateTime.UtcNow,
                Context = context,
                Level = level,
                Message = entry.Message,
            };

            Program.LogBuffer.Enqueue(record);
            Program.RaiseLogEmitted(record);
            _ = LogHub.EmitLogAsync(record);

            var remoteLog = Log.ForContext("SourceContext", context);
            switch (level)
            {
                case "Error": remoteLog.Error("{RemoteMessage}", entry.Message); break;
                case "Warning": remoteLog.Warning("{RemoteMessage}", entry.Message); break;
                default: remoteLog.Information("{RemoteMessage}", entry.Message); break;
            }

            return Ok();
        }
    }

    public record BrowserLogEntry
    {
        public string Level { get; init; }
        public string Message { get; init; }
        public string Context { get; init; }
    }
}
