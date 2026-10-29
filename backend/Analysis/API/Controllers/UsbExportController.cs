// <copyright file="UsbExportController.cs" company="John Narey">
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

namespace resonance.Analysis.API
{
    using System;
    using System.IO;
    using System.Security.Claims;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.Json;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Analysis.UsbExport;

    [ApiController]
    [ApiVersion("0")]
    [Route("api/v{version:apiVersion}/analysis/usb-export")]
    [Authorize(Policy = AuthPolicy.FeatureLibrary)]
    public class UsbExportController : ControllerBase
    {
        private static readonly object TransferGate = new();
        private readonly UsbExportService exports;
        public UsbExportController(UsbExportService exports) => this.exports = exports;
        [HttpGet]
        public IActionResult Library() => Ok(exports.Library());
        [HttpPost("library")]
        public IActionResult LibrarySelection([FromBody] string[] paths)
        {
            try
            {
                return Ok(exports.Library(paths));
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
        }

        [HttpGet("sources")]
        public IActionResult Sources() => Ok(exports.Sources(User.FindFirstValue(ClaimTypes.Name) ?? string.Empty));

        [HttpPost("resolve")]
        public IActionResult Resolve([FromBody] UsbExportSourceRequest request)
        {
            try
            {
                return Ok(exports.ResolveSource(request, User.FindFirstValue(ClaimTypes.Name) ?? string.Empty));
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (InvalidOperationException exception)
            {
                return Conflict(exception.Message);
            }
        }

        [HttpGet("history")]
        public IActionResult History() => Ok(exports.History());

        [HttpGet("{id}/inspection")]
        public IActionResult Inspect(string id)
        {
            try
            {
                return Ok(exports.Inspect(id));
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException exception)
            {
                return Conflict(exception.Message);
            }
            catch (Exception exception) when (exception is IOException or JsonException)
            {
                return StatusCode(503, "Export database inspection is temporarily unavailable.");
            }
        }

        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult Start([FromBody] UsbExportRequest request)
        {
            try
            {
                return Accepted(exports.Start(request, User.FindFirstValue(ClaimTypes.Name) ?? string.Empty));
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (InvalidOperationException exception)
            {
                return StatusCode(503, exception.Message);
            }
        }

        [HttpGet("helper")]
        public IActionResult Helper([FromQuery] string platform)
        {
            try
            {
                return PhysicalFile(exports.HelperDownload(platform), "application/zip", $"resonance-usb-helper-{platform}.zip", true);
            }
            catch (ArgumentException exception)
            {
                return BadRequest(exception.Message);
            }
            catch (FileNotFoundException exception)
            {
                return NotFound(exception.Message);
            }
            catch (IOException)
            {
                return StatusCode(503, "Helper archive is temporarily unavailable.");
            }
        }

        [HttpPost("{id}/transfer")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult Transfer(string id)
        {
            try
            {
                var archive = exports.Download(id);
                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                var expires = DateTimeOffset.UtcNow.AddHours(24);
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
                var access = Path.Combine(Path.GetDirectoryName(archive), "helper-access.json");
                lock (TransferGate)
                {
                    System.IO.File.WriteAllText(access, JsonSerializer.Serialize(new TransferAccess(hash, expires)));
                    if (!OperatingSystem.IsWindows())
                    {
                        System.IO.File.SetUnixFileMode(access, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                    }
                }

                var ticket = new { schemaVersion = 1, serverUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}/api/v0/analysis/usb-export/transfer/{id}", token, expires };
                return File(JsonSerializer.SerializeToUtf8Bytes(ticket), "application/vnd.resonance.handoff+json", "resonance-export.resonance");
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException exception)
            {
                return Conflict(exception.Message);
            }
        }

        [AllowAnonymous]
        [HttpGet("transfer/{id}")]
        public IActionResult TransferDownload(string id)
        {
            try
            {
                var archive = exports.Download(id);
                if (!Request.Headers.TryGetValue("X-Resonance-Link-Token", out var value) || value.Count != 1 || value.ToString().Length != 64)
                {
                    return Unauthorized();
                }

                TransferAccess access;
                lock (TransferGate)
                {
                    access = JsonSerializer.Deserialize<TransferAccess>(System.IO.File.ReadAllText(Path.Combine(Path.GetDirectoryName(archive), "helper-access.json")));
                }

                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToString())));
                if (access == null || access.Expires < DateTimeOffset.UtcNow || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(hash), Encoding.ASCII.GetBytes(access.Hash)))
                {
                    return Unauthorized();
                }

                return PhysicalFile(archive, "application/zip", "resonance-usb.zip", true);
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException exception)
            {
                return Conflict(exception.Message);
            }
            catch (JsonException)
            {
                return Unauthorized();
            }
        }

        [HttpGet("{id}")]
        public IActionResult Status(string id)
        {
            try
            {
                return Ok(exports.Read(id));
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpDelete("{id}")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult Cancel(string id)
        {
            try
            {
                return Ok(new { cancelled = exports.Cancel(id) });
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
        }

        [HttpGet("{id}/download")]
        public IActionResult Download(string id)
        {
            try
            {
                return PhysicalFile(exports.Download(id), "application/zip", "resonance-usb.zip", true);
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException exception)
            {
                return Conflict(exception.Message);
            }
        }

        private record TransferAccess(string Hash, DateTimeOffset Expires);
    }
}
