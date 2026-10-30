// <copyright file="DevelopmentRequestLoggingMiddleware.cs" company="John Narey">
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

namespace resonance.Core.Http
{
    using System;
    using System.Diagnostics;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Routing;
    using Serilog;
    using Serilog.Context;

    /// <summary>Correlates development request timings without logging URLs, bodies or headers.</summary>
    public sealed class DevelopmentRequestLoggingMiddleware
    {
        public DevelopmentRequestLoggingMiddleware(RequestDelegate next, ILogger logger = null)
        {
            Next = next;
            Log = (logger ?? Serilog.Log.Logger).ForContext("SourceContext", Logs.Http);
        }

        private RequestDelegate Next { get; }
        private ILogger Log { get; }

        public async Task InvokeAsync(HttpContext context)
        {
            var started = Stopwatch.GetTimestamp();
            Exception failure = null;
            using var requestScope = LogContext.PushProperty("RequestId", context.TraceIdentifier);
            try
            {
                await Next(context);
            }
            catch (Exception ex)
            {
                failure = ex;
                throw;
            }
            finally
            {
                var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(unmatched)";
                var status = failure is OperationCanceledException && context.RequestAborted.IsCancellationRequested
                    ? 499 : failure != null ? 500 : context.Response.StatusCode;
                Log.Debug("HTTP {Method} {Route} completed {StatusCode} in {ElapsedMilliseconds:F1}ms; error {ErrorType}",
                    context.Request.Method, route, status, Stopwatch.GetElapsedTime(started).TotalMilliseconds,
                    failure?.GetType().Name ?? "none");
            }
        }
    }
}
