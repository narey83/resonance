// <copyright file="BridgeController.Updates.cs" company="John Narey">
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

// SPDX-License-Identifier: AGPL-3.0-only
namespace resonance.Core.API
{
    using System;
    using System.IO;
    using System.Text.Json;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    /// <summary>
    /// Serves signed Resonance Bridge engine releases to paired clients.
    /// </summary>
    public partial class BridgeController
    {
        [AllowAnonymous]
        [HttpGet("updates/{os}/{arch}")]
        public IActionResult BridgeUpdate(string os, string arch)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            var path = ReleaseManifest(os, arch);
            if (path == null || !System.IO.File.Exists(path))
            {
                return NotFound("No helper release is configured for this platform.");
            }

            Response.Headers.CacheControl = "no-store";
            return PhysicalFile(path, "application/json");
        }

        [AllowAnonymous]
        [HttpGet("updates/{os}/{arch}/binary")]
        public IActionResult BridgeUpdateBinary(string os, string arch, [FromQuery] string sha256)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            if (sha256 == null || sha256.Length != 64 || !System.Linq.Enumerable.All(sha256, c => c is (>= '0' and <= '9') or (>= 'a' and <= 'f')))
            {
                return BadRequest("A release SHA-256 is required.");
            }

            var manifest = ReleaseManifest(os, arch);
            if (manifest == null || !System.IO.File.Exists(manifest))
            {
                return NotFound();
            }

            try
            {
                if (new FileInfo(manifest).Length > 32768)
                {
                    return StatusCode(503, "Invalid helper release metadata.");
                }

                using var envelope = JsonDocument.Parse(System.IO.File.ReadAllBytes(manifest));
                using var payload = JsonDocument.Parse(Convert.FromBase64String(envelope.RootElement.GetProperty("payload").GetString()));
                if (payload.RootElement.GetProperty("sha256").GetString() != sha256)
                {
                    return NotFound("This release is no longer current; check for updates again.");
                }
            }
            catch (Exception exception) when (exception is IOException or JsonException or FormatException or InvalidOperationException or System.Collections.Generic.KeyNotFoundException)
            {
                return StatusCode(503, "Helper release metadata is unavailable.");
            }

            var binary = Path.Combine(Path.GetDirectoryName(manifest), sha256 + ".bin");
            if (!System.IO.File.Exists(binary))
            {
                return NotFound();
            }

            Response.Headers.CacheControl = "no-store";
            return PhysicalFile(binary, "application/octet-stream", "resonance-bridge-update", true);
        }

        private static string ReleaseManifest(string os, string arch)
        {
            if ((os != "darwin" && os != "windows" && os != "linux") || (arch != "arm64" && arch != "amd64"))
            {
                return null;
            }

            var root = BridgeReleaseRoot();
            return string.IsNullOrWhiteSpace(root) || !Path.IsPathFullyQualified(root) ? null : Path.Combine(root, os + "-" + arch + ".json");
        }

        private static string BridgeReleaseRoot()
        {
            var root = Environment.GetEnvironmentVariable("RESONANCE_BRIDGE_RELEASE_ROOT")
                ?? Environment.GetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT")
                ?? Path.Combine(Program.AppDirectory ?? Environment.GetEnvironmentVariable("RESONANCE_APP_DIR") ?? AppContext.BaseDirectory, "bridge-releases");
            return Path.IsPathFullyQualified(root) ? root : null;
        }

        private static string PublishedBridgeFile(string name)
        {
            var root = BridgeReleaseRoot();
            return root == null ? null : Path.Combine(root, name);
        }
    }
}
