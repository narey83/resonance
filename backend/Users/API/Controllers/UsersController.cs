// <copyright file="UsersController.cs" company="JP Dillingham">
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

namespace resonance.Users.API
{
    using System.Collections.Generic;
    using System.ComponentModel.DataAnnotations;
    using System.Linq;
    using System.Net;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using Serilog;

    using Soulseek;

    /// <summary>
    ///     Users.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Authorize(Policy = AuthPolicy.FeatureUserBrowsing)]
    public class UsersController : ControllerBase
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="UsersController"/> class.
        /// </summary>
        /// <param name="soulseekClient"></param>
        /// <param name="browseTracker"></param>
        /// <param name="userService"></param>
        /// <param name="optionsSnapshot"></param>
        public UsersController(ISoulseekClient soulseekClient, IBrowseTracker browseTracker, IUserService userService, IOptionsSnapshot<Options> optionsSnapshot)
        {
            Client = soulseekClient;
            BrowseTracker = browseTracker;
            Users = userService;
            OptionsSnapshot = optionsSnapshot;
        }

        private IBrowseTracker BrowseTracker { get; }
        private ISoulseekClient Client { get; }
        private IUserService Users { get; }
        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private ILogger Log { get; set; } = Serilog.Log.ForContext("SourceContext", Logs.Users);

        /// <summary>
        ///     Retrieves the address of the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("{username}/endpoint")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IPEndPoint), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Endpoint([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            try
            {
                var endpoint = await Users.GetIPEndPointAsync(username);
                return Ok(endpoint);
            }
            catch (UserOfflineException ex)
            {
                return NotFound(ex.Message);
            }
        }

        /// <summary>
        ///     Retrieves the files shared by the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns></returns>
        [HttpGet("{username}/browse")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<Directory>), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Browse([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            try
            {
                var result = await Client.BrowseAsync(username);

                _ = Task.Run(async () =>
                {
                    await Task.Delay(5000);
                    BrowseTracker.TryRemove(username);
                });

                return Ok(result);
            }
            catch (UserOfflineException ex)
            {
                return NotFound(ex.Message);
            }
            catch (SoulseekClientException ex)
            {
                // the user is online but unreachable (e.g. a direct/indirect connection couldn't be established).
                // this is expected in a P2P network; log quietly and return a clean status instead of a 500.
                Log.Information("Failed to browse user {User}: {Message}", username, ex.Message);
                return StatusCode(StatusCodes.Status504GatewayTimeout, ex.Message);
            }
        }

        /// <summary>
        ///     Retrieves the status of the current browse operation for the specified <paramref name="username"/>, if any.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns></returns>
        [HttpGet("{username}/browse/status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(decimal), 200)]
        [ProducesResponseType(404)]
        public IActionResult BrowseStatus([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (BrowseTracker.TryGet(username, out var progress))
            {
                return Ok(progress);
            }

            return NotFound();
        }

        /// <summary>
        ///     Retrieves the files from the specified directory from the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <param name="request">The directory contents request.</param>
        /// <returns></returns>
        [HttpPost("{username}/directory")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<Directory>), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Directory([FromRoute, UrlEncoded, Required] string username, [FromBody, Required] DirectoryContentsRequest request)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (request == null || string.IsNullOrEmpty(request.Directory))
            {
                return BadRequest();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            try
            {
                var result = await Client.GetDirectoryContentsAsync(username, request.Directory);

                Log.Debug("{Endpoint} response from {User} for directory '{Directory}': {@Response}", nameof(Directory), username, request.Directory, result);

                return Ok(result);
            }
            catch (UserOfflineException ex)
            {
                return NotFound(ex.Message);
            }
            catch (SoulseekClientException ex)
            {
                Log.Information("Failed to retrieve directory contents from user {User}: {Message}", username, ex.Message);
                return StatusCode(StatusCodes.Status504GatewayTimeout, ex.Message);
            }
        }

        /// <summary>
        ///     Retrieves information about the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns></returns>
        [HttpGet("{username}/info")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Info), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Info([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            try
            {
                var response = await Users.GetInfoAsync(username);
                return Ok(response);
            }
            catch (UserOfflineException ex)
            {
                return NotFound(ex.Message);
            }
            catch (SoulseekClientException ex)
            {
                Log.Information("Failed to retrieve info for user {User}: {Message}", username, ex.Message);
                return StatusCode(StatusCodes.Status504GatewayTimeout, ex.Message);
            }
        }

        /// <summary>
        ///     Retrieves statuses for a batch of usernames in a single request.
        /// </summary>
        /// <param name="usernames">The list of usernames to look up.</param>
        /// <returns>A dictionary mapping each username to its status. Offline or unknown users are omitted.</returns>
        [HttpPost("statuses")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Dictionary<string, Status>), 200)]
        public async Task<IActionResult> Statuses([FromBody, Required] IEnumerable<string> usernames)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var tasks = usernames
                .Where(u => !string.IsNullOrWhiteSpace(u) && !Users.IsBlacklisted(u))
                .Distinct()
                .Select(async u =>
                {
                    try
                    {
                        var status = await Users.GetStatusAsync(u);
                        return (u, status);
                    }
                    catch
                    {
                        return (u, (Status)null);
                    }
                });

            var results = await Task.WhenAll(tasks);
            var dict = results
                .Where(r => r.Item2 is not null)
                .ToDictionary(r => r.u, r => r.Item2);

            return Ok(dict);
        }

        /// <summary>
        ///     Retrieves status for the specified <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The username of the user.</param>
        /// <returns></returns>
        [HttpGet("{username}/status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Status), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> Status([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            try
            {
                var response = await Users.GetStatusAsync(username);
                return Ok(response);
            }
            catch (UserOfflineException ex)
            {
                return NotFound(ex.Message);
            }
        }
    }
}
