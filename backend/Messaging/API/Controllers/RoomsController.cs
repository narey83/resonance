// <copyright file="RoomsController.cs" company="JP Dillingham">
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

namespace resonance.Messaging.API
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.EntityFrameworkCore;
    using Soulseek;

    /// <summary>
    ///     Rooms.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Authorize(Policy = AuthPolicy.FeatureMessaging)]
    public class RoomsController : ControllerBase
    {
        public RoomsController(
            ISoulseekClient soulseekClient,
            IRoomService roomService,
            IStateMonitor<State> applicationStateMonitor,
            IOptionsSnapshot<Options> optionsSnapshot,
            IRoomTracker tracker,
            IDbContextFactory<MessagingDbContext> contextFactory)
        {
            Client = soulseekClient;
            ApplicationStateMonitor = applicationStateMonitor;
            OptionsSnapshot = optionsSnapshot;
            Tracker = tracker;
            RoomService = roomService;
            ContextFactory = contextFactory;
        }

        private IRoomService RoomService { get; }
        private ISoulseekClient Client { get; }
        private IStateMonitor<State> ApplicationStateMonitor { get; }
        private IRoomTracker Tracker { get; }
        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private IDbContextFactory<MessagingDbContext> ContextFactory { get; }

        /// <summary>
        ///     Gets all rooms.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("joined")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Dictionary<string, Dictionary<string, Room>>), 200)]
        public IActionResult GetAll()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            return Ok(Tracker.Rooms.Keys);
        }

        /// <summary>
        ///     Gets the specified room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpGet("joined/{roomName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Room), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetByRoomName([FromRoute, UrlEncoded] string roomName)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var room))
            {
                return Ok(MapRoomToRoomResponse(room));
            }

            return NotFound();
        }

        /// <summary>
        ///     Sends a message to the specified room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <param name="message"></param>
        /// <returns></returns>
        /// <response code="201">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpPost("joined/{roomName}/messages")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(201)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> SendMessage([FromRoute, UrlEncoded] string roomName, [FromBody] string message)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var _))
            {
                await Client.SendRoomMessageAsync(roomName, message);
                return StatusCode(StatusCodes.Status201Created);
            }

            return NotFound();
        }

        /// <summary>
        ///     Sets a ticker for the specified room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <param name="message"></param>
        /// <returns></returns>
        /// <response code="201">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpPost("joined/{roomName}/ticker")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(201)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> SetTicker([FromRoute, UrlEncoded] string roomName, [FromBody] string message)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var _))
            {
                await Client.SetRoomTickerAsync(roomName, message);
                return StatusCode(StatusCodes.Status201Created);
            }

            return NotFound();
        }

        /// <summary>
        ///     Adds a member to a private room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <param name="username"></param>
        /// <returns></returns>
        /// <response code="201">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpPost("joined/{roomName}/members")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(201)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> AddRoomMember([FromRoute, UrlEncoded] string roomName, [FromBody] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var _))
            {
                await Client.AddPrivateRoomMemberAsync(roomName, username);
                return StatusCode(StatusCodes.Status201Created);
            }

            return NotFound();
        }

        /// <summary>
        ///     Gets the current list of users for the specified room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpGet("joined/{roomName}/users")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IList<UserData>), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetUsersByRoomName([FromRoute, UrlEncoded] string roomName)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var room))
            {
                var response = room.Users
                    .Select(user => UserDataResponse.FromUserData(user, self: user.Username == ApplicationStateMonitor.CurrentValue.User.Username));

                return Ok(response);
            }

            return NotFound();
        }

        /// <summary>
        ///     Gets the current list of messages for the specified room.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="404">The specified roomName could not be found.</response>
        [HttpGet("joined/message-counts")]
        public IActionResult GetMessageCounts()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var rooms = Tracker.Rooms.Keys.ToArray();
            using var context = ContextFactory.CreateDbContext();
            var self = ApplicationStateMonitor.CurrentValue.User.Username;
            var counts = context.RoomMessages.AsNoTracking()
                .Where(m => rooms.Contains(m.RoomName) && m.Username != self)
                .GroupBy(m => m.RoomName)
                .Select(g => new { Room = g.Key, Count = g.LongCount() })
                .ToDictionary(g => g.Room, g => g.Count);
            return Ok(rooms.Select(room => new { room, count = counts.GetValueOrDefault(room) }).ToArray());
        }

        [HttpGet("joined/{roomName}/messages")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IList<RoomMessage>), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetMessagesByRoomName([FromRoute, UrlEncoded] string roomName)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.TryGet(roomName, out var _))
            {
                using var context = ContextFactory.CreateDbContext();

                var messages = context.RoomMessages
                    .Where(m => m.RoomName == roomName)
                    .OrderByDescending(m => m.Timestamp)
                    .Take(Tracker.MessageLimit)
                    .OrderBy(m => m.Timestamp)
                    .ToList();

                var response = messages
                    .Select(message => RoomMessageResponse.FromRoomMessage(message, self: message.Username == ApplicationStateMonitor.CurrentValue.User.Username));

                return Ok(response);
            }

            return NotFound();
        }

        /// <summary>
        ///     Gets a list of rooms from the server.
        /// </summary>
        /// <returns></returns>
        [HttpGet("available")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(List<RoomInfo>), 200)]
        public async Task<IActionResult> GetRooms()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Client.State.HasFlag(SoulseekClientStates.LoggedIn))
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "SOULSEEK_UNAVAILABLE", error = "Soulseek is disconnected. Reconnect to browse rooms." });
            }

            RoomList list;
            try
            {
                list = await Client.GetRoomListAsync();
            }
            catch (InvalidOperationException) when (!Client.State.HasFlag(SoulseekClientStates.LoggedIn))
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new { code = "SOULSEEK_UNAVAILABLE", error = "Soulseek disconnected while retrieving rooms. Reconnect and try again." });
            }
            catch (Exception ex) when (ex is SoulseekClientException or TimeoutException)
            {
                return StatusCode(StatusCodes.Status504GatewayTimeout, new { code = "SOULSEEK_TIMEOUT", error = "Soulseek did not return the room list in time. Try again shortly." });
            }

            var response = new List<RoomInfoResponse>();

            response.AddRange(list.Public.Select(r => RoomInfoResponse.FromRoomInfo(r)));
            response.AddRange(list.Private.Select(r => RoomInfoResponse.FromRoomInfo(r, isPrivate: true)));
            response.AddRange(list.Owned.Select(r => RoomInfoResponse.FromRoomInfo(r, isPrivate: true, isOwned: true)));

            foreach (var room in response)
            {
                room.IsModerated = list.ModeratedRoomNames.Contains(room.Name);
            }

            return Ok(response);
        }

        /// <summary>
        ///     Joins a room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <returns></returns>
        /// <response code="201">The request completed successfully.</response>
        /// <response code="304">The room has already been joined.</response>
        [HttpPost("joined")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(Room), 201)]
        [ProducesResponseType(304)]
        public async Task<IActionResult> JoinRoom([FromBody] string roomName)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Tracker.Rooms.ContainsKey(roomName))
            {
                return Ok();
            }

            try
            {
                var roomData = await RoomService.JoinAsync(roomName);
                var room = Room.FromRoomData(roomData);

                return StatusCode(StatusCodes.Status201Created, MapRoomToRoomResponse(room));
            }
            catch (Exception ex)
            {
                if (ex.InnerException is RoomJoinForbiddenException)
                {
                    return StatusCode(StatusCodes.Status403Forbidden, $"The server rejected your request to join {roomName}");
                }

                throw;
            }
        }

        /// <summary>
        ///     Leaves a room.
        /// </summary>
        /// <param name="roomName"></param>
        /// <returns></returns>
        /// <response code="204">The request completed successfully.</response>
        /// <response code="404">The room has not been joined.</response>
        [HttpDelete("joined/{roomName}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> LeaveRoom([FromRoute, UrlEncoded] string roomName)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Tracker.Rooms.ContainsKey(roomName))
            {
                return StatusCode(StatusCodes.Status404NotFound);
            }

            await RoomService.LeaveAsync(roomName);

            return StatusCode(StatusCodes.Status204NoContent);
        }

        private RoomResponse MapRoomToRoomResponse(Room room)
        {
            bool IsSelf(string username)
            {
                return username == ApplicationStateMonitor.CurrentValue.User.Username;
            }

            var response = RoomResponse.FromRoom(room);
            response.Users = room.Users
                .Select(user => UserDataResponse.FromUserData(user, self: IsSelf(user.Username)));
            response.Messages = room.Messages
                .Select(message => RoomMessageResponse.FromRoomMessage(message, self: IsSelf(message.Username)));

            return response;
        }
    }
}
