// <copyright file="IFcmPushService.cs" company="John Narey">
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

namespace resonance.Integrations.Fcm
{
    using System.Threading.Tasks;

    /// <summary>
    ///     Firebase Cloud Messaging integration service.
    /// </summary>
    public interface IFcmPushService
    {
        /// <summary>
        ///     Sends a data-only "library updated" push to every registered device, so the mobile app can
        ///     re-sync in the background even while it's backgrounded or killed. A no-op when the
        ///     integration is disabled or no devices are registered. Never throws.
        /// </summary>
        /// <param name="added">Tracks added since the last sync.</param>
        /// <param name="updated">Tracks updated since the last sync.</param>
        /// <param name="removed">Tracks removed since the last sync.</param>
        /// <returns>The operation context.</returns>
        Task SendLibraryUpdatedAsync(int added, int updated, int removed);

        /// <summary>
        ///     Sends a "restart required" push to every device registered to an administrator, so a
        ///     configuration change that needs a restart reaches someone who can actually perform one
        ///     even while the app is backgrounded or killed. A no-op when the integration is disabled
        ///     or no administrator has a registered device. Never throws.
        /// </summary>
        /// <returns>The operation context.</returns>
        Task SendRestartRequiredAsync();
    }
}
