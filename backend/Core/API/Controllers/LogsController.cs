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
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.EntityFrameworkCore;
    using Microsoft.Extensions.Options;
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
        public LogsController(IHubContext<LogsHub> logHub, IDbContextFactory<LogsDbContext> logsDbContextFactory, IOptionsMonitor<resonance.Options> options)
        {
            LogHub = logHub;
            LogsDbContextFactory = logsDbContextFactory;
            Options = options;
        }

        private IHubContext<LogsHub> LogHub { get; }
        private IDbContextFactory<LogsDbContext> LogsDbContextFactory { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Application);

        /// <summary>Hourly counters for compacted logs; raw message detail has expired.</summary>
        /// <returns>An HTTP response containing hourly log counts or a request/storage error.</returns>
        [HttpGet("summaries")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public async Task<IActionResult> Summaries([FromQuery] int days = 7)
        {
            if (days < 1 || days > 90)
            {
                return BadRequest("Days must be between 1 and 90");
            }

            if (!Program.DatabaseLoggingEnabled)
            {
                return Ok(Array.Empty<object>());
            }

            await using var db = await LogsDbContextFactory.CreateDbContextAsync(HttpContext.RequestAborted);
            if (!db.Database.IsSqlite())
            {
                return StatusCode(501, "Log rollups are available with SQLite storage");
            }

            await LogRollupStore.EnsureSchemaAsync(db, HttpContext.RequestAborted);
            var from = DateTime.UtcNow.AddDays(-days);
            var rows = await db.Database.SqlQuery<HourlyLogSummary>($"""
                SELECT "Hour", "Level", "SourceContext", "Count", "FirstSeen", "LastSeen"
                FROM "LogHourlySummaries" WHERE "Hour" >= {from}
                ORDER BY "Hour" DESC, "Level", "SourceContext" LIMIT 20000
                """).ToListAsync(HttpContext.RequestAborted);
            return Ok(rows);
        }

        /// <summary>
        ///     Gets a paginated, filtered list of log entries, from PostgreSQL when
        ///     <c>Logger.Postgres</c> is enabled or the daily JSONL log files otherwise.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public async Task<IActionResult> Get(
            [FromQuery] int offset = 0,
            [FromQuery] int limit = 100,
            [FromQuery] string[] level = null,
            [FromQuery] string[] context = null,
            [FromQuery] string search = null,
            [FromQuery] DateTime? from = null,
            [FromQuery] DateTime? to = null,
            [FromQuery] long? afterId = null,
            [FromQuery] long? beforeId = null)
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
                List<LogRecord> items;
                int total;

                if (Program.DatabaseLoggingEnabled)
                {
                    await using var db = await LogsDbContextFactory.CreateDbContextAsync(HttpContext.RequestAborted);

                    (items, total) = await LogQueryService.QueryAsync(
                        db,
                        afterId,
                        level,
                        context,
                        search,
                        from,
                        to,
                        offset,
                        limit,
                        HttpContext.RequestAborted,
                        beforeId);
                }
                else
                {
                    (items, total) = LogFileReader.Query(
                        Program.LogDirectory,
                        level,
                        context,
                        search,
                        from,
                        to,
                        offset,
                        limit,
                        HttpContext.RequestAborted);
                }

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
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult GetContexts() => Ok(resonance.Logs.All);

        /// <summary>
        ///     Gets the global and framework minimum log levels.
        /// </summary>
        /// <returns></returns>
        [HttpGet("level")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
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
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
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
            if (string.IsNullOrWhiteSpace(entry?.Message) || entry.Message.Length > 8192 || entry.Context?.Length > 128 || entry.SubContext?.Length > 256)
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

            // Log through Serilog ONLY. The delegating sink in Program.cs already builds a LogRecord
            // from every event, enqueues it on LogBuffer and raises LogEmitted — so doing that here
            // as well wrote two identical entries for every entry a client sent (identical timestamps
            // to the millisecond, confirmed on every remote log line the mobile app and browser sent).
            var remoteLog = Log.ForContext("SourceContext", context);

            if (!string.IsNullOrWhiteSpace(entry.SubContext))
            {
                remoteLog = remoteLog.ForContext("SubContext", entry.SubContext);
            }

            switch (level)
            {
                case "Error": remoteLog.Error("{RemoteMessage}", resonance.Core.Http.SensitiveData.RedactText(entry.Message)); break;
                case "Warning": remoteLog.Warning("{RemoteMessage}", resonance.Core.Http.SensitiveData.RedactText(entry.Message)); break;
                default: remoteLog.Information("{RemoteMessage}", resonance.Core.Http.SensitiveData.RedactText(entry.Message)); break;
            }

            return Ok();
        }

        public sealed class HourlyLogSummary
        {
            public DateTime Hour { get; set; }
            public string Level { get; set; } = string.Empty;
            public string SourceContext { get; set; } = string.Empty;
            public long Count { get; set; }
            public DateTime FirstSeen { get; set; }
            public DateTime LastSeen { get; set; }
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
        public string SubContext { get; init; }
    }
}
