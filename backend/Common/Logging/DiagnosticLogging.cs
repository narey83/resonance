// <copyright file="DiagnosticLogging.cs" company="John Narey">
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

namespace resonance
{
    using System;
    using Microsoft.EntityFrameworkCore;
    using Microsoft.Extensions.Logging;
    using Serilog;
    using Serilog.Events;

    /// <summary>Development diagnostics are independent of security-sensitive debug features.</summary>
    internal static class DiagnosticLogging
    {
        internal static bool DevelopmentEnabled { get; } = IsDevelopment(
            Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT"),
            Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT"));

        internal static bool IsDevelopment(string dotnetEnvironment, string aspnetEnvironment)
            => string.Equals(dotnetEnvironment ?? aspnetEnvironment, "Development", StringComparison.OrdinalIgnoreCase);

        internal static LogEventLevel ApplicationLevel(bool development)
            => development ? LogEventLevel.Debug : LogEventLevel.Information;

        internal static bool AcceptRemoteLevel(bool development, string level)
            => development || level is "Warning" or "Error";

        internal static void ConfigureDatabase(DbContextOptionsBuilder options, bool development, bool logSql)
        {
            // Neither development diagnostics nor the SQL switch may disclose parameter values.
            options.EnableSensitiveDataLogging(false).EnableDetailedErrors(development);
            if (development && logSql)
            {
                options.LogTo(message => Log.ForContext("SourceContext", Logs.Database)
                    .Debug("{DatabaseDiagnostic}", Core.Http.SensitiveData.RedactText(message)), LogLevel.Information);
            }
        }
    }
}
