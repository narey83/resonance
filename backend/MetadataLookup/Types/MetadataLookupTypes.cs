// <copyright file="MetadataLookupTypes.cs" company="John Narey">
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

namespace resonance.MetadataLookup
{
    using System.Collections.Generic;

    /// <summary>
    ///     The status of a single track within a metadata enrichment pass.
    /// </summary>
    public enum MetadataItemStatus
    {
        /// <summary>The track is waiting to be processed.</summary>
        Queued,

        /// <summary>The track is currently being looked up online.</summary>
        Looking,

        /// <summary>A match was found and written to the file.</summary>
        Written,

        /// <summary>No match was found, or the best match was below the confidence threshold.</summary>
        NoMatch,

        /// <summary>The lookup failed with an error.</summary>
        Failed,
    }

    /// <summary>
    ///     A candidate metadata match returned from the online provider.
    /// </summary>
    public record MetadataMatch(
        string? Title,
        string? Artist,
        string Album,
        string? AlbumArtist,
        uint Year,
        uint TrackNumber,
        uint DiscNumber,
        string? Genre,
        int Score,
        string? RecordingMbid,
        string? Source = null);

    /// <summary>
    ///     A single track's status within the current or most recent enrichment pass.
    /// </summary>
    public record MetadataScanItem(
        string MaskedFilename,
        string Filename,
        MetadataItemStatus Status,
        string Summary);

    /// <summary>
    ///     State of the metadata enrichment background service, exposed to the UI for awareness.
    /// </summary>
    public record MetadataScanState(
        bool Enabled,
        bool Scanning,
        bool Completed,
        int Total,
        int Written,
        int Skipped,
        int Failed,
        double Progress,
        int InFlight,
        int EtaSeconds,
        IReadOnlyList<MetadataScanItem> Recent,
        bool Paused = false,
        string? PauseReason = null);

    /// <summary>
    ///     Request body for a per-track lookup (returns candidates without writing).
    /// </summary>
    public record MetadataLookupRequest(
        string? MaskedFilename = null,
        string? Artist = null,
        string? Title = null,
        string? Album = null);
}
