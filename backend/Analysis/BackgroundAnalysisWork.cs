// <copyright file="AnalysisScanControl.cs" company="John Narey">
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

namespace resonance.Analysis;

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

/// <summary>Lets analysis use idle CPUs while foreground work keeps normal scheduling priority.</summary>
internal static class BackgroundAnalysisWork
{
    internal static void Start(Process process)
    {
        process.Start();
        try
        {
            // Apply before Python imports its numerical libraries, so their threads inherit it.
            process.PriorityClass = ProcessPriorityClass.BelowNormal;
        }
        catch (Exception exception) when (exception is Win32Exception or InvalidOperationException or PlatformNotSupportedException)
        {
            if (!process.HasExited)
            {
                Log.Warning(exception, "Could not lower analysis process priority; continuing with normal scheduling");
            }
        }
    }

    internal static Task<T> RunCpuAsync<T>(Func<T> work, CancellationToken cancellationToken) =>
        Task.Factory.StartNew(() =>
        {
            // LongRunning gives this synchronous calculation a dedicated thread, never a
            // request-pool thread. Linux nice is per-thread; never lower a pooled thread
            // because raising it again can require privileges.
            if (OperatingSystem.IsLinux())
            {
                if (NativeMethods.SetPriority(0, 0, 10) != 0)
                {
                    Log.Warning("Could not lower analysis calculation priority: OS error {Error}", Marshal.GetLastPInvokeError());
                }
            }
            else
            {
                Thread.CurrentThread.Priority = ThreadPriority.BelowNormal;
            }

            cancellationToken.ThrowIfCancellationRequested();
            var result = work();
            cancellationToken.ThrowIfCancellationRequested();
            return result;
        }, cancellationToken, TaskCreationOptions.LongRunning, TaskScheduler.Default);

    private static class NativeMethods
    {
        [DllImport("libc", EntryPoint = "setpriority", SetLastError = true)]
        internal static extern int SetPriority(int which, int who, int priority);
    }
}
