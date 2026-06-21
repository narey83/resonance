// <copyright file="IMixtapeService.cs" company="JP Dillingham">
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

namespace resonance.Mixtapes
{
    using System.Collections.Generic;

    public interface IMixtapeService
    {
        IReadOnlyList<Mixtape> GetAll();
        Mixtape? GetById(string id);
        Mixtape Create(string name, string? description);
        Mixtape Update(string id, string name, string? description);
        void Delete(string id);

        MixtapeTrack AddTrack(string mixtapeId, string filePath);
        void RemoveTrack(string mixtapeId, string trackId);
        void ClearTracks(string mixtapeId);
        void ReorderTracks(string mixtapeId, string[] orderedTrackIds);

        Mixtape Publish(string id);
        void Unpublish(string id);

        Mixtape SoulseekShare(string id);
        void SoulseekUnshare(string id);

        Mixtape? GetByToken(string token);
        IReadOnlyList<MixtapeTrack> GetTracks(string mixtapeId);

        bool HasArtwork(string id);
        (string Path, string ContentType)? GetArtworkInfo(string id);
        System.Threading.Tasks.Task SaveArtworkAsync(string id, System.IO.Stream data, string contentType);
        void DeleteArtwork(string id);

        string BuildM3uContent(IReadOnlyList<MixtapeTrack> tracks, string? baseDownloadUrl = null);

        /// <summary>
        /// Rewrites all mixtape track paths that begin with <paramref name="oldPrefix"/> to begin
        /// with <paramref name="newPrefix"/>, then refreshes the M3U/symlinks for any affected mixtapes.
        /// For a folder rename pass paths with a trailing separator; for a file rename pass exact paths.
        /// </summary>
        void UpdateTrackPaths(string oldPrefix, string newPrefix);
    }
}
