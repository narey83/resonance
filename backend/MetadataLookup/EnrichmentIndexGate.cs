// <copyright file="EnrichmentIndexGate.cs" company="John Narey">
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

// Copyright (c) 2026 John Narey. SPDX-License-Identifier: AGPL-3.0-only
namespace resonance.MetadataLookup;

using System;
using System.Threading;
using System.Threading.Tasks;
using resonance.Core;

/// <summary>Lets the share index own disk access before enrichment starts or writes a file.</summary>
internal sealed class EnrichmentIndexGate
{
    private readonly Func<ShareState> readState;
    private readonly Func<CancellationToken, Task> delay;

    internal EnrichmentIndexGate(Func<ShareState> readState, Func<CancellationToken, Task> delay = null)
    {
        this.readState = readState;
        this.delay = delay ?? (ct => Task.Delay(TimeSpan.FromSeconds(1), ct));
    }

    internal bool Blocked
    {
        get
        {
            var state = readState();
            return !state.Ready || state.Scanning || state.ScanPending;
        }
    }

    internal async Task WaitAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        while (Blocked)
        {
            await delay(ct);
            ct.ThrowIfCancellationRequested();
        }
    }
}
