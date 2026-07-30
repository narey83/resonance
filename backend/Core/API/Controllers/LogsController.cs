// <copyright file="LogsController.cs" company="JP Dillingham">
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
    using System.Linq;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.EntityFrameworkCore;
    using resonance.Core.LogStore;
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
        public LogsController(IHubContext<LogsHub> logHub, IDbContextFactory<LogsDbContext> logsDbContextFactory)
        {
            LogHub = logHub;
            LogsDbContextFactory = logsDbContextFactory;
        }

        private IHubContext<LogsHub> LogHub { get; }
        private IDbContextFactory<LogsDbContext> LogsDbContextFactory { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Application);

        /// <summary>
        ///     Gets a paginated, filtered list of historical log entries from persistent storage.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult Get(
            [FromQuery] int offset = 0,
            [FromQuery] int limit = 100,
            [FromQuery] string[] level = null,
            [FromQuery] string[] context = null,
            [FromQuery] string search = null,
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null)
        {
            if (offset < 0)
            {
                return BadRequest("Offset must be >= 0");
            }

            if (limit <= 0 || limit > 1000)
            {
                return BadRequest("Limit must be between 1 and 1000");
            }

            try
            {
                using var ctx = LogsDbContextFactory.CreateDbContext();
                var query = ctx.LogEntries.AsNoTracking().AsQueryable();

                if (level?.Length > 0)
                {
                    query = query.Where(e => level.Contains(e.Level));
                }

                if (context?.Length > 0)
                {
                    query = query.Where(e => context.Contains(e.Context));
                }

                if (!string.IsNullOrWhiteSpace(search))
                {
                    query = query.Where(e => e.Message.Contains(search));
                }

                if (from.HasValue)
                {
                    query = query.Where(e => e.Timestamp >= from.Value);
                }

                if (to.HasValue)
                {
                    query = query.Where(e => e.Timestamp <= to.Value);
                }

                var total = query.Count();

                var items = query
                    .OrderByDescending(e => e.Timestamp)
                    .ThenByDescending(e => e.Id)
                    .Skip(offset)
                    .Take(limit)
                    .Select(e => new LogRecord
                    {
                        Timestamp = e.Timestamp,
                        Level = e.Level,
                        Context = e.Context,
                        SubContext = e.SubContext,
                        Message = e.Message,
                        Exception = e.Exception,
                    })
                    .ToList();

                Response.Headers["X-Total-Count"] = total.ToString();
                return Ok(items);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to query logs: {Message}", ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Gets every log context the application can emit under.
        /// </summary>
        /// <returns></returns>
        [HttpGet("contexts")]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult GetContexts() => Ok(resonance.Logs.All);

        /// <summary>
        ///     Gets the global and framework minimum log levels.
        /// </summary>
        /// <returns></returns>
        [HttpGet("level")]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult GetLevel() => Ok(new
        {
            level = Program.LevelSwitch.MinimumLevel.ToString(),
            framework = Program.FrameworkLevelSwitch.MinimumLevel.ToString(),
        });

        /// <summary>
        ///     Sets the minimum log levels, taking effect immediately and without a restart.
        /// </summary>
        /// <returns></returns>
        [HttpPut("level")]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult PutLevel([FromBody] LogLevelRequest request)
        {
            if (request?.Level is not null)
            {
                if (!Enum.TryParse<Serilog.Events.LogEventLevel>(request.Level, ignoreCase: true, out var level))
                {
                    return BadRequest("Level must be one of: Verbose, Debug, Information, Warning, Error, Fatal");
                }

                Program.LevelSwitch.MinimumLevel = level;
                Log.Information("Minimum log level set to {Level}", level);
            }

            if (request?.Framework is not null)
            {
                if (!Enum.TryParse<Serilog.Events.LogEventLevel>(request.Framework, ignoreCase: true, out var framework))
                {
                    return BadRequest("Framework level must be one of: Verbose, Debug, Information, Warning, Error, Fatal");
                }

                Program.FrameworkLevelSwitch.MinimumLevel = framework;
                Log.Information("Framework (Microsoft.*) minimum log level set to {Level}", framework);
            }

            return Ok(new
            {
                level = Program.LevelSwitch.MinimumLevel.ToString(),
                framework = Program.FrameworkLevelSwitch.MinimumLevel.ToString(),
            });
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

    public record LogLevelRequest
    {
        public string Level { get; init; }

        /// <summary>
        ///     Minimum level for Microsoft.* (ASP.NET, EF Core, SignalR) events. Optional; omitting
        ///     it leaves the framework floor untouched.
        /// </summary>
        public string Framework { get; init; }
    }

    public record BrowserLogEntry
    {
        public string Level { get; init; }
        public string Message { get; init; }
        public string Context { get; init; }
    }
}
