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
using System.Threading;
using System.Threading.Tasks;

/// <summary>Serializes track admission with pause/resume and graceful end requests.</summary>
internal sealed class AnalysisScanControl : IDisposable
{
    private readonly object sync = new();
    private readonly CancellationTokenSource ending = new();
    private TaskCompletionSource<bool> resumed = NewSignal();
    private bool paused;
    private bool endRequested;
    private bool finished;

    /// <summary>Initializes a new instance of the <see cref="AnalysisScanControl"/> class.</summary>
    internal AnalysisScanControl() => resumed.SetResult(true);

    /// <summary>Gets cancellation for dispatch only, never for admitted track work.</summary>
    internal CancellationToken EndToken => ending.Token;

    /// <summary>Gets the current dispatch controls atomically.</summary>
    internal (bool Paused, bool Ending) State
    {
        get
        {
            lock (sync)
            {
                return (paused && !finished, endRequested && !finished);
            }
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        lock (sync)
        {
            if (finished)
            {
                return;
            }

            finished = true;
            resumed.TrySetResult(true);
            ending.Cancel();
            ending.Dispose();
        }
    }

    /// <summary>Holds subsequent track admissions without cancelling active work.</summary>
    /// <returns>False after the run has ended.</returns>
    internal bool Pause()
    {
        lock (sync)
        {
            if (finished || endRequested)
            {
                return false;
            }

            if (!paused)
            {
                paused = true;
                resumed = NewSignal();
            }

            return true;
        }
    }

    /// <summary>Releases the same queue to continue dispatching.</summary>
    /// <returns>False after the run has ended.</returns>
    internal bool Resume()
    {
        lock (sync)
        {
            if (finished || endRequested)
            {
                return false;
            }

            paused = false;
            resumed.TrySetResult(true);
            return true;
        }
    }

    /// <summary>Ends dispatch while allowing already admitted work to finish.</summary>
    /// <returns>False after the run has completed.</returns>
    internal bool End()
    {
        lock (sync)
        {
            if (finished)
            {
                return false;
            }

            endRequested = true;
            paused = false;
            resumed.TrySetResult(true);
            ending.Cancel();
            return true;
        }
    }

    /// <summary>Waits for permission and atomically records the start of one track.</summary>
    /// <param name="onStarted">Runs under the dispatch lock before pause/end can return.</param>
    /// <param name="cancellationToken">Cancels waiting, not an admitted track.</param>
    /// <returns>A task completing when this track is admitted.</returns>
    internal async Task AdmitAsync(Action onStarted, CancellationToken cancellationToken)
    {
        while (true)
        {
            Task wait;
            lock (sync)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (finished || endRequested)
                {
                    throw new OperationCanceledException(cancellationToken);
                }

                if (!paused)
                {
                    onStarted();
                    return;
                }

                wait = resumed.Task;
            }

            await wait.WaitAsync(cancellationToken);
        }
    }

    private static TaskCompletionSource<bool> NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
