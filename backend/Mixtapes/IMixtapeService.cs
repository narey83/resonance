// <copyright file="IMixtapeService.cs" company="John Narey">
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

namespace resonance.Mixtapes
{
    using System;
    using System.Collections.Generic;

    public interface IMixtapeService
    {
        IReadOnlyList<Mixtape> GetAll();
        Mixtape? GetById(string id);
        Mixtape Create(string name, string? description);
        Mixtape CreateSnapshot(string id, string name, string? description, IReadOnlyList<resonance.MusicLibrary.MusicTrack> tracks);
        Mixtape Update(string id, string name, string? description);
        void Delete(string id);

        MixtapeTrack AddTrack(string mixtapeId, string filePath);
        void RemoveTrack(string mixtapeId, string trackId);
        void ClearTracks(string mixtapeId);
        void ReorderTracks(string mixtapeId, string[] orderedTrackIds);

        Mixtape Publish(string id);
        void Unpublish(string id);

        Mixtape? GetByToken(string token);
        IReadOnlyList<MixtapeTrack> GetTracks(string mixtapeId);

        bool HasArtwork(string id);
        /// <summary>
        ///     Gets the file to serve for a mixtape's artwork: the upload itself, or, when
        ///     <paramref name="size"/> is given, a copy resized to fit that many pixels.
        /// </summary>
        (string Path, string ContentType)? GetArtworkInfo(string id, int? size = null);
        System.Threading.Tasks.Task SaveArtworkAsync(string id, System.IO.Stream data, string contentType);
        void DeleteArtwork(string id);

        /// <summary>
        /// Builds M3U playlist content, using <paramref name="uriFor"/> to render each track's entry.
        /// Playlists always leave the server, so the caller must supply a URL the client can fetch —
        /// a server-local file path is never playable elsewhere.
        /// </summary>
        /// <returns>The playlist content.</returns>
        string BuildM3uContent(IReadOnlyList<MixtapeTrack> tracks, Func<MixtapeTrack, string> uriFor);

        /// <summary>
        /// Rewrites all mixtape track paths that begin with <paramref name="oldPrefix"/> to begin
        /// with <paramref name="newPrefix"/>, then refreshes the M3U/symlinks for any affected mixtapes.
        /// For a folder rename pass paths with a trailing separator; for a file rename pass exact paths.
        /// </summary>
        void UpdateTrackPaths(string oldPrefix, string newPrefix);
    }
}
