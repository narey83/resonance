// <copyright file="PeerBackpressure.cs" company="JP Dillingham">
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

namespace resonance.Transfers.Downloads
{
    using System;
    using System.Collections.Concurrent;

    /// <summary>
    ///     Tracks how hard a peer is pushing back on our download queue, so a queue-level refusal is
    ///     answered once per peer instead of once per file.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         "Too many files", "too many megabytes" and "queue full" are statements about the whole
    ///         queue with that peer, not about the file that happened to be asked for. Treating them as
    ///         ordinary per-file rejections made the response scale with the size of the batch: every
    ///         active file scheduled its own retry, each retry re-queued another file, and because a
    ///         failed download still counts as a completion it also pulled one more deferred file in
    ///         behind it.
    ///     </para>
    ///     <para>
    ///         Observed in production on 2026-09-17: 319 files queued from one peer produced 7,187
    ///         download attempts in 24 hours, none of which ever succeeded, at roughly 500 log lines a
    ///         minute. The peer was refusing the queue from the first request and every retry made the
    ///         queue it was refusing bigger.
    ///     </para>
    ///     <para>
    ///         So refusals are counted per peer, with an exponential hold that every retry and every
    ///         deferred activation waits behind. Any successful transfer clears it. A peer that keeps
    ///         refusing without ever completing anything is eventually left alone rather than retried
    ///         forever — its queued files are kept, not discarded, so they are still visible and can be
    ///         retried deliberately.
    ///     </para>
    /// </remarks>
    internal sealed class PeerBackpressure
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="PeerBackpressure"/> class.
        /// </summary>
        /// <param name="giveUpAfter">Consecutive refusals, with no success in between, before a peer is left alone.</param>
        /// <param name="baseDelay">The hold applied after the first refusal.</param>
        /// <param name="maxDelay">The longest hold, however many refusals accumulate.</param>
        public PeerBackpressure(int giveUpAfter, TimeSpan baseDelay, TimeSpan maxDelay, int maxActive)
        {
            GiveUpAfter = giveUpAfter;
            BaseDelay = baseDelay;
            MaxDelay = maxDelay;
            MaxActive = maxActive;
        }

        private int GiveUpAfter { get; }
        private TimeSpan BaseDelay { get; }
        private TimeSpan MaxDelay { get; }
        private int MaxActive { get; }
        private ConcurrentDictionary<string, State> Peers { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        ///     Gets how many files we should currently keep active with a peer.
        /// </summary>
        /// <remarks>
        ///     "Too many files" is a request to ask for fewer, so waiting and then asking for the same
        ///     number again just earns the same refusal. Each refused round halves the allowance, down to
        ///     a single file; if the peer will serve anything at all, this finds the number it accepts.
        /// </remarks>
        /// <param name="username">The peer to check.</param>
        /// <returns>The number of files to activate at once.</returns>
        public int ActiveLimit(string username) =>
            Peers.TryGetValue(username, out var state) ? state.ActiveLimit : MaxActive;

        /// <summary>
        ///     Records a queue-level refusal from a peer.
        /// </summary>
        /// <param name="username">The peer that refused.</param>
        /// <param name="utcNow">The current time.</param>
        /// <param name="heldUntil">When the peer may next be tried; unset once we have given up.</param>
        /// <returns>A value indicating whether it is still worth retrying this peer.</returns>
        public bool Refused(string username, DateTime utcNow, out DateTime heldUntil)
        {
            var state = Peers.GetOrAdd(username, _ => new State { ActiveLimit = MaxActive });

            lock (state)
            {
                if (state.GivenUp)
                {
                    heldUntil = default;
                    return false;
                }

                // Every file active with a peer is refused at the same moment -- fifty of them, for a
                // batch that filled the activation chunk -- so a refusal arriving while the hold is
                // still running belongs to the round that caused it, and must not count again. Counting
                // each one spent the whole allowance inside a second and gave up without ever having
                // waited, which is the opposite of the intent.
                if (state.HeldUntil > utcNow)
                {
                    heldUntil = state.HeldUntil;
                    return true;
                }

                state.Refusals++;

                // Ask for fewer next time. The peer told us the number was the problem.
                state.ActiveLimit = Math.Max(1, state.ActiveLimit / 2);

                if (state.Refusals >= GiveUpAfter)
                {
                    state.GivenUp = true;
                    heldUntil = default;
                    return false;
                }

                // Doubling from the base delay: the first refusal may be a momentary full queue, but a
                // peer still refusing after several rounds is not going to be talked round by asking faster.
                var backoffTicks = Math.Min(
                    BaseDelay.Ticks * (1L << Math.Min(state.Refusals - 1, 16)),
                    MaxDelay.Ticks);

                state.HeldUntil = utcNow.AddTicks(backoffTicks);
                heldUntil = state.HeldUntil;
                return true;
            }
        }

        /// <summary>
        ///     Records that a peer completed a transfer, which clears any accumulated backpressure.
        /// </summary>
        /// <param name="username">The peer that succeeded.</param>
        public void Succeeded(string username) => Peers.TryRemove(username, out _);

        /// <summary>
        ///     Determines whether a peer is currently being held off.
        /// </summary>
        /// <param name="username">The peer to check.</param>
        /// <param name="utcNow">The current time.</param>
        /// <param name="heldUntil">When the hold expires; unset when the peer is not held.</param>
        /// <returns>A value indicating whether the peer should be left alone for now.</returns>
        public bool IsHeld(string username, DateTime utcNow, out DateTime heldUntil)
        {
            heldUntil = default;

            if (!Peers.TryGetValue(username, out var state))
            {
                return false;
            }

            if (state.GivenUp)
            {
                return true;
            }

            if (state.HeldUntil > utcNow)
            {
                heldUntil = state.HeldUntil;
                return true;
            }

            return false;
        }

        /// <summary>
        ///     Determines whether a peer has refused often enough that we have stopped retrying it.
        /// </summary>
        /// <param name="username">The peer to check.</param>
        /// <returns>A value indicating whether the peer has been given up on.</returns>
        public bool HasGivenUp(string username) =>
            Peers.TryGetValue(username, out var state) && state.GivenUp;

        /// <summary>
        ///     Gets the number of consecutive refusals recorded for a peer.
        /// </summary>
        /// <param name="username">The peer to check.</param>
        /// <returns>The refusal count, or zero if the peer is not being held.</returns>
        public int RefusalCount(string username) =>
            Peers.TryGetValue(username, out var state) ? state.Refusals : 0;

        /// <summary>
        ///     Releases a peer we had given up on, so a deliberate request is tried again.
        /// </summary>
        /// <remarks>
        ///     The hold and the refusal count are cleared, but the batch size we learned is kept: the peer
        ///     refused fifty files a moment ago and asking for fifty again would simply repeat that. Only a
        ///     transfer actually completing (see <see cref="Succeeded"/>) clears the peer outright.
        /// </remarks>
        /// <param name="username">The peer to release.</param>
        public void Clear(string username)
        {
            if (!Peers.TryGetValue(username, out var state))
            {
                return;
            }

            lock (state)
            {
                state.Refusals = 0;
                state.HeldUntil = default;
                state.GivenUp = false;
            }
        }

        private sealed class State
        {
            public int Refusals { get; set; }

            public DateTime HeldUntil { get; set; }

            public bool GivenUp { get; set; }

            public int ActiveLimit { get; set; }
        }
    }
}
