// <copyright file="MusicLibraryTypes.cs" company="JP Dillingham">
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

namespace resonance.MusicLibrary
{
    using System.Collections.Generic;

    public record MusicAlbum(
        string Album,
        string Artist,
        string AlbumArtist,
        int? Year,
        int TrackCount,
        double? TotalDuration,
        string CoverPath,
        bool HasArtwork,
        long IndexedAt);

    public record MusicArtist(
        string Artist,
        int AlbumCount,
        int TrackCount,
        string CoverPath,
        bool HasArtwork,
        long IndexedAt);

    public record MusicTrack(
        string Path,
        string Filename,
        string Directory,
        string Extension,
        long FileSize,
        long FileModified,
        long IndexedAt,
        double? Duration,
        string Title,
        string Artist,
        string AlbumArtist,
        string Album,
        int? Year,
        int? TrackNumber,
        int? DiscNumber,
        string Genre,
        int? Bpm,
        string Key,
        string Comment,
        bool HasArtwork,
        string TagTypes);

    public record MusicGenre(string Genre, int TrackCount, double? TotalDuration);
    public record MusicYear(int Year, int TrackCount, int AlbumCount);
    public record MusicFolder(string Path, string Name, int TrackCount, string CoverPath, bool HasArtwork, long IndexedAt);

    public record PlayStat(string Path, int PlayCount, long? LastPlayedAt);
    public record LibraryActivitySnapshot(string[] LovedPaths, PlayStat[] PlayStats);

    public record MusicLibrarySyncState(
        bool Running,
        bool Completed,
        long? LastSyncAt,
        int TotalTracks,
        int Added,
        int Updated,
        int Removed,
        int Unchanged,
        int Failed,
        double Progress);

    public record MusicLibraryQueryResult(
        int Total,
        int Offset,
        int Limit,
        IReadOnlyList<MusicTrack> Tracks);
}
