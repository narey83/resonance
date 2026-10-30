// <copyright file="IMetadataLookupService.cs" company="John Narey">
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
    using System.Threading.Tasks;

    /// <summary>
    ///     Automatically enriches tracks that are missing metadata using an online provider, and
    ///     supports one-off per-track lookups for the tag editor.
    /// </summary>
    public interface IMetadataLookupService
    {
        /// <summary>Gets the current state of the enrichment service (for the awareness UI).</summary>
        MetadataScanState State { get; }

        /// <summary>
        ///     Looks up candidate metadata for a single track without writing anything. Used by the
        ///     tag editor's "Look up online" button.
        /// </summary>
        /// <returns>The candidate matches, best first.</returns>
        Task<IReadOnlyList<MetadataMatch>> LookupAsync(MetadataLookupRequest request);

        /// <summary>
        ///     Requests an immediate enrichment pass, regardless of the enabled schedule. When
        ///     <paramref name="fullRescan"/> is true the attempt cache is bypassed, so tracks the
        ///     providers previously found no match for are queried again.
        /// </summary>
        /// <param name="fullRescan">Whether to bypass the attempt cache and re-query every candidate.</param>
        void RequestRun(bool fullRescan = false);

        /// <summary>
        ///     Stops the in-flight enrichment pass, if any. The service keeps running and a later
        ///     pass picks up where this one left off (already-enriched tracks are skipped).
        /// </summary>
        void RequestStop();

        /// <summary>Gets a bounded page of track outcomes and retained history.</summary>
        /// <returns></returns>
        MetadataActivityPage GetActivity(int page, int pageSize, string search, string outcome);

        /// <summary>Writes an editor draft using a server-issued, track-bound candidate for provenance.</summary>
        void WriteLookupTags(string maskedFilename, resonance.Shares.FileTags tags, string lookupId);
    }
}
