// <copyright file="ILibraryActivityService.cs" company="John Narey">
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

namespace resonance.MusicLibrary.Activity;

using System.Threading.Tasks;
using resonance.MusicLibrary;

public interface ILibraryActivityService
{
    string[] GetLovedPaths(string username);

    /// <summary>
    /// Returns full track records for the user's loved paths, resolved against the music library.
    /// Loved entries whose file is no longer present are omitted. Saves clients from having to
    /// download the entire library just to display a handful of loved tracks.
    /// </summary>
    /// <returns><placeholder>The loved tracks present in the library.</placeholder></returns>
    MusicTrack[] GetLovedTracks(string username);

    Task LoveTrackAsync(string username, string path);
    Task UnloveTrackAsync(string username, string path);
    Task ClearAllLovedAsync(string username);

    /// <summary>
    /// Reconciles every loved track against the music library: repoints entries whose file
    /// had its extension changed (e.g. opus→mp3) and prunes entries whose file is gone.
    /// </summary>
    /// <returns><placeholder>A <see cref="Task"/> representing the asynchronous operation.</placeholder></returns>
    Task ReconcileLovedTracksAsync();

    Task<PlayStat> RecordPlayAsync(string username, string path, string title = null, string artist = null, string folder = null, string source = null);
    PlayRecord[] GetPlayHistory(string username, int limit = 100, int offset = 0);
    Task DeletePlayAsync(string username, string id);
    Task ClearHistoryAsync(string username);
    PlayStat[] GetPlayStats(string username, string[] paths = null);
}
