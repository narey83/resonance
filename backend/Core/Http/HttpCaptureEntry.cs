// <copyright file="HttpCaptureEntry.cs" company="John Narey">
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

    /// <summary>
    ///     A single captured HTTP request/response, recorded into an in-memory ring buffer for
    ///     export as HAR. This is the backend analogue of the mobile app's on-device network log,
    ///     letting the two be loaded into the same HAR analyser for side-by-side comparison.
    /// </summary>
    public record HttpCaptureEntry
    {
        /// <summary>
        ///     Gets a monotonically increasing identifier, assigned in capture order.
        /// </summary>
        public long Id { get; init; }

        /// <summary>
        ///     Gets the UTC instant at which the request began processing.
        /// </summary>
        public DateTime StartedAt { get; init; }

        /// <summary>
        ///     Gets the server-side processing time in milliseconds (pipeline entry to response completion).
        /// </summary>
        public double DurationMs { get; init; }

        /// <summary>
        ///     Gets the HTTP method (GET, POST, …).
        /// </summary>
        public string Method { get; init; }

        /// <summary>
        ///     Gets the request path and query string (e.g. <c>/api/v0/logs?limit=100</c>).
        /// </summary>
        public string Url { get; init; }

        /// <summary>
        ///     Gets the absolute request URL including scheme and host.
        /// </summary>
        public string FullUrl { get; init; }

        /// <summary>
        ///     Gets the HTTP response status code, or 0 when no response was produced.
        /// </summary>
        public int Status { get; init; }

        /// <summary>
        ///     Gets the request headers (sensitive values redacted).
        /// </summary>
        public IReadOnlyList<KeyValuePair<string, string>> RequestHeaders { get; init; }

        /// <summary>
        ///     Gets the response headers.
        /// </summary>
        public IReadOnlyList<KeyValuePair<string, string>> ResponseHeaders { get; init; }
    }
}
