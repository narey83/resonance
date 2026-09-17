// <copyright file="SearchRequest.cs" company="JP Dillingham">
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

namespace resonance.Search.API
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel.DataAnnotations;
    using Soulseek;

    /// <summary>
    ///     A search request.
    /// </summary>
    public class SearchRequest : IValidatableObject
    {
        /// <summary>
        ///     Gets or sets the unique search identifier.
        /// </summary>
        public Guid? Id { get; set; }

        /// <summary>
        ///     Gets or sets the maximum number of file results to accept before the search is considered complete. (Default = 10,000).
        /// </summary>
        [Range(0, int.MaxValue)]
        public int? FileLimit { get; set; }

        /// <summary>
        ///     Gets or sets a value indicating whether responses are to be filtered. (Default = true).
        /// </summary>
        public bool? FilterResponses { get; set; }

        /// <summary>
        ///     Gets or sets the maximum queue depth a peer may have in order for a response to be processed. (Default = 1000000).
        /// </summary>
        [Range(0, int.MaxValue)]
        public int? MaximumPeerQueueLength { get; set; }

        /// <summary>
        ///     Gets or sets the minimum upload speed a peer must have in order for a response to be processed. (Default = 0).
        /// </summary>
        [Range(0, int.MaxValue)]
        public int? MinimumPeerUploadSpeed { get; set; }

        /// <summary>
        ///     Gets or sets the minimum number of files a response must contain in order to be processed. (Default = 1).
        /// </summary>
        [Range(0, int.MaxValue)]
        public int? MinimumResponseFileCount { get; set; }

        /// <summary>
        ///     Gets or sets the maximum number of search results to accept before the search is considered complete. (Default = 100).
        /// </summary>
        [Range(0, int.MaxValue)]
        public int? ResponseLimit { get; set; }

        /// <summary>
        ///     Gets or sets the search text.
        /// </summary>
        public string SearchText { get; set; }

        /// <summary>
        ///     Gets or sets the search timeout value, in milliseconds, used to determine when the search is
        ///     complete. (Default = 15,000).
        /// </summary>
        /// <remarks>
        ///     <para>The timeout duration is from the time of the last response.</para>
        ///     <para>
        ///         Milliseconds, not seconds: the value is handed to Soulseek.NET unchanged and that is what
        ///         it expects. Documented as seconds until now, so a caller following the documentation and
        ///         asking for 15 got a 15ms search, which times out before any peer can answer and returns
        ///         nothing. No client in this repository sets it, so all of them get the correct default.
        ///         The Range below still reads as though this were seconds; left alone rather than
        ///         tightened, since narrowing it would start rejecting requests that are accepted today.
        ///     </para>
        /// </remarks>
        [Range(5, int.MaxValue)]
        public int? SearchTimeout { get; set; }

        /// <summary>
        ///     Maps to a new instance of <see cref="SearchOptions"/>.
        /// </summary>
        /// <param name="responseFilter"></param>
        /// <param name="fileFilter"></param>
        /// <param name="stateChanged"></param>
        /// <param name="responseReceived"></param>
        /// <param name="defaultMaximumPeerQueueLength">The configured ceiling to apply when the request does not set one.</param>
        /// <returns></returns>
        public SearchOptions ToSearchOptions(
            Func<SearchResponse, bool> responseFilter = null,
            Func<File, bool> fileFilter = null,
            Action<(SearchStates PreviousState, Search Search)> stateChanged = null,
            Action<(Search Search, SearchResponse Response)> responseReceived = null,
            int? defaultMaximumPeerQueueLength = null)
        {
            var def = new SearchOptions();

            // The configured ceiling applies unless the caller asked for one of its own. Zero means the
            // operator turned it off, which is the library's "no limit" rather than "queue must be empty".
            var maximumPeerQueueLength = MaximumPeerQueueLength
                ?? (defaultMaximumPeerQueueLength is > 0 ? defaultMaximumPeerQueueLength : null)
                ?? def.MaximumPeerQueueLength;

            return new SearchOptions(
                searchTimeout: SearchTimeout ?? def.SearchTimeout,
                responseLimit: ResponseLimit ?? def.ResponseLimit,
                fileLimit: FileLimit ?? def.FileLimit,
                filterResponses: FilterResponses ?? def.FilterResponses,
                minimumResponseFileCount: MinimumResponseFileCount ?? def.MinimumResponseFileCount,
                maximumPeerQueueLength: maximumPeerQueueLength,
                minimumPeerUploadSpeed: MinimumPeerUploadSpeed ?? def.MinimumPeerUploadSpeed,
                responseFilter: responseFilter,
                fileFilter: fileFilter,
                responseReceived: responseReceived,
                stateChanged: stateChanged);
        }

        public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
        {
            // todo: adjust this when additional search inputs are made available
            if (string.IsNullOrWhiteSpace(SearchText))
            {
                yield return new ValidationResult("The field SearchText can not be null, empty, or consist of only whitespace", [nameof(SearchText)]);
            }
        }
    }
}
