// <copyright file="BlockedUserOptions.cs" company="John Narey">
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

namespace resonance.Users.Blocking;

/// <summary>
///     Options controlling which interactions are disabled for blocked users.
///     All default to enabled; individual scopes can be relaxed from the
///     System settings page.
/// </summary>
public class BlockedUserOptions
{
    /// <summary>
    ///     Gets or sets a value indicating whether file transfers to and from blocked users are rejected.
    /// </summary>
    public bool BlockTransfers { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether browse requests from blocked users receive an empty listing.
    /// </summary>
    public bool BlockBrowse { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether search requests from blocked users are ignored.
    /// </summary>
    public bool BlockSearchResponses { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether private messages to and from blocked users are dropped.
    /// </summary>
    public bool BlockPrivateMessages { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether chat room messages from blocked users are hidden.
    /// </summary>
    public bool HideRoomMessages { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether results from blocked users are dropped from searches.
    /// </summary>
    public bool HideSearchResults { get; set; } = true;

    /// <summary>
    ///     Gets or sets a value indicating whether the IPs blocked users connect from are learned,
    ///     and new usernames appearing from those IPs are auto-blocked (ban evasion).
    /// </summary>
    public bool BlockSameIp { get; set; } = true;
}
