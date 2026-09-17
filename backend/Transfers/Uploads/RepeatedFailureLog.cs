// <copyright file="RepeatedFailureLog.cs" company="JP Dillingham">
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
    using System.Collections.Concurrent;

    /// <summary>
    ///     Collapses a storm of identical transfer failures into a few examples and a count.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         A peer can have many thousands of files queued with us, and one cause — the server
    ///         connection dropping, the peer going offline — fails every one of them at once. Each
    ///         failure writes two lines, so on 2026-09-17 a single connection blip produced 8,326 log
    ///         lines in two minutes: 55% of that day's warnings, describing one event.
    ///     </para>
    ///     <para>
    ///         Failures are grouped by peer and exception type, because the message text carries the
    ///         filename and so is different every time. The first few of a kind are logged in full, and
    ///         the rest are counted and reported periodically. Nothing is hidden: the count is always
    ///         eventually written, and a failure that is genuinely on its own is never suppressed.
    ///     </para>
    /// </remarks>
    internal sealed class RepeatedFailureLog
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="RepeatedFailureLog"/> class.
        /// </summary>
        /// <param name="verboseOccurrences">How many of a kind are logged in full before counting starts.</param>
        /// <param name="summariseEvery">How many suppressed failures accumulate before a count is reported.</param>
        /// <param name="window">How long a group stays open; after this a new group starts and any pending count is flushed.</param>
        public RepeatedFailureLog(int verboseOccurrences, int summariseEvery, TimeSpan window)
        {
            VerboseOccurrences = verboseOccurrences;
            SummariseEvery = summariseEvery;
            Window = window;
        }

        private int VerboseOccurrences { get; }
        private int SummariseEvery { get; }
        private TimeSpan Window { get; }
        private ConcurrentDictionary<string, Group> Groups { get; } = new();

        /// <summary>
        ///     Records a failure and says what should be written for it.
        /// </summary>
        /// <param name="key">Identifies the kind of failure; failures sharing a key are grouped.</param>
        /// <param name="utcNow">The current time.</param>
        /// <returns>What to log for this occurrence.</returns>
        public Decision Record(string key, DateTime utcNow)
        {
            var group = Groups.GetOrAdd(key, _ => new Group());

            lock (group)
            {
                // A quiet period ends the group: report whatever was still pending and start again, so
                // an unrelated failure later is never silently folded into an old burst.
                if (group.OpenedAt != default && utcNow - group.OpenedAt > Window)
                {
                    var flushed = group.Suppressed;

                    group.OpenedAt = utcNow;
                    group.Seen = 1;
                    group.Suppressed = 0;

                    return new Decision(Verbose: true, Suppressed: flushed);
                }

                if (group.OpenedAt == default)
                {
                    group.OpenedAt = utcNow;
                }

                group.Seen++;

                if (group.Seen <= VerboseOccurrences)
                {
                    return new Decision(Verbose: true, Suppressed: 0);
                }

                group.Suppressed++;

                if (group.Suppressed >= SummariseEvery)
                {
                    var due = group.Suppressed;
                    group.Suppressed = 0;

                    return new Decision(Verbose: false, Suppressed: due);
                }

                return new Decision(Verbose: false, Suppressed: 0);
            }
        }

        /// <summary>
        ///     Reports and clears any count still pending for a group, so a burst that simply stops is
        ///     still accounted for.
        /// </summary>
        /// <param name="key">The group to flush.</param>
        /// <returns>The number of suppressed failures, or zero if none are pending.</returns>
        public int Flush(string key)
        {
            if (!Groups.TryGetValue(key, out var group))
            {
                return 0;
            }

            lock (group)
            {
                var pending = group.Suppressed;
                group.Suppressed = 0;
                return pending;
            }
        }

        /// <summary>
        ///     What to write for one recorded failure.
        /// </summary>
        /// <param name="Verbose">Whether this failure should be logged in full.</param>
        /// <param name="Suppressed">A count of previously suppressed failures to report, or zero.</param>
        internal readonly record struct Decision(bool Verbose, int Suppressed);

        private sealed class Group
        {
            public DateTime OpenedAt { get; set; }

            public int Seen { get; set; }

            public int Suppressed { get; set; }
        }
    }
}
