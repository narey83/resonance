// <copyright file="UploadPeerCooldown.cs" company="JP Dillingham">
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

    /// <summary>Serializes peer upload attempts and pauses repeated connection failures or remote cancellations without dropping queued work.</summary>
    internal sealed class UploadPeerCooldown(TimeProvider clock = null)
    {
        private static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan Cooldown = TimeSpan.FromMinutes(5);
        private readonly object gate = new();
        private readonly Dictionary<string, PeerState> peers = new(StringComparer.Ordinal);
        private readonly TimeProvider clock = clock ?? TimeProvider.System;
        private DateTimeOffset nextSweep;

        internal DateTimeOffset? GetRetryAt(string username)
        {
            lock (gate)
            {
                return peers.TryGetValue(username, out var peer) && peer.RetryAt > clock.GetUtcNow()
                    ? peer.RetryAt
                    : null;
            }
        }

        internal async Task<Lease> EnterAsync(string username, CancellationToken cancellationToken)
        {
            PeerState state;
            lock (gate)
            {
                var now = clock.GetUtcNow();
                if (now >= nextSweep)
                {
                    foreach (var key in peers.Where(p => p.Value.References == 0 &&
                        (p.Value.RetryAt ?? p.Value.LastFailure) + FailureWindow <= now).Select(p => p.Key).ToArray())
                    {
                        peers[key].Semaphore.Dispose();
                        peers.Remove(key);
                    }

                    nextSweep = now + TimeSpan.FromMinutes(1);
                }

                if (!peers.TryGetValue(username, out state))
                {
                    state = new PeerState();
                    peers.Add(username, state);
                }

                state.References++;
            }

            var acquired = false;
            try
            {
                await state.Semaphore.WaitAsync(cancellationToken);
                acquired = true;
                var delay = (state.RetryAt ?? clock.GetUtcNow()) - clock.GetUtcNow();
                if (delay > TimeSpan.Zero)
                {
                    await Task.Delay(delay, clock, cancellationToken);
                }

                cancellationToken.ThrowIfCancellationRequested();
                return new Lease(this, username, state);
            }
            catch
            {
                Exit(username, state, acquired);
                throw;
            }
        }

        private void Exit(string username, PeerState state, bool acquired)
        {
            if (acquired)
            {
                state.Semaphore.Release();
            }

            lock (gate)
            {
                state.References--;
                if (state.References == 0 && state.Failures.Count == 0 && state.RetryAt is null)
                {
                    peers.Remove(username);
                    state.Semaphore.Dispose();
                }
            }
        }

        internal sealed class PeerState
        {
            internal SemaphoreSlim Semaphore { get; } = new(1, 1);
            internal Queue<DateTimeOffset> Failures { get; } = new();
            internal DateTimeOffset LastFailure { get; set; }
            internal DateTimeOffset? RetryAt { get; set; }
            internal int References { get; set; }
        }

        internal sealed class Lease(UploadPeerCooldown owner, string username, PeerState state) : IDisposable
        {
            private UploadPeerCooldown owner = owner;

            public void Dispose() => Interlocked.Exchange(ref owner, null)?.Exit(username, state, acquired: true);

            internal void RecordSuccess()
            {
                state.Failures.Clear();
                lock (owner.gate)
                {
                    state.RetryAt = null;
                }
            }

            internal DateTimeOffset? RecordFailure()
            {
                var now = owner.clock.GetUtcNow();
                while (state.Failures.TryPeek(out var failure) && failure <= now - FailureWindow)
                {
                    state.Failures.Dequeue();
                }

                state.Failures.Enqueue(now);
                state.LastFailure = now;

                // Once open, allow one probe after each pause. Only a successful upload closes it.
                if (state.RetryAt is not null || state.Failures.Count >= 3)
                {
                    lock (owner.gate)
                    {
                        state.RetryAt = now + Cooldown;
                    }
                }

                return state.RetryAt;
            }
        }
    }
}
