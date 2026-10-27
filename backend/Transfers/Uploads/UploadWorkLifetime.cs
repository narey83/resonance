// <copyright file="UploadWorkLifetime.cs" company="JP Dillingham">
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
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>Owns upload work until shutdown has cancelled and drained it.</summary>
    public sealed class UploadWorkLifetime : IAsyncDisposable
    {
        private readonly object gate = new();
        private readonly CancellationTokenSource shutdown = new();
        private readonly TaskCompletionSource drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int active;
        private bool stopping;

        public CancellationToken Token => shutdown.Token;

        public IDisposable Enter() => TryEnter() ?? throw new OperationCanceledException("Uploads are shutting down", Token);

        public IDisposable TryEnter()
        {
            lock (gate)
            {
                if (stopping)
                {
                    return null;
                }

                active++;
                return new Lease(this);
            }
        }

        public Task StopAsync()
        {
            lock (gate)
            {
                stopping = true;
                if (active == 0)
                {
                    drained.TrySetResult();
                }
            }

            shutdown.Cancel();
            return drained.Task;
        }

        /// <inheritdoc/>
        public async ValueTask DisposeAsync()
        {
            await StopAsync();
            shutdown.Dispose();
        }

        private void Exit()
        {
            lock (gate)
            {
                active--;
                if (stopping && active == 0)
                {
                    drained.TrySetResult();
                }
            }
        }

        private sealed class Lease(UploadWorkLifetime owner) : IDisposable
        {
            private UploadWorkLifetime owner = owner;
            public void Dispose() => Interlocked.Exchange(ref owner, null)?.Exit();
        }
    }
}
