// <copyright file="ServerController.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
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
        public ServerController(
            ISoulseekClient soulseekClient,
            ConnectionWatchdog connectionWatchdog,
            IOptionsSnapshot<Options> optionsSnapshot,
            IStateSnapshot<State> stateSnapshot,
            IStateMutator<State> stateMutator)
        {
            Client = soulseekClient;
            ConnectionWatchdog = connectionWatchdog;
            OptionsSnapshot = optionsSnapshot;
            StateSnapshot = stateSnapshot;
            StateMutator = stateMutator;
        }

        private ISoulseekClient Client { get; }
        private ConnectionWatchdog ConnectionWatchdog { get; }
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
            });
        }

        [HttpPut("status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> SetStatus([FromBody] SetStatusRequest request)
        {
            if (request.Presence is not null)
            {
                if (request.Presence != "Online" && request.Presence != "Away")
                {
                    return BadRequest("Presence must be 'Online' or 'Away'");
                }

                var presence = request.Presence == "Away" ? UserPresence.Away : UserPresence.Online;

                if (Client.State.HasFlag(SoulseekClientStates.LoggedIn))
                {
                    await Client.SetStatusAsync(presence);
                }

                StateMutator.SetValue(state => state with
                {
                    User = state.User with { Presence = request.Presence },
                });
            }

            if (request.Description is not null)
            {
                var existing = Program.ConfigurationOverlay;
                Program.ApplyConfigurationOverlay(new OptionsOverlay
                {
                    Soulseek = new OptionsOverlay.SoulseekOptionsPatch
                    {
                        ListenIpAddress = existing?.Soulseek?.ListenIpAddress,
                        ListenPort = existing?.Soulseek?.ListenPort,
                        Description = request.Description,
                    },
                });
            }

            return Ok(new
            {
                presence = StateSnapshot.Value.User.Presence,
                description = OptionsSnapshot.Value.Soulseek.Description ?? string.Empty,
            });
        }

        public record SetStatusRequest
        {
            public string Presence { get; init; }
            public string Description { get; init; }
        }
    }
}