// <copyright file="LibraryActivityHub.cs" company="JP Dillingham">
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

namespace resonance.MusicLibrary.API
{
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.SignalR;
    using resonance.MusicLibrary;
    using resonance.MusicLibrary.Activity;

    public static class LibraryActivityHubMethods
    {
        public static readonly string Snapshot = "SNAPSHOT";
        public static readonly string TrackLoved = "TRACK_LOVED";
        public static readonly string TrackUnloved = "TRACK_UNLOVED";
        public static readonly string AllUnloved = "ALL_UNLOVED";
        public static readonly string TrackPlayed = "TRACK_PLAYED";
        public static readonly string PlayDeleted = "PLAY_DELETED";
        public static readonly string HistoryCleared = "HISTORY_CLEARED";
        public static readonly string LibraryUpdated = "LIBRARY_UPDATED";
    }

    public static class LibraryActivityHubExtensions
    {
        public static Task BroadcastLibraryUpdatedAsync(
            this IHubContext<LibraryActivityHub> hub,
            int added, int updated, int removed,
            IReadOnlyList<string>? removedPaths = null)
            => hub.Clients.All.SendAsync(LibraryActivityHubMethods.LibraryUpdated, new { added, updated, removed, removedPaths });

        public static Task BroadcastTrackLovedAsync(this IHubContext<LibraryActivityHub> hub, string username, string path)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.TrackLoved, path);

        public static Task BroadcastTrackUnlovedAsync(this IHubContext<LibraryActivityHub> hub, string username, string path)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.TrackUnloved, path);

        public static Task BroadcastAllUnlovedAsync(this IHubContext<LibraryActivityHub> hub, string username)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.AllUnloved);

        public static Task BroadcastTrackPlayedAsync(this IHubContext<LibraryActivityHub> hub, string username, PlayStat stat, PlayRecord record)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.TrackPlayed, new { stat, record });

        public static Task BroadcastPlayDeletedAsync(this IHubContext<LibraryActivityHub> hub, string username, string id)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.PlayDeleted, id);

        public static Task BroadcastHistoryClearedAsync(this IHubContext<LibraryActivityHub> hub, string username)
            => hub.Clients.Group(username).SendAsync(LibraryActivityHubMethods.HistoryCleared);
    }

    [Authorize(Policy = AuthPolicy.Any)]
    public class LibraryActivityHub : Hub
    {
        public LibraryActivityHub(ILibraryActivityService service)
        {
            Service = service;
        }

        private ILibraryActivityService Service { get; }

        public override async Task OnConnectedAsync()
        {
            var username = Context.User?.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value ?? string.Empty;

            if (!string.IsNullOrEmpty(username))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, username);
            }

            var snapshot = new LibraryActivitySnapshot(
                LovedPaths: Service.GetLovedPaths(username),
                PlayStats: Service.GetPlayStats(username));

            await Clients.Caller.SendAsync(LibraryActivityHubMethods.Snapshot, snapshot);
        }
    }
}
