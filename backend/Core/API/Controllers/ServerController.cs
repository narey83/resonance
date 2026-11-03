// <copyright file="ServerController.cs" company="JP Dillingham">
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

using Microsoft.Extensions.Options;

namespace resonance.Core.API
{
    using System;
    using System.Collections.Generic;
    using System.Net.Http;
    using System.Text.RegularExpressions;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Configuration;
    using Soulseek;

    /// <summary>
    ///     Server.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class ServerController : ControllerBase
    {
        /// <summary>
        ///     The maximum size of an uploaded profile picture, before downscaling. Generous enough for any
        ///     full-resolution photo, but bounded to avoid unbounded uploads.
        /// </summary>
        private const long MaxPictureUploadBytes = 64L * 1024 * 1024;

        public ServerController(
            ISoulseekClient soulseekClient,
            ConnectionWatchdog connectionWatchdog,
            IOptionsSnapshot<Options> optionsSnapshot,
            IStateSnapshot<State> stateSnapshot,
            IStateMutator<State> stateMutator,
            IHttpClientFactory httpClientFactory,
            SoulseekPresenceService presenceService)
        {
            Client = soulseekClient;
            PresenceService = presenceService;
            ConnectionWatchdog = connectionWatchdog;
            HttpClientFactory = httpClientFactory;
            OptionsSnapshot = optionsSnapshot;
            StateSnapshot = stateSnapshot;
            StateMutator = stateMutator;
        }

        /// <summary>
        ///     The fixed on-disk path of the profile picture managed by the web UI.
        /// </summary>
        private static string ManagedPicturePath => Program.ProfilePicturePath;

        private ISoulseekClient Client { get; }
        private SoulseekPresenceService PresenceService { get; }
        private ConnectionWatchdog ConnectionWatchdog { get; }
        private IHttpClientFactory HttpClientFactory { get; }
        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private IStateSnapshot<State> StateSnapshot { get; }
        private IStateMutator<State> StateMutator { get; }

        /// <summary>
        ///     Connects the client.
        /// </summary>
        /// <returns></returns>
        [HttpPut]
        [Route("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(StatusCodes.Status205ResetContent)]
        [ProducesResponseType(403)]
        public IActionResult Connect()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            StateMutator.SetValue(state => state with
            {
                Server = state.Server with { LastConnectionErrorCode = null },
            });

            // if the watchdog is already enabled, we're already attempting to connect. the user might have changed something
            // or perhaps is just being impatient; either way, restart the retry loop so they can see results faster
            // remember, we may be in a ~5 minute delay at this moment
            if (ConnectionWatchdog.IsEnabled)
            {
                ConnectionWatchdog.Restart();
                return StatusCode(StatusCodes.Status205ResetContent);
            }

            if (!ConnectionWatchdog.IsEnabled)
            {
                ConnectionWatchdog.Start();
                return Ok();
            }

            return Ok();
        }

        /// <summary>
        ///     Disconnects the client.
        /// </summary>
        /// <param name="message"></param>
        /// <returns></returns>
        [HttpDelete]
        [Route("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(403)]
        public IActionResult Disconnect([FromBody] string message)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            // stop the watchdog so that it will exit any retry logic
            ConnectionWatchdog.Stop(abortReconnect: true);

            if (Client.State.HasFlag(SoulseekClientStates.Connected))
            {
                // the IntentionalDisconnectException is used to indicate that the disconnect was intentional, which
                // prevents the watchdog from trying to reconnect
                Client.Disconnect(message, new IntentionalDisconnectException(message));
            }

            return NoContent();
        }

        /// <summary>
        ///     Retrieves the current state of the server.
        /// </summary>
        /// <returns></returns>
        /// <response code="200"></response>
        [HttpGet]
        [Route("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(ServerState), 200)]
        [ProducesResponseType(403)]
        public IActionResult Get()
        {
            return Ok(StateSnapshot.Value.Server);
        }

        [HttpGet("status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetStatus()
        {
            return Ok(new
            {
                presence = StateSnapshot.Value.User.Presence,
                description = OptionsSnapshot.Value.Soulseek.Description ?? string.Empty,
                hasPicture = System.IO.File.Exists(ManagedPicturePath),
            });
        }

        [HttpPost("status/activity")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public async Task<IActionResult> RecordPresenceActivity()
        {
            await PresenceService.RecordActivityAsync();
            return NoContent();
        }

        [HttpPut("status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        public async Task<IActionResult> SetStatus([FromBody] SetStatusRequest request)
        {
            if (request.Presence is not null)
            {
                if (request.Presence != "Online" && request.Presence != "Away")
                {
                    return BadRequest("Presence must be 'Online' or 'Away'");
                }

                var presence = request.Presence == "Away" ? UserPresence.Away : UserPresence.Online;

                await PresenceService.SetManualAsync(presence);
            }

            if (request.Description is not null)
            {
                // the description is written durably to the YAML config (picked up by reloadOnChange), not to
                // the volatile overlay, so it survives a restart. only administrators may change the config.
                if (!User.IsInRole(AuthRole.AdministratorOnly))
                {
                    return Forbid();
                }

                // an empty description removes the key entirely, clearing it
                PatchSoulseekConfig("description", string.IsNullOrEmpty(request.Description) ? null : request.Description);
            }

            return Ok(new
            {
                presence = StateSnapshot.Value.User.Presence,

                // echo what was just requested; the reloaded snapshot isn't visible synchronously after a YAML write
                description = request.Description ?? OptionsSnapshot.Value.Soulseek.Description ?? string.Empty,
                hasPicture = System.IO.File.Exists(ManagedPicturePath),
            });
        }

        /// <summary>
        ///     Gets the current user's profile picture, as served to the web UI.
        /// </summary>
        /// <returns></returns>
        [HttpGet("picture")]
        [AllowAnonymous]
        [ProducesResponseType(200)]
        [ProducesResponseType(404)]
        public IActionResult GetPicture([FromQuery] int? size)
        {
            var path = ManagedPicturePath;
            if (!System.IO.File.Exists(path))
            {
                return NotFound();
            }

            var info = new System.IO.FileInfo(path);
            var pixels = resonance.Common.ArtworkResizer.Bucket(size);
            var cache = HttpContext.RequestServices.GetService(typeof(Microsoft.Extensions.Caching.Memory.IMemoryCache)) as Microsoft.Extensions.Caching.Memory.IMemoryCache;
            var key = $"profile-art:v2:{path}:{info.LastWriteTimeUtc.Ticks}:{info.Length}:{pixels}";
            byte[] bytes;
            if (cache?.TryGetValue(key, out object cached) == true && cached is byte[] stored)
            {
                bytes = stored;
            }
            else
            {
                bytes = resonance.Common.ArtworkResizer.ResizeToJpeg(System.IO.File.ReadAllBytes(path), pixels);
                if (cache != null)
                {
                    using var entry = cache.CreateEntry(key);
                    entry.Value = bytes;
                    entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1);
                }
            }

            Response.Headers.CacheControl = "private, max-age=0, must-revalidate";
            return new FileContentResult(bytes, "image/jpeg")
            {
                EntityTag = new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes))}\""),
            };
        }

        /// <summary>
        ///     Sets the current user's profile picture. The image is normalised to a bounded JPEG and pointed at by the
        ///     Soulseek picture config, so peers see it too.
        /// </summary>
        /// <param name="file">The uploaded image.</param>
        /// <returns></returns>
        [HttpPost("picture")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [Consumes("multipart/form-data")]

        // accept a large original (e.g. a full-resolution phone photo); it's downscaled to a bounded JPEG below.
        // the default request-body limit (~28 MB) would otherwise reject big images with a 413 before we resize.
        [RequestSizeLimit(MaxPictureUploadBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxPictureUploadBytes)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> UploadPicture(IFormFile file)
        {
            if (file == null || file.Length == 0)
            {
                return BadRequest("No file provided");
            }

            if (!file.ContentType.StartsWith("image/"))
            {
                return BadRequest("File must be an image");
            }

            var path = ManagedPicturePath;
            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));

            // write to a temp file first, then move into place, so a decode/encode failure never corrupts an
            // existing picture that peers may be fetching
            var tempPath = path + ".tmp";

            try
            {
                await using var stream = file.OpenReadStream();
                using var source = new System.IO.MemoryStream();
                await stream.CopyToAsync(source, HttpContext.RequestAborted);
                var jpeg = resonance.Common.ArtworkResizer.ResizeToJpeg(source.ToArray(), 800);
                await System.IO.File.WriteAllBytesAsync(tempPath, jpeg, HttpContext.RequestAborted);

                System.IO.File.Move(tempPath, path, overwrite: true);
            }
            catch (Exception ex)
            {
                if (System.IO.File.Exists(tempPath))
                {
                    System.IO.File.Delete(tempPath);
                }

                return BadRequest($"Failed to process image: {ex.Message}");
            }

            PatchSoulseekConfig("picture", path);
            return Ok();
        }

        /// <summary>
        ///     Removes the current user's profile picture.
        /// </summary>
        /// <returns></returns>
        [HttpDelete("picture")]
        [Authorize(Policy = AuthPolicy.JwtOnly, Roles = AuthRole.AdministratorOnly)]
        [ProducesResponseType(204)]
        public IActionResult DeletePicture()
        {
            // clear the config key *before* deleting the file, so the Soulseek picture path (which fails startup
            // validation if it points at a missing file) is never left dangling
            PatchSoulseekConfig("picture", null);

            var path = ManagedPicturePath;
            if (System.IO.File.Exists(path))
            {
                System.IO.File.Delete(path);
            }

            return NoContent();
        }

        /// <summary>
        ///     Checks whether the configured listening port is reachable from the internet, using the
        ///     Soulseek network's public port test service (slsknet.org).
        /// </summary>
        /// <returns></returns>
        [HttpGet("port-check")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(PortCheckResponse), 200)]
        [ProducesResponseType(502)]
        public async Task<IActionResult> CheckPort(CancellationToken cancellationToken)
        {
            var port = OptionsSnapshot.Value.Soulseek.ListenPort;

            try
            {
                using var http = HttpClientFactory.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(15);

                var html = await http.GetStringAsync(
                    $"https://www.slsknet.org/porttest.php?port={port}",
                    cancellationToken);

                // the page reports a line like: "IP: 1.2.3.4 Port: 2234/tcp OPEN" (or CLOSED)
                var match = Regex.Match(
                    html,
                    $@"Port:\s*{port}/tcp\s*(?<status>OPEN|CLOSED)",
                    RegexOptions.IgnoreCase);

                if (!match.Success)
                {
                    return StatusCode(StatusCodes.Status502BadGateway, new { error = "Unexpected response from the port test service." });
                }

                return Ok(new PortCheckResponse
                {
                    Port = port,
                    IsOpen = match.Groups["status"].Value.Equals("OPEN", StringComparison.OrdinalIgnoreCase),
                });
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                return StatusCode(StatusCodes.Status504GatewayTimeout, new { code = "PORT_CHECK_TIMEOUT", error = "The external port-check service timed out. Your port status is unknown; try again later." });
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (HttpRequestException)
            {
                return StatusCode(StatusCodes.Status502BadGateway, new { code = "PORT_CHECK_UNAVAILABLE", error = "The external port-check service is unavailable. Your port status is unknown; try again later." });
            }
        }

        private static void PatchSoulseekConfig(string key, string value)
        {
            Program.PersistSettings(new Dictionary<string, string>
            {
                [$"{Program.AppName}:soulseek:{key}"] = value,
            });
        }

        public record SetStatusRequest
        {
            public string Presence { get; init; }
            public string Description { get; init; }
        }

        public record PortCheckResponse
        {
            public int Port { get; init; }
            public bool IsOpen { get; init; }
        }
    }
}
