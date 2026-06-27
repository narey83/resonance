// <copyright file="HttpCaptureController.cs" company="John Narey">
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
    using System.Text;
    using System.Text.Json;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Core.Http;

    /// <summary>
    ///     Exports recently captured backend HTTP traffic as a HAR 1.2 (HTTP Archive) file, the
    ///     backend counterpart to the mobile app's network log export. Both can be loaded into the
    ///     same analyser (Chrome DevTools, Google HAR Analyzer, …) to compare client-observed latency
    ///     against server-side processing time.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    public class HttpCaptureController : ControllerBase
    {
        private static readonly JsonSerializerOptions HarJsonOptions = new() { WriteIndented = true };

        /// <summary>
        ///     Downloads the captured request buffer as a HAR 1.2 file.
        /// </summary>
        /// <returns></returns>
        [HttpGet("har")]
        [Authorize(Policy = AuthPolicy.Any)]
        [Produces("application/json")]
        public IActionResult GetHar()
        {
            // The buffer is newest-last (a queue); HAR convention is chronological, which it already is.
            var entries = Program.HttpCaptureBuffer.ToList();

            var har = new
            {
                log = new
                {
                    version = "1.2",
                    creator = new { name = "Resonance Backend HTTP Capture", version = "1.0.0" },
                    entries = entries.Select(e => new
                    {
                        startedDateTime = e.StartedAt.ToString("o"),
                        time = e.DurationMs,
                        request = new
                        {
                            method = e.Method,
                            url = e.FullUrl,
                            httpVersion = "HTTP/1.1",
                            cookies = Array.Empty<object>(),
                            headers = ToHeaderList(e.RequestHeaders),
                            queryString = Array.Empty<object>(),
                            headersSize = -1,
                            bodySize = -1,
                        },
                        response = new
                        {
                            status = e.Status,
                            statusText = string.Empty,
                            httpVersion = "HTTP/1.1",
                            cookies = Array.Empty<object>(),
                            headers = ToHeaderList(e.ResponseHeaders),
                            content = new { size = 0, mimeType = string.Empty },
                            redirectURL = string.Empty,
                            headersSize = -1,
                            bodySize = -1,
                        },
                        cache = new { },

                        // Server-side processing time is attributed entirely to `wait`; send + wait +
                        // receive must equal `time` for the file to validate. This mirrors the mobile
                        // export, so the analyser lines the two up consistently.
                        timings = new { send = 0, wait = e.DurationMs, receive = 0 },
                    }),
                },
            };

            var json = JsonSerializer.Serialize(har, HarJsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);
            var fileName = $"resonance-backend-{DateTime.UtcNow:yyyyMMdd-HHmmss}.har";

            return File(bytes, "application/json", fileName);
        }

        /// <summary>
        ///     Clears the captured request buffer.
        /// </summary>
        /// <returns></returns>
        [HttpDelete]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult Clear()
        {
            Program.HttpCaptureBuffer.Clear();
            return NoContent();
        }

        private static IEnumerable<object> ToHeaderList(IReadOnlyList<KeyValuePair<string, string>> headers)
            => (headers ?? Array.Empty<KeyValuePair<string, string>>())
                .Select(h => new { name = h.Key, value = h.Value });
    }
}
