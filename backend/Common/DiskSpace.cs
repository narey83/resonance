// <copyright file="DiskSpace.cs" company="John Narey">
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
    using System.IO;

    /// <summary>
    ///     Free disk space checks for download guards and monitoring.
    /// </summary>
    public static class DiskSpace
    {
        private static readonly Serilog.ILogger Log = Serilog.Log.ForContext("SourceContext", resonance.Logs.DiskSpace);

        /// <summary>
        ///     Gets the available and total bytes on the volume containing <paramref name="path"/>. Returns false if the check fails.
        /// </summary>
        /// <returns>A value indicating whether the volume could be read.</returns>
        public static bool TryGet(string path, out long availableBytes, out long totalBytes)
        {
            try
            {
                var drive = new DriveInfo(path);
                availableBytes = drive.AvailableFreeSpace;
                totalBytes = drive.TotalSize;
                return true;
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to read free disk space for {Path}: {Message}", path, ex.Message);
                availableBytes = 0;
                totalBytes = 0;
                return false;
            }
        }

        /// <summary>
        ///     Returns true if the volume containing <paramref name="path"/> has less than <paramref name="minimumMegabytes"/> free.
        ///     Fails open: returns false when no limit is set or the volume can't be read.
        /// </summary>
        /// <returns>A value indicating whether free space is below the configured minimum.</returns>
        public static bool IsBelowLimit(string path, int? minimumMegabytes)
            => minimumMegabytes.HasValue
                && TryGet(path, out var availableBytes, out _)
                && availableBytes < minimumMegabytes.Value * 1024L * 1024L;
    }
}
