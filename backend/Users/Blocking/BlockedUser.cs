// <copyright file="BlockedUser.cs" company="John Narey">
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

using System;
using System.Collections.Generic;

/// <summary>
///     A blocked Soulseek user.
/// </summary>
public class BlockedUser
{
    /// <summary>
    ///     Gets or sets the blocked username.
    /// </summary>
    public string Username { get; set; }

    /// <summary>
    ///     Gets or sets the time at which the user was blocked.
    /// </summary>
    public DateTime BlockedAt { get; set; }

    /// <summary>
    ///     Gets or sets the optional note recorded when the user was blocked.
    /// </summary>
    public string Reason { get; set; }

    /// <summary>
    ///     Gets or sets the IP addresses this user has connected from, learned while they were
    ///     blocked (only populated when same-IP blocking is on and they have connected since).
    /// </summary>
    public IReadOnlyList<string> Ips { get; set; } = [];

    /// <summary>
    ///     Gets or sets the country resolved from the user's known IPs, when the geo database is
    ///     available; null when unknown.
    /// </summary>
    public string Country { get; set; }

    /// <summary>
    ///     Gets or sets the city resolved from the user's known IPs, when the geo database is
    ///     available; null when unknown.
    /// </summary>
    public string City { get; set; }
}
