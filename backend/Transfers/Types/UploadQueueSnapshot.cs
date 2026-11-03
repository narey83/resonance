// <copyright file="UploadQueueSnapshot.cs" company="JP Dillingham">
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

namespace resonance.Transfers;

using System;
using System.Collections.Generic;

/// <summary>Full unfinished counts for one upload recipient, without loading their tracks.</summary>
/// <param name="Username">The recipient.</param>
/// <param name="PendingCount">All unfinished requests for the recipient.</param>
/// <param name="ActiveCount">Requests sending or connecting.</param>
public sealed record UploadQueueUser(string Username, int PendingCount, int ActiveCount)
{
    /// <summary>Gets requests waiting to send.</summary>
    public int WaitingCount => PendingCount - ActiveCount;

    /// <summary>Gets uploads currently sending data, excluding connection setup.</summary>
    public int SendingCount { get; init; }

    /// <summary>Gets the earliest time another attempt can start while the recipient is paused.</summary>
    public DateTimeOffset? RetryAt { get; init; }
}

/// <summary>All queue recipients plus a bounded track page for the selected recipient.</summary>
/// <param name="Users">Full counts for every recipient with unfinished uploads.</param>
/// <param name="Username">The selected recipient, or null for an empty queue.</param>
/// <param name="Page">The selected recipient's zero-based page.</param>
/// <param name="TotalPending">Unfinished requests across all recipients.</param>
/// <param name="UserTotalPending">Unfinished requests for the selected recipient.</param>
/// <param name="Transfers">Selected pending tracks.</param>
public sealed record UploadQueueSnapshot(IReadOnlyList<UploadQueueUser> Users, string Username, int Page,
    int TotalPending, int UserTotalPending, List<Transfer> Transfers);
