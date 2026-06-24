// <copyright file="CastController.cs" company="John Narey">
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

namespace resonance.Cast.API
{
    using System.Linq;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Options;
    using resonance.Cast.Types;

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/cast")]
    public class CastController : ControllerBase
    {
        public CastController(ICastService castService, IOptionsSnapshot<resonance.Options> optionsSnapshot)
        {
            Cast = castService;
            Options = optionsSnapshot.Value;
        }

        private ICastService Cast { get; }
        private resonance.Options Options { get; }

        /// <summary>Returns the list of discovered DLNA renderers.</summary>
        /// <returns></returns>
        [HttpGet("devices")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(DlnaDevice[]), 200)]
        public IActionResult GetDevices() => Ok(Cast.Devices);

        /// <summary>Runs SSDP discovery (~3 seconds) and returns the updated device list.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("devices")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(DlnaDevice[]), 200)]
        public async Task<IActionResult> DiscoverDevices()
        {
            var devices = await Cast.DiscoverAsync(HttpContext.RequestAborted);
            return Ok(devices);
        }

        /// <summary>Returns the current cast session state, or null if not casting.</summary>
        /// <returns></returns>
        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(CastState), 200)]
        public IActionResult GetState() => Ok(Cast.State);

        /// <summary>
        ///     Returns the HTTP origin cast devices should use to fetch media streams.
        ///     Uses http:// on the backend's direct port to avoid TLS certificate issues
        ///     that can arise when a reverse proxy uses a self-signed or local CA certificate.
        /// </summary>
        /// <returns></returns>
        [HttpGet("stream-origin")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(object), 200)]
        public IActionResult GetStreamOrigin()
        {
            var port = Options.Web.Port;

            // Prefer X-Forwarded-Host set by the reverse proxy — it carries the public
            // hostname (e.g. resonance.homenetwork.lan) rather than localhost.
            var forwardedHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(forwardedHost))
            {
                return Ok(new { origin = $"http://{forwardedHost}:{port}" });
            }

            // Fall back to the first non-loopback LAN IPv4 address so cast devices
            // can reach the backend even without a reverse proxy or forwarded headers.
            var lanIp = System.Net.NetworkInformation.NetworkInterface
                .GetAllNetworkInterfaces()
                .SelectMany(ni => ni.GetIPProperties().UnicastAddresses)
                .Where(ua => ua.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork
                          && !System.Net.IPAddress.IsLoopback(ua.Address))
                .Select(ua => ua.Address.ToString())
                .FirstOrDefault();

            var host = lanIp ?? Request.Host.Host;
            return Ok(new { origin = $"http://{host}:{port}" });
        }

        /// <summary>Starts casting the specified track to a DLNA renderer.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("play")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(CastState), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Play([FromBody] CastPlayRequest request)
        {
            if (!Cast.Devices.Any(d => d.Udn == request.DeviceUdn))
            {
                return NotFound(new { message = $"Device '{request.DeviceUdn}' not found. Try discovering again." });
            }

            // Construct the absolute URL the DLNA renderer will fetch.
            // Request.Host gives the LAN address:port the client used to reach us.
            var absoluteUrl = $"{Request.Scheme}://{Request.Host}{request.StreamPath}";

            await Cast.PlayAsync(request.DeviceUdn, absoluteUrl, request.Title, request.Artist, request.Album, HttpContext.RequestAborted);
            return Ok(Cast.State);
        }

        /// <summary>Stops the current cast session.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("stop")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public async Task<IActionResult> Stop()
        {
            await Cast.StopAsync(HttpContext.RequestAborted);
            return Ok();
        }
    }
}
