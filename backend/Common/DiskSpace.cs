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
    using System.Runtime.InteropServices;

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
                // DriveInfo uses statfs block size on Linux. VirtioFS may report a
                // larger preferred I/O size there; statvfs exposes the actual unit
                // for its block counts, which keeps download guards accurate.
                if (OperatingSystem.IsLinux() && Environment.Is64BitProcess
                    && NativeMethods.StatVfs(path, out var stats) == 0 && stats.FragmentSize > 0)
                {
                    availableBytes = checked((long)(stats.AvailableBlocks * stats.FragmentSize));
                    totalBytes = checked((long)(stats.Blocks * stats.FragmentSize));
                    return true;
                }

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

        // The first five statvfs fields are unsigned long on 64-bit Linux.
        // Reserve the rest of the native structure without depending on its
        // platform-specific trailing fields. This call is never used on macOS
        // or 32-bit hosts.
        [StructLayout(LayoutKind.Sequential, Size = 256)]
        private struct LinuxFileSystemStats
        {
            public ulong BlockSize;
            public ulong FragmentSize;
            public ulong Blocks;
            public ulong FreeBlocks;
            public ulong AvailableBlocks;
        }

        private static class NativeMethods
        {
            [DllImport("libc", EntryPoint = "statvfs", SetLastError = true)]
            internal static extern int StatVfs([MarshalAs(UnmanagedType.LPUTF8Str)] string path, out LinuxFileSystemStats stats);
        }
    }
}
