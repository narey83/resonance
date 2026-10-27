// <copyright file="TransferRecovery.cs" company="John Narey">
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

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Retries temporary SQLite writer contention while recovering interrupted transfers.
/// </summary>
internal static class TransferRecovery
{
    /// <summary>
    /// Retries a recovery write up to three times without hiding permanent database failures.
    /// </summary>
    /// <param name="write">The idempotent recovery update, using a fresh context for each attempt.</param>
    /// <param name="token">The application startup cancellation token.</param>
    /// <returns>A task that completes when the update has been persisted.</returns>
    internal static async Task RetryBusyWriteAsync(Action write, CancellationToken token)
    {
        for (var attempt = 0; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            try
            {
                write();
                return;
            }
            catch (Exception ex) when (attempt < 3 && IsBusy(ex))
            {
                Serilog.Log.Information("Waiting for SQLite writer before recovering a transfer (retry {Attempt}/3)", attempt + 1);
                await Task.Delay(TimeSpan.FromMilliseconds(250 * (attempt + 1)), token);
            }
        }
    }

    private static bool IsBusy(Exception exception)
    {
        var sqlite = exception as SqliteException ?? (exception as DbUpdateException)?.InnerException as SqliteException;
        return sqlite?.SqliteErrorCode is 5 or 6;
    }
}
