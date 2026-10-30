// <copyright file="UploadRestartRecovery.cs" company="JP Dillingham">
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

namespace resonance.Transfers.Uploads
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using Serilog;
    using Soulseek;
    using Transfer = resonance.Transfers.Transfer;

    /// <summary>Retains unfinished uploads across process restarts and resumes them after login.</summary>
    internal static class UploadRestartRecovery
    {
        private const TransferStates TerminalStates = TransferStates.Completed | TransferStates.Succeeded | TransferStates.Cancelled
            | TransferStates.TimedOut | TransferStates.Errored | TransferStates.Rejected | TransferStates.Aborted;

        private static ILogger Log { get; } = Serilog.Log.ForContext(typeof(UploadRestartRecovery));

        internal static async Task<IReadOnlyList<Guid>> PrepareAsync(IUploadService uploads, string shutdownMessage, CancellationToken cancellationToken)
        {
            var retained = new List<Guid>();
            foreach (var transfer in uploads.ListForRecovery())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!transfer.Removed && (transfer.State & TerminalStates) == 0)
                {
                    retained.Add(transfer.Id);
                    if (!ResetForResume(transfer))
                    {
                        // Existing clean queued rows require no writes, even for a large backlog.
                        continue;
                    }
                }
                else
                {
                    // Explicit cancellation/removal and completed history must never be resurrected.
                    if ((transfer.State & TerminalStates) == 0)
                    {
                        transfer.State = TransferStates.Completed | TransferStates.Errored;
                        transfer.Exception = shutdownMessage;
                    }
                    else
                    {
                        transfer.State |= TransferStates.Completed;
                    }

                    transfer.EndedAt ??= DateTime.UtcNow;
                }

                await TransferRecovery.RetryBusyWriteAsync(() => uploads.Update(transfer), cancellationToken);
            }

            return retained;
        }

        internal static IReadOnlyList<Guid> Resume(IUploadService uploads, IReadOnlyCollection<Guid> retained, bool loggedIn = true, bool sharesReady = true)
        {
            if (!loggedIn || !sharesReady)
            {
                return retained.ToArray();
            }

            if (retained.Count == 0)
            {
                return Array.Empty<Guid>();
            }

            var eligible = uploads.List(t => retained.Contains(t.Id)
                && t.State == (TransferStates.Queued | TransferStates.Locally) && t.EndedAt == null, includeRemoved: false);
            var retryOnNextLogin = new List<Guid>();
            foreach (var peer in eligible.GroupBy(t => t.Username))
            {
                try
                {
                    uploads.ResumeParkedUploads(peer.Key);
                }
                catch (Exception ex)
                {
                    // Keep the IDs if scheduling fails; a subsequent login can retry this peer.
                    retryOnNextLogin.AddRange(peer.Select(t => t.Id));
                    Log.Warning(ex, "Failed to resume recovered uploads to {Username}; queued records retained", peer.Key);
                }
            }

            return retryOnNextLogin;
        }

        private static bool ResetForResume(Transfer transfer)
        {
            var queued = TransferStates.Queued | TransferStates.Locally;
            if (transfer.State == queued && transfer.StartedAt is null && transfer.EndedAt is null
                && transfer.Exception is null && transfer.BytesTransferred == 0 && transfer.AverageSpeed == 0
                && transfer.PlaceInQueue is null)
            {
                return false;
            }

            // The receiving peer negotiates its existing file offset on the next SDK attempt.
            // Do not create a replacement record or change its original request/link metadata.
            transfer.State = queued;
            transfer.StartedAt = null;
            transfer.EndedAt = null;
            transfer.BytesTransferred = 0;
            transfer.AverageSpeed = 0;
            transfer.Exception = null;
            transfer.PlaceInQueue = null;
            return true;
        }
    }
}
