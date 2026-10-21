// SPDX-License-Identifier: AGPL-3.0-only
namespace resonance.Analysis.API
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Collections.Concurrent;
    using System.Security.Cryptography;
    using System.Text.Json;
    using Asp.Versioning;
    using resonance.Analysis.UsbExport;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;

    [ApiController]
    [ApiVersion("0")]
    [Route("api/v{version:apiVersion}/analysis/pioneer-link")]
    [Authorize(Policy = AuthPolicy.Any)]
    public class PioneerLinkController : ControllerBase
    {
        private record Pairing(DateTimeOffset Expires);
        private static readonly string PairingFile = Path.Combine(Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT") ?? Path.GetTempPath(), "network-link-pairings.json");
        private static readonly ConcurrentDictionary<string, Pairing> Pairings = LoadPairings();
        private static ConcurrentDictionary<string, Pairing> LoadPairings()
        {
            try { return new ConcurrentDictionary<string, Pairing>(JsonSerializer.Deserialize<System.Collections.Generic.Dictionary<string, Pairing>>(System.IO.File.ReadAllText(PairingFile))); }
            catch (IOException) { return new(); }
            catch (JsonException) { return new(); }
        }
        private static string TokenHash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
        private static void SavePairings()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PairingFile));
            var temporary = PairingFile + ".tmp";
            System.IO.File.WriteAllText(temporary, JsonSerializer.Serialize(Pairings));
            if (!OperatingSystem.IsWindows()) System.IO.File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            System.IO.File.Move(temporary, PairingFile, true);
        }
        private static readonly object SyncGate = new();
        private static string syncRevision;
        private static string syncJobId;
        private readonly UsbExportService exports;
        public PioneerLinkController(UsbExportService exports) => this.exports = exports;
        private static readonly string[] Platforms = { "macos", "windows", "linux", "source" };
        private static string Installer(string platform) => Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_INSTALLER");
        private static string Archive(string platform) => Environment.GetEnvironmentVariable($"RESONANCE_PIONEER_HELPER_{platform.ToUpperInvariant()}_ARCHIVE");
        [HttpGet]
        public IActionResult Status() => Ok(new { enabled = exports.Enabled, trackCount = exports.NetworkLibraryTrackCount, experimental = true, hardwareValidated = false, helperPlatforms = Platforms.Where(p => System.IO.File.Exists(Archive(p))).ToArray() });
        [HttpPost]
        public IActionResult PrepareLibrary()
        {
            try { return Accepted(exports.StartNetworkLibrary()); }
            catch (ArgumentException exception) { return BadRequest(exception.Message); }
            catch (InvalidOperationException exception) { return StatusCode(503, exception.Message); }
        }
        [HttpPost("connection")]
        public IActionResult Connection()
        {
            if (!exports.Enabled) return StatusCode(503, "Network library worker is not configured.");
            foreach (var pair in Pairings.Where(p => p.Value.Expires < DateTimeOffset.UtcNow)) Pairings.TryRemove(pair.Key, out _);
            if (Pairings.Count >= 8) return Conflict("Revoke existing helper connections before adding another.");
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var expires = DateTimeOffset.UtcNow.AddDays(30);
            lock (SyncGate) { Pairings[TokenHash(token)] = new Pairing(expires); SavePairings(); }
            var config = new { schemaVersion = 1, serverUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}/api/v0/analysis/pioneer-link/sync", token, expires };
            return File(JsonSerializer.SerializeToUtf8Bytes(config, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }), "application/vnd.resonance.handoff+json", "resonance-library.resonance");
        }
        [HttpDelete("connections")]
        public IActionResult RevokeConnections() { lock (SyncGate) { Pairings.Clear(); SavePairings(); } return Ok(new { revoked = true }); }
        private bool Paired() => Request.Headers.TryGetValue("X-Resonance-Link-Token", out var value)
            && value.Count == 1 && value.ToString().Length == 64 && Pairings.TryGetValue(TokenHash(value.ToString()), out var pairing) && pairing.Expires > DateTimeOffset.UtcNow;
        [AllowAnonymous]
        [HttpGet("sync")]
        public IActionResult Sync()
        {
            if (!Paired()) return Unauthorized();
            lock (SyncGate)
            {
                var revision = exports.NetworkLibraryRevision();
                UsbExportJob job = null;
                if (syncJobId != null) { try { job = exports.Read(syncJobId); } catch (FileNotFoundException) { syncJobId = null; } }
                // Finish an in-flight snapshot first. A later poll catches changes that arrived meanwhile.
                var active = job != null && job.Status is not ("completed" or "failed" or "cancelled");
                if (!active && (revision != syncRevision || syncJobId == null))
                {
                    try { job = exports.StartNetworkLibrary(); syncJobId = job.JobId; syncRevision = revision; }
                    catch (ArgumentException exception) { return Conflict(new { error = exception.Message }); }
                    catch (InvalidOperationException exception) { return StatusCode(503, new { error = exception.Message }); }
                }
                return Ok(new { revision = syncRevision, trackCount = exports.NetworkLibraryTrackCount, job });
            }
        }
        [AllowAnonymous]
        [HttpGet("sync/download/{id}")]
        public IActionResult SyncDownload(string id)
        {
            if (!Paired()) return Unauthorized();
            lock (SyncGate)
            {
                if (id != syncJobId) return NotFound();
                try { return PhysicalFile(exports.Download(id), "application/zip", "resonance-network-library.zip", true); }
                catch (FileNotFoundException) { return NotFound(); }
                catch (InvalidOperationException exception) { return Conflict(exception.Message); }
            }
        }
        [HttpGet("helper")]
        public IActionResult Helper([FromQuery] string platform, [FromQuery] string format = "installer")
        {
            if (!Platforms.Contains(platform)) return BadRequest("Unknown helper platform.");
            var path = platform == "source" || format == "archive" ? Archive(platform) : Installer(platform);
            if (string.IsNullOrEmpty(path) || !Path.IsPathFullyQualified(path) || !System.IO.File.Exists(path)) return NotFound("Helper archive is not configured on this server.");
            return PhysicalFile(path, Path.GetExtension(path) == ".zip" ? "application/zip" : "application/octet-stream", Path.GetFileName(path), true);
        }
    }
}
