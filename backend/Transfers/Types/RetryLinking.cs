// <copyright file="RetryLinking.cs" company="John Narey">
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

namespace resonance.Transfers;

using System.Collections.Generic;
using System.Linq;

/// <summary>
///     Determines whether a newly enqueued transfer should be linked, via <see cref="Transfer.RetryOfId"/>,
///     to an earlier attempt at the same file.
/// </summary>
public static class RetryLinking
{
    /// <summary>
    ///     Finds the most recent not-yet-removed attempt at <paramref name="filename"/> within
    ///     <paramref name="candidates"/> that ended in failure, if any.
    /// </summary>
    /// <remarks>
    ///     A transfer is only ever linked to a prior *failure*. A successful transfer that is deliberately
    ///     repeated (a re-download, a re-upload) is a new, independent transfer rather than a retry recovering
    ///     from an error, so a successful candidate is never returned here even if it is still present and not
    ///     yet superseded.
    /// </remarks>
    /// <returns>The most recent failed candidate, or null if none of the candidates qualify.</returns>
    public static Transfer FindPriorFailedAttempt(IEnumerable<Transfer> candidates, string filename)
    {
        return candidates
            .Where(t => t.Filename == filename && !t.Removed && TransferStateCategories.Failed.Contains(t.State))
            .OrderByDescending(t => t.EndedAt)
            .FirstOrDefault();
    }
}
