// <copyright file="FileWriteLock.cs" company="John Narey">
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

namespace resonance.Common
{
    using System;
    using System.Threading;

    /// <summary>
    ///     Serializes tag writes to the same audio file across the app. Multiple background
    ///     services (metadata lookup, BPM, key) and the interactive tag editor all open files
    ///     with TagLib and call <c>Save()</c>; two concurrent opens of the same file risk a torn
    ///     write or <see cref="System.IO.IOException"/>. Every writer wraps its open/modify/save in
    ///     <see cref="Acquire"/> so a given file is only ever written by one thread at a time.
    /// </summary>
    /// <remarks>
    ///     Uses lock striping (a fixed pool of gates selected by path hash) rather than a
    ///     per-path dictionary, so memory is bounded and nothing needs cleaning up. Distinct files
    ///     that happen to hash to the same stripe are serialized against each other — harmless given
    ///     writes are brief, and far cheaper than an unbounded, ever-growing lock table.
    /// </remarks>
    public static class FileWriteLock
    {
        private const int StripeCount = 256;
        private static readonly object[] Stripes = CreateStripes();

        /// <summary>
        ///     Acquires the write lock for <paramref name="path"/>. Dispose the returned handle
        ///     (typically via <c>using</c>) to release it.
        /// </summary>
        /// <param name="path">The absolute filesystem path being written.</param>
        /// <returns>A handle that releases the lock when disposed.</returns>
        public static IDisposable Acquire(string path)
        {
            var gate = Stripes[StripeIndexOf(path)];
            Monitor.Enter(gate);
            return new Releaser(gate);
        }

        private static object[] CreateStripes()
        {
            var stripes = new object[StripeCount];
            for (var i = 0; i < StripeCount; i++)
            {
                stripes[i] = new object();
            }

            return stripes;
        }

        private static int StripeIndexOf(string path)
        {
            // Normalize separators/casing so the same file resolves to the same stripe regardless
            // of which caller's path representation we were handed.
            var key = (path ?? string.Empty).Replace('\\', '/').TrimEnd('/');
            var hash = StringComparer.OrdinalIgnoreCase.GetHashCode(key);
            return (hash & int.MaxValue) % StripeCount;
        }

        private sealed class Releaser : IDisposable
        {
            private object gate;

            public Releaser(object gate) => this.gate = gate;

            public void Dispose()
            {
                if (gate != null)
                {
                    Monitor.Exit(gate);
                    gate = null;
                }
            }
        }
    }
}
