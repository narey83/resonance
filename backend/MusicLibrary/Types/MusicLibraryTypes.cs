// <copyright file="MusicLibraryTypes.cs" company="John Narey">
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

    // Sig/Exp are additive, request-scoped HMAC signatures (see StreamUrlSigner) the controller
    // stamps onto each row so clients can build signed artwork/stream URLs without a second
    // round-trip to the /sign endpoint. They are not persisted and default to null/0 when unset.
    public record MusicAlbum(
        string Album,
        string Artist,
        string AlbumArtist,
        int? Year,
        int TrackCount,
        double? TotalDuration,
        string CoverPath,
        bool HasArtwork,
        long IndexedAt,
        string Directory)
    {
        public string Sig { get; init; }

        public long Exp { get; init; }
    }

    public record MusicArtist(
        string Artist,
        int AlbumCount,
        int TrackCount,
        string CoverPath,
        bool HasArtwork,
        long IndexedAt)
    {
        public string Sig { get; init; }

        public long Exp { get; init; }
    }

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
        string TagTypes)
    {
        public string Sig { get; init; }

        public long Exp { get; init; }
    }

    public record MusicGenre(string Genre, int TrackCount, double? TotalDuration);
    public record MusicYear(int Year, int TrackCount, int AlbumCount);

    public record MusicFolder(string Path, string Name, int TrackCount, string CoverPath, bool HasArtwork, long IndexedAt)
    {
        public string Sig { get; init; }

        public long Exp { get; init; }
    }

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
