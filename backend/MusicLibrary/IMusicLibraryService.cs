// <copyright file="IMusicLibraryService.cs" company="John Narey">
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

namespace resonance.MusicLibrary
{
    using System.Collections.Generic;
    using Microsoft.Extensions.Hosting;

    public interface IMusicLibraryService : IHostedService
    {
        MusicLibrarySyncState SyncState { get; }

        /// <summary>
        ///     Returns true if <paramref name="path"/> resolves to a file inside one of the
        ///     configured library (share) directories. Used to ensure the server only ever
        ///     signs/serves library paths — never an arbitrary location on disk.
        /// </summary>
        bool IsLibraryPath(string path);

        (int Total, double TotalDuration) GetStats();
        string GetLibraryVersion();
        MusicLibraryQueryResult QueryTracks(string search, string artist, string album, string genre, int? year, string folder, bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork, int limit, int offset, string sort = null, bool descending = false);
        IReadOnlyList<MusicAlbum> GetAlbums(string artistFilter = null);
        IReadOnlyList<MusicArtist> GetArtists();
        IReadOnlyList<MusicAlbum> GetRecentlyAdded(int limit);
        IReadOnlyList<MusicTrack> GetKeyedTracks();
        IReadOnlyList<MusicGenre> GetGenres();
        IReadOnlyList<MusicYear> GetYears();
        IReadOnlyList<MusicFolder> GetFolders();

        /// <summary>Returns the indexed metadata for a single track by its absolute path, or null if not indexed.</summary>
        /// <returns></returns>
        MusicTrack GetTrack(string path);

        void TriggerSync();

        /// <summary>Clears all indexed tracks and triggers an immediate full re-index from disk.</summary>
        void ForceResync();

        /// <summary>Cancels the in-flight scan (if any) without stopping the background sync loop.</summary>
        void CancelSync();

        /// <summary>Renames a folder on disk and bulk-updates all DB paths under it. Notifies clients via hub.</summary>
        void RenameFolder(string path, string newLeafName);

        /// <summary>Renames a track file on disk and updates the DB record. Notifies clients via hub.</summary>
        void RenameTrack(string path, string newFilename);

        /// <summary>Deletes a single audio file from disk and triggers an immediate library sync.</summary>
        void DeleteTrack(string path);

        /// <summary>Deletes a directory and all its contents from disk and triggers an immediate library sync.</summary>
        void DeleteFolder(string path);

        /// <summary>Cancels any pending debounce and triggers a sync immediately.</summary>
        void TriggerImmediateSync();

        /// <summary>Prevents files under <paramref name="directory"/> from being indexed during sync.</summary>
        void ExcludeFromSync(string directory);

        /// <summary>Removes the exclusion added by <see cref="ExcludeFromSync"/> and triggers a sync.</summary>
        void IncludeInSync(string directory);

        /// <summary>Registers an active analysis queue by name. Sync will not run while any queue is registered.</summary>
        void RegisterQueue(string name);

        /// <summary>Deregisters an analysis queue and triggers an immediate sync.</summary>
        void DeregisterQueue(string name);

        /// <summary>Returns whether an analysis queue with the given name is currently registered.</summary>
        bool IsQueueActive(string name);
    }
}
