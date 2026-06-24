// <copyright file="ICastService.cs" company="John Narey">
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

namespace resonance.Cast
{
    using System.Collections.Generic;
    using System.Threading;
    using System.Threading.Tasks;
    using resonance.Cast.Types;

    public interface ICastService
    {
        IReadOnlyList<DlnaDevice> Devices { get; }
        CastState State { get; }

        /// <summary>Sends an SSDP M-SEARCH and fetches device descriptions. Runs for ~3 seconds.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        Task<IReadOnlyList<DlnaDevice>> DiscoverAsync(CancellationToken cancellationToken = default);

        /// <summary>Sends SetAVTransportURI + Play to the specified renderer.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        Task PlayAsync(string deviceUdn, string absoluteStreamUrl, string title, string artist, string album, CancellationToken cancellationToken = default);

        /// <summary>Sends Stop to the currently active renderer and clears state.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        Task StopAsync(CancellationToken cancellationToken = default);
    }
}
