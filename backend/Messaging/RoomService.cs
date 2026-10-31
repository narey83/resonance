// <copyright file="RoomService.cs" company="JP Dillingham">
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

namespace resonance.Messaging
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Text.Json;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.EntityFrameworkCore;
    using resonance.Core.API;
    using resonance.Core.Settings;
    using resonance.Events;
    using resonance.Users;
    using resonance.Users.Blocking;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Chat room management and event handling.
    /// </summary>
    public interface IRoomService
    {
        /// <summary>
        ///     Joins the specified <paramref name="roomName"/>.
        /// </summary>
        /// <param name="roomName">The name of the room to join.</param>
        /// <returns>The operation context, including information about the room.</returns>
        Task<RoomData> JoinAsync(string roomName);

        /// <summary>
        ///     Leaves the specified <paramref name="roomName"/>.
        /// </summary>
        /// <param name="roomName">The name of the room to leave.</param>
        /// <returns>The operation context.</returns>
        Task LeaveAsync(string roomName);

        /// <summary>
        ///     Attempts to join the specified <paramref name="roomNames"/>.
        /// </summary>
        /// <remarks>
        ///     Failures are logged but not thrown. Use JoinAsync() to trap Exceptions.
        /// </remarks>
        /// <param name="roomNames">The list of room names to join.</param>
        /// <returns>The operation context.</returns>
        Task TryJoinAsync(params string[] roomNames);
    }

    /// <summary>
    ///     Chat room management and event handling.
    /// </summary>
    public class RoomService : IRoomService
    {
        private const string PersistedRoomsSettingKey = "resonance:messaging:rooms";

        private readonly object membershipLock = new object();

        /// <summary>
        ///     Initializes a new instance of the <see cref="RoomService"/> class.
        /// </summary>
        /// <param name="soulseekClient"></param>
        /// <param name="optionsMonitor"></param>
        /// <param name="stateMutator"></param>
        /// <param name="roomTracker"></param>
        /// <param name="userService"></param>
        /// <param name="eventBus"></param>
        /// <param name="blockedUsersService"></param>
        /// <param name="contextFactory"></param>
        /// <param name="applicationHub"></param>
        /// <param name="settingsStore">The subscription store; defaults to the application's settings store.</param>
        public RoomService(
            ISoulseekClient soulseekClient,
            IOptionsMonitor<Options> optionsMonitor,
            IStateMutator<State> stateMutator,
            IRoomTracker roomTracker,
            IUserService userService,
            EventBus eventBus,
            BlockedUsersService blockedUsersService,
            IDbContextFactory<MessagingDbContext> contextFactory,
            IHubContext<ApplicationHub> applicationHub,
            SettingsService settingsStore = null)
        {
            Client = soulseekClient;

            StateMutator = stateMutator;
            OptionsMonitor = optionsMonitor;

            RoomTracker = roomTracker;

            Users = userService;
            EventBus = eventBus;
            Blocked = blockedUsersService;
            ContextFactory = contextFactory;
            ApplicationHub = applicationHub;
            SettingsStore = settingsStore ?? Program.SettingsStore;

            Client.LoggedIn += Client_LoggedIn;

            Client.RoomJoined += Client_RoomJoined;
            Client.RoomLeft += Client_RoomLeft;
            Client.RoomMessageReceived += Client_RoomMessageReceived;
        }

        private ISoulseekClient Client { get; }
        private ILogger Logger { get; set; } = Log.ForContext("SourceContext", Logs.Messaging.Rooms);
        private IStateMutator<State> StateMutator { get; }
        private IOptionsMonitor<Options> OptionsMonitor { get; }
        private IRoomTracker RoomTracker { get; set; }
        private IUserService Users { get; set; }
        private IHubContext<ApplicationHub> ApplicationHub { get; }
        private EventBus EventBus { get; }
        private BlockedUsersService Blocked { get; }
        private IDbContextFactory<MessagingDbContext> ContextFactory { get; }
        private SettingsService SettingsStore { get; }

        /// <summary>
        ///     Joins the specified <paramref name="roomName"/>.
        /// </summary>
        /// <param name="roomName">The name of the room to join.</param>
        /// <returns>The operation context, including information about the room.</returns>
        public async Task<RoomData> JoinAsync(string roomName)
        {
            Logger.Debug("Joining room {Room}", roomName);

            try
            {
                var data = await Client.JoinRoomAsync(roomName);
                var room = Room.FromRoomData(data);
                RoomTracker.Rooms.AddOrUpdate(roomName, room, (_, previous) =>
                {
                    room.Messages = previous.Messages;
                    return room;
                });

                Logger.Debug("Room data for {Room}: {Info}", roomName, data.ToJson());
                return data;
            }
            catch (Exception ex)
            {
                Logger.Warning("Failed to join room {Room}: {Message}", roomName, ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Leaves the specified <paramref name="roomName"/>.
        /// </summary>
        /// <param name="roomName">The name of the room to leave.</param>
        /// <returns>The operation context.</returns>
        public async Task LeaveAsync(string roomName)
        {
            Logger.Debug("Leaving room {Room}", roomName);

            try
            {
                await Client.LeaveRoomAsync(roomName);
            }
            catch (Exception ex)
            {
                Logger.Warning("Failed to leave room {Room}: {Message}", roomName, ex.Message);
                throw;
            }
        }

        /// <summary>
        ///     Attempts to join the specified <paramref name="roomNames"/>.
        /// </summary>
        /// <remarks>
        ///     Failures are logged but not thrown. Use JoinAsync() to trap Exceptions.
        /// </remarks>
        /// <param name="roomNames">The list of room names to join.</param>
        /// <returns>The operation context.</returns>
        public async Task TryJoinAsync(params string[] roomNames)
        {
            var tasks = new List<Task>();

            foreach (var room in roomNames.Distinct())
            {
                tasks.Add(JoinAsync(room));
            }

            try
            {
                await Task.WhenAll(tasks);
            }
            catch (Exception ex)
            {
                Logger.Debug(ex, "Caught Exception in JoinAsync");
            }
        }

        /// <summary>
        ///     Captures all subscriptions before any join notifications can change runtime state.
        /// </summary>
        /// <returns>The restore operation.</returns>
        internal async Task RestoreJoinedRoomsAsync()
        {
            string[] rooms;
            lock (membershipLock)
            {
                rooms = OptionsMonitor.CurrentValue.Rooms
                    .Concat(LoadPersistedRooms())
                    .Concat(RoomTracker.Rooms.Keys)
                    .Distinct().ToArray();
            }

            if (rooms.Any())
            {
                Logger.Information("Attempting to rejoin room(s) {Rooms}", string.Join(", ", rooms));
                await TryJoinAsync(rooms);
            }
        }

        /// <summary>
        ///     Loads the set of rooms persisted by <see cref="PersistJoinedRooms(string[])"/>.
        /// </summary>
        /// <returns>The persisted room names, or an empty array if none are persisted.</returns>
        private string[] LoadPersistedRooms()
        {
            if (!SettingsStore.GetAll().TryGetValue(PersistedRoomsSettingKey, out var json) || string.IsNullOrWhiteSpace(json))
            {
                return Array.Empty<string>();
            }

            try
            {
                return (JsonSerializer.Deserialize<string[]>(json) ?? Array.Empty<string>())
                    .Where(room => !string.IsNullOrWhiteSpace(room)).Distinct().ToArray();
            }
            catch (JsonException ex)
            {
                Logger.Warning(ex, "Unable to load saved room subscriptions");
                return Array.Empty<string>();
            }
        }

        /// <summary>
        ///     Persists room subscriptions, including rooms awaiting a successful rejoin.
        /// </summary>
        /// <param name="rooms">The full set of subscribed room names.</param>
        private void PersistJoinedRooms(string[] rooms)
        {
            SettingsStore.SetMany(new Dictionary<string, string>
            {
                [PersistedRoomsSettingKey] = JsonSerializer.Serialize(rooms),
            });
        }

        private async void Client_LoggedIn(object sender, EventArgs e)
        {
            try
            {
                await RestoreJoinedRoomsAsync();
            }
            catch (Exception ex)
            {
                Logger.Warning(ex, "Unable to restore room subscriptions");
            }
        }

        private void Client_RoomJoined(object sender, RoomJoinedEventArgs args)
        {
            if (args.Username == Client.Username)
            {
                Logger.Information("Joined room {Room}", args.RoomName);
                lock (membershipLock)
                {
                    // State only contains joins acknowledged during this connection. Never use it
                    // to replace subscriptions that have not finished (or failed) rejoining.
                    var state = StateMutator.SetValue(state => state with { Rooms = state.Rooms.Append(args.RoomName).Distinct().ToArray() });
                    PersistJoinedRooms(LoadPersistedRooms().Concat(state.Rooms).Distinct().ToArray());
                }
            }
            else
            {
                RoomTracker.TryAddUser(args.RoomName, args.UserData);
            }
        }

        private void Client_RoomLeft(object sender, RoomLeftEventArgs args)
        {
            if (args.Username == Client.Username)
            {
                Logger.Information("Left room {Room}", args.RoomName);
                lock (membershipLock)
                {
                    var state = StateMutator.SetValue(state => state with { Rooms = state.Rooms.Where(room => room != args.RoomName).ToArray() });
                    PersistJoinedRooms(LoadPersistedRooms().Concat(state.Rooms).Where(room => room != args.RoomName).Distinct().ToArray());
                    RoomTracker.TryRemove(args.RoomName);
                }
            }
            else
            {
                RoomTracker.TryRemoveUser(args.RoomName, args.Username);
            }
        }

        private void Client_RoomMessageReceived(object sender, RoomMessageReceivedEventArgs args)
        {
            if (Users.IsBlacklisted(args.Username))
            {
                Logger.Debug("Ignored message from blacklisted user {Username} in {Room}: {Message}", args.Username, args.RoomName, args.Message);
                return;
            }

            if (Blocked.IsBlocked(args.Username, BlockedUserScope.RoomMessages))
            {
                Logger.Debug("Ignored message from blocked user {Username} in {Room}: {Message}", args.Username, args.RoomName, args.Message);
                return;
            }

            var message = RoomMessage.FromEventArgs(args, DateTime.UtcNow);
            message.Direction = MessageDirection.In;
            RoomTracker.AddOrUpdateMessage(args.RoomName, message);

            using (var context = ContextFactory.CreateDbContext())
            {
                // RoomMessage is mapped with HasNoKey() (no natural key exists), so it can't be
                // tracked/added through the change tracker; insert it directly instead.
                context.InsertRoomMessage(message);
            }

            _ = ApplicationHub.BroadcastRoomMessageAsync(args.RoomName);

            EventBus.Raise<RoomMessageReceivedEvent>(new RoomMessageReceivedEvent
            {
                Message = message,
            });
        }
    }
}
