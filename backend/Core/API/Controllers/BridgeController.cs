// <copyright file="BridgeController.cs" company="John Narey">
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
    using System.Collections.Concurrent;
    using System.IO;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text.Json;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Analysis.UsbExport;

    /// <summary>
    /// Provides Resonance Bridge pairing, distribution and device integration APIs.
    /// </summary>
    [ApiController]
    [ApiVersion("0")]
    [Route("api/v{version:apiVersion}/bridge")]
    [Route("api/v{version:apiVersion}/helper")]
    [Route("api/v{version:apiVersion}/analysis/pioneer-link")]
    [Authorize(Policy = AuthPolicy.FeatureLibrary)]
    public partial class BridgeController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, Pairing> Pairings = LoadPairings();
        private static readonly ConcurrentDictionary<string, BridgePresence> BridgePresences = new();

        private static readonly object SyncGate = new();
        private static readonly string[] Platforms = { "macos", "windows", "linux", "source" };
        private static int workerUnavailableLogged;
        private static string syncRevision;
        private static string syncJobId;
        private readonly UsbExportService exports;
        private readonly BridgeLibraryBatchService batches;

        public BridgeController(UsbExportService exports, BridgeLibraryBatchService batches = null)
        {
            this.exports = exports;
            this.batches = batches;
        }

        private static string PairingFile => Environment.GetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE")
            ?? Path.Combine(Program.DataDirectory ?? Path.Combine(Program.AppDirectory ?? AppContext.BaseDirectory, "data"), "bridge-pairings.json");

        private static Serilog.ILogger BridgeLog => Serilog.Log.ForContext("SourceContext", "Bridge");

        [HttpGet]
        public IActionResult Status()
        {
            var readiness = batches?.Status;
            var now = DateTimeOffset.UtcNow;
            var pairings = Pairings
                .Where(item => item.Value.Expires > now)
                .Select(item =>
                {
                    BridgePresences.TryGetValue(item.Key, out var presence);
                    var connected = presence != null && now - presence.LastSeen < TimeSpan.FromMinutes(1);
                    return new PairingView(PairingId(item.Key), item.Value.Expires, connected, presence);
                })
                .OrderByDescending(item => item.Connected)
                .ThenByDescending(item => item.Presence?.LastSeen)
                .ToArray();
            var bridges = pairings
                .Where(item => item.Connected)
                .Select(item => new
                {
                    pairingId = item.Id,
                    expires = item.Expires,
                    item.Presence.Name,
                    item.Presence.Version,
                    item.Presence.Platform,
                    item.Presence.Architecture,
                    item.Presence.Address,
                    item.Presence.ObservedAddress,
                    item.Presence.LastSeen,
                    item.Presence.LatencyMs,
                })
                .OrderByDescending(item => item.LastSeen)
                .ToArray();
            return Ok(new
            {
                enabled = exports.Enabled,

                // Use the background snapshot so presence never waits for a full metadata scan.
                trackCount = readiness?.IndexedTracks ?? exports.NetworkLibraryTrackCount,
                readyTrackCount = readiness?.ReadyTracks ?? 0,
                readinessStatus = readiness?.Status,
                readinessMessage = readiness?.Message,
                batchCount = readiness?.Batches.Length ?? 0,
                experimental = true,
                hardwareValidated = false,
                helperPlatforms = Platforms.Where(p => System.IO.File.Exists(Archive(p))).ToArray(),
                pairedBridgeCount = pairings.Length,
                bridgePairings = pairings.Select(item => new { id = item.Id, expires = item.Expires, connected = item.Connected }).ToArray(),
                connectedBridges = bridges,
            });
        }

        [HttpPost]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult PrepareLibrary()
        {
            try
            {
                return Accepted(exports.StartNetworkLibrary());
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

        [HttpPost("connection")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult Connection()
        {
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var expires = DateTimeOffset.UtcNow.AddDays(30);
            lock (SyncGate)
            {
                foreach (var pair in Pairings.Where(p => p.Value.Expires <= DateTimeOffset.UtcNow))
                {
                    Pairings.TryRemove(pair.Key, out _);
                }

                if (Pairings.Count >= 8)
                {
                    return Conflict("Revoke existing Bridge connections before adding another.");
                }

                var hash = TokenHash(token);
                var next = Pairings.ToDictionary(p => p.Key, p => p.Value);
                next[hash] = new Pairing(expires);
                try
                {
                    SavePairings(next);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    BridgeLog.Error(exception, "Bridge connection state could not be saved");
                    return StatusCode(503, "Bridge could not save the connection. Check the server data directory permissions and try again.");
                }

                Pairings[hash] = next[hash];
                BridgeLog.Information("Bridge connection created; {ActiveConnections} active connection(s)", Pairings.Count);
            }

            var config = new { schemaVersion = 1, serverUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}/api/v0/bridge/sync", token, expires };
            return File(JsonSerializer.SerializeToUtf8Bytes(config, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }), "application/vnd.resonance.handoff+json", "resonance-bridge-pairing.resonance");
        }

        [HttpDelete("connections")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult RevokeConnections()
        {
            lock (SyncGate)
            {
                try
                {
                    SavePairings(new System.Collections.Generic.Dictionary<string, Pairing>());
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    BridgeLog.Error(exception, "Bridge connection revocation could not be saved");
                    return StatusCode(503, "Bridge could not revoke connections. Check the server data directory permissions and try again.");
                }

                var count = Pairings.Count;
                Pairings.Clear();
                BridgePresences.Clear();
                BridgeLog.Information("Bridge connections revoked; {RevokedConnections} connection(s) removed", count);
            }

            return Ok(new { revoked = true });
        }

        [HttpDelete("connections/{id}")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.ReadWriteOrAdministrator)]
        public IActionResult RevokeConnection(string id)
        {
            if (string.IsNullOrWhiteSpace(id) || id.Length != 12 || id.Any(character => !Uri.IsHexDigit(character)))
            {
                return NotFound();
            }

            lock (SyncGate)
            {
                var hash = Pairings.Keys.SingleOrDefault(key => string.Equals(PairingId(key), id, StringComparison.OrdinalIgnoreCase));
                if (hash == null)
                {
                    return NotFound();
                }

                var next = Pairings.Where(item => item.Key != hash).ToDictionary(item => item.Key, item => item.Value);
                try
                {
                    SavePairings(next);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    BridgeLog.Error(exception, "Bridge connection revocation could not be saved");
                    return StatusCode(503, "Bridge could not revoke the connection. Check the server data directory permissions and try again.");
                }

                Pairings.TryRemove(hash, out _);
                BridgePresences.TryRemove(hash, out _);
            }

            return Ok(new { revoked = true, id });
        }

        [AllowAnonymous]
        [HttpGet("sync")]
        public IActionResult Sync([FromQuery] string batch = null)
        {
            if (!TryPairing(out var pairingHash))
            {
                return Unauthorized();
            }

            RecordPresence(pairingHash);

            if (batches != null)
            {
                return Ok(batches.Request(batch));
            }

            if (exports?.Enabled != true)
            {
                if (System.Threading.Interlocked.Exchange(ref workerUnavailableLogged, 1) == 0)
                {
                    BridgeLog.Warning("Bridge library sync unavailable: export worker is not configured; pairing and software updates remain available");
                }

                return StatusCode(503, "Library preparation is not configured on this server. Bridge pairing and software updates remain available.");
            }

            System.Threading.Interlocked.Exchange(ref workerUnavailableLogged, 0);
            lock (SyncGate)
            {
                var revision = exports.NetworkLibraryRevision();
                UsbExportJob job = null;
                if (syncJobId != null)
                {
                    try
                    {
                        job = exports.Read(syncJobId);
                    }
                    catch (FileNotFoundException)
                    {
                        syncJobId = null;
                    }
                }

                // Finish an in-flight snapshot first. A later poll catches changes that arrived meanwhile.
                var active = job != null && job.Status is not ("completed" or "failed" or "cancelled");
                if (!active && (revision != syncRevision || syncJobId == null))
                {
                    try
                    {
                        job = exports.StartNetworkLibrary();
                        syncJobId = job.JobId;
                        syncRevision = revision;
                    }
                    catch (ArgumentException exception)
                    {
                        return Conflict(new { error = exception.Message });
                    }
                    catch (InvalidOperationException exception)
                    {
                        return StatusCode(503, new { error = exception.Message });
                    }
                }

                return Ok(new { revision = syncRevision, trackCount = exports.NetworkLibraryTrackCount, job });
            }
        }

        [AllowAnonymous]
        [HttpGet("sync/download/{id}")]
        public IActionResult SyncDownload(string id)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            if (batches != null)
            {
                if (!batches.TryAcquireDownload(id, out var path, out var release))
                {
                    return NotFound("Batch is no longer staged. Refresh its status to resume.");
                }

                HttpContext.RequestAborted.Register(release);
                Response.OnCompleted(() =>
                {
                    release();
                    return System.Threading.Tasks.Task.CompletedTask;
                });
                return PhysicalFile(path, "application/zip", "resonance-bridge-batch.zip", true);
            }

            lock (SyncGate)
            {
                if (id != syncJobId)
                {
                    return NotFound();
                }

                try
                {
                    return PhysicalFile(exports.Download(id), "application/zip", "resonance-network-library.zip", true);
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
        }

        [AllowAnonymous]
        [HttpPost("sync/ack/{batch}/{id}")]
        public IActionResult AcknowledgeBatch(string batch, string id)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            return batches != null && batches.Acknowledge(batch, id)
                ? Ok(new { acknowledged = true }) : Conflict("Batch staging is still in use. Retry acknowledgement shortly.");
        }

        [AllowAnonymous]
        [HttpGet("sync/audio/{sourceKey}")]
        public IActionResult StreamAudio(string sourceKey)
        {
            if (!Paired())
            {
                return Unauthorized();
            }

            if (batches == null || !batches.TryGetStream(sourceKey, out var path))
            {
                return NotFound("Track is no longer export-ready. Refresh the Bridge library.");
            }

            return PhysicalFile(path, "application/octet-stream", enableRangeProcessing: true);
        }

        [HttpGet("download")]
        [HttpGet("helper")]
        public IActionResult Download([FromQuery] string platform, [FromQuery] string format = "installer")
        {
            if (!Platforms.Contains(platform))
            {
                return BadRequest("Unknown helper platform.");
            }

            var path = platform == "source" || format == "archive" ? Archive(platform) : Installer(platform);
            if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path) || !System.IO.File.Exists(path))
            {
                return NotFound("Helper archive is not configured on this server.");
            }

            return PhysicalFile(path, Path.GetExtension(path) == ".zip" ? "application/zip" : "application/octet-stream", Path.GetFileName(path), true);
        }

        private static ConcurrentDictionary<string, Pairing> LoadPairings()
        {
            try
            {
                var path = PairingFile;
                var legacy = Path.Combine(Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT") ?? Path.GetTempPath(), "network-link-pairings.json");
                if (!Path.IsPathFullyQualified(path))
                {
                    return new();
                }

                if (Path.IsPathFullyQualified(legacy) && !System.IO.File.Exists(path) && System.IO.File.Exists(legacy))
                {
                    // Migrate only when no durable store exists; never revive a revoked legacy snapshot.
                    var old = JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, Pairing>>(System.IO.File.ReadAllText(legacy));
                    if (old != null)
                    {
                        SavePairings(old);
                    }
                }

                var saved = JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, Pairing>>(System.IO.File.ReadAllText(path));
                return saved == null ? new() : new(saved);
            }
            catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
            {
                return new();
            }
        }

        private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
        private static void SavePairings(System.Collections.Generic.IReadOnlyDictionary<string, Pairing> values)
        {
            var path = PairingFile;
            if (!Path.IsPathFullyQualified(path))
            {
                throw new IOException("The Bridge pairing store requires an absolute path.");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    if (!OperatingSystem.IsWindows())
                    {
                        System.IO.File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                    }

                    JsonSerializer.Serialize(stream, values);
                    stream.Flush(true);
                }

                System.IO.File.Move(temporary, path, true);
            }
            finally
            {
                if (System.IO.File.Exists(temporary))
                {
                    System.IO.File.Delete(temporary);
                }
            }
        }

        private static string Installer(string platform) => Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_INSTALLER")
            ?? PublishedBridgeFile(platform switch
            {
                "macos" => "resonance-bridge-macos.pkg",
                "windows" => "resonance-bridge-windows-setup.exe",
                "linux" => "resonance-bridge-linux-amd64.deb",
                _ => "unavailable",
            });
        private static string Archive(string platform) => Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_ARCHIVE")
            ?? PublishedBridgeFile($"resonance-bridge-{platform}.zip");

        private static string PairingId(string hash) => hash[..12].ToLowerInvariant();

        private bool Paired() => TryPairing(out _);
        private bool TryPairing(out string hash)
        {
            hash = null;
            if (!Request.Headers.TryGetValue("X-Resonance-Link-Token", out var value) || value.Count != 1 || value.ToString().Length != 64)
            {
                return false;
            }

            hash = TokenHash(value.ToString());
            return Pairings.TryGetValue(hash, out var pairing) && pairing.Expires > DateTimeOffset.UtcNow;
        }

        private void RecordPresence(string hash)
        {
            static string Header(Microsoft.AspNetCore.Http.IHeaderDictionary headers, string name, int maximum = 80)
            {
                var value = headers[name].ToString().Trim();
                return value.Length <= maximum ? value : value[..maximum];
            }

            var reportedAddress = Header(Request.Headers, "X-Resonance-Bridge-Address", 64);
            if (!System.Net.IPAddress.TryParse(reportedAddress, out _))
            {
                reportedAddress = null;
            }

            var observedAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
            _ = long.TryParse(Header(Request.Headers, "X-Resonance-Bridge-Latency-Ms", 12), out var latencyMs);
            latencyMs = Math.Clamp(latencyMs, 0, 30000);
            BridgePresences[hash] = new BridgePresence(
                Header(Request.Headers, "X-Resonance-Bridge-Name"),
                Header(Request.Headers, "X-Resonance-Bridge-Version", 32),
                Header(Request.Headers, "X-Resonance-Bridge-Platform", 24),
                Header(Request.Headers, "X-Resonance-Bridge-Architecture", 24),
                reportedAddress,
                observedAddress,
                latencyMs,
                DateTimeOffset.UtcNow);
        }

        private record Pairing(DateTimeOffset Expires);
        private record PairingView(string Id, DateTimeOffset Expires, bool Connected, BridgePresence Presence);
        private record BridgePresence(string Name, string Version, string Platform, string Architecture, string Address, string ObservedAddress, long LatencyMs, DateTimeOffset LastSeen);
    }
}
