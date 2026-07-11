// <copyright file="BlockedPlace.cs" company="John Narey">
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

/// <summary>
///     A blocked location. Country is required and matches either the country name or the
///     two-letter ISO code; when a city is set, both must match. IPs the geo database has
///     no location for never match a place rule.
/// </summary>
public class BlockedPlace
{
    /// <summary>
    ///     Gets or sets the row id.
    /// </summary>
    public int Id { get; set; }

    /// <summary>
    ///     Gets or sets the country name or two-letter ISO code to block.
    /// </summary>
    public string Country { get; set; }

    /// <summary>
    ///     Gets or sets the optional city; when set, only this city within the country is blocked.
    /// </summary>
    public string City { get; set; }

    /// <summary>
    ///     Gets or sets the time at which the place was blocked.
    /// </summary>
    public DateTime BlockedAt { get; set; }

    /// <summary>
    ///     Gets or sets the optional note recorded when the place was blocked.
    /// </summary>
    public string Reason { get; set; }
}
