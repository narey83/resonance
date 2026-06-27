// <copyright file="RequestCaptureMiddleware.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.Http;

    /// <summary>
    ///     Records each HTTP request into <see cref="Program.HttpCaptureBuffer"/> with its server-side
    ///     processing time, so recent traffic can be exported as HAR and compared against the mobile
    ///     app's network log.
    /// </summary>
    public class RequestCaptureMiddleware
    {
        // Header values that must never be written into an exportable artifact.
        private static readonly HashSet<string> RedactedHeaders = new(StringComparer.OrdinalIgnoreCase)
        {
            "Authorization",
            "Cookie",
            "Set-Cookie",
            "X-API-Key",
        };

        private static long nextId;

        public RequestCaptureMiddleware(RequestDelegate next)
        {
            Next = next;
        }

        private RequestDelegate Next { get; }

        public async Task InvokeAsync(HttpContext context)
        {
            // Don't capture the export/clear calls themselves — they'd pollute the very buffer being read.
            if (context.Request.Path.StartsWithSegments("/api/v0/httpcapture", StringComparison.OrdinalIgnoreCase))
            {
                await Next(context);
                return;
            }

            var startedAt = DateTime.UtcNow;
            var stopwatch = Stopwatch.StartNew();

            var request = context.Request;
            var url = request.Path + request.QueryString;
            var fullUrl = $"{request.Scheme}://{request.Host}{request.PathBase}{url}";
            var method = request.Method;
            var requestHeaders = Snapshot(request.Headers);

            try
            {
                await Next(context);
            }
            finally
            {
                stopwatch.Stop();

                Program.HttpCaptureBuffer.Enqueue(new HttpCaptureEntry
                {
                    Id = Interlocked.Increment(ref nextId),
                    StartedAt = startedAt,
                    DurationMs = stopwatch.Elapsed.TotalMilliseconds,
                    Method = method,
                    Url = url,
                    FullUrl = fullUrl,
                    Status = context.Response?.StatusCode ?? 0,
                    RequestHeaders = requestHeaders,
                    ResponseHeaders = Snapshot(context.Response?.Headers),
                });
            }
        }

        private static IReadOnlyList<KeyValuePair<string, string>> Snapshot(IHeaderDictionary headers)
        {
            if (headers is null)
            {
                return Array.Empty<KeyValuePair<string, string>>();
            }

            return headers
                .Select(h => new KeyValuePair<string, string>(
                    h.Key,
                    RedactedHeaders.Contains(h.Key) ? "[redacted]" : h.Value.ToString()))
                .ToList();
        }
    }
}
