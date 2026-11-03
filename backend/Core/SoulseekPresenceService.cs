// <copyright file="SoulseekPresenceService.cs" company="JP Dillingham">
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

using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Soulseek;

namespace resonance.Core;

public sealed class SoulseekPresenceService(
    ISoulseekClient client,
    IStateMutator<State> state,
    IStateMonitor<State> monitor,
    ILogger<SoulseekPresenceService> logger) : BackgroundService
{
    private readonly SemaphoreSlim gate = new(1);
    private long lastActivity = TimeProvider.System.GetTimestamp();
    private bool manuallyAway;
    private UserPresence? appliedPresence;
    private int loginVersion;
    private int appliedLoginVersion;

    public async Task RecordActivityAsync()
    {
        Interlocked.Exchange(ref lastActivity, TimeProvider.System.GetTimestamp());
        await UpdateAsync();
    }

    public Task SetManualAsync(UserPresence presence) => UpdateAsync(presence);

    internal static UserPresence DesiredPresence(bool manuallyAway, TimeSpan idleTime) =>
        manuallyAway || idleTime >= TimeSpan.FromMinutes(15) ? UserPresence.Away : UserPresence.Online;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        client.LoggedIn += OnLoggedIn;
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await UpdateAsync();
                }
                catch (Exception exception)
                {
                    logger.LogWarning(exception, "Failed to update Soulseek presence");
                }
            }
        }
        finally
        {
            client.LoggedIn -= OnLoggedIn;
        }
    }

    private void OnLoggedIn(object sender, EventArgs args) => Interlocked.Increment(ref loginVersion);

    private async Task UpdateAsync(UserPresence? manualPresence = null)
    {
        await gate.WaitAsync();
        try
        {
            var elapsed = TimeProvider.System.GetElapsedTime(Interlocked.Read(ref lastActivity));
            var desired = manualPresence ?? DesiredPresence(manuallyAway, elapsed);
            var version = Volatile.Read(ref loginVersion);

            if (client.State.HasFlag(SoulseekClientStates.LoggedIn))
            {
                if (appliedPresence != desired || appliedLoginVersion != version)
                {
                    await client.SetStatusAsync(desired);
                    appliedPresence = desired;
                    appliedLoginVersion = version;
                }
            }
            else if (manualPresence is null)
            {
                return;
            }

            if (manualPresence is { } selected)
            {
                manuallyAway = selected == UserPresence.Away;
                Interlocked.Exchange(ref lastActivity, TimeProvider.System.GetTimestamp());
            }

            var label = desired.ToString();
            if (monitor.CurrentValue.User.Presence != label)
            {
                state.SetValue(current => current with { User = current.User with { Presence = label } });
            }
        }
        finally
        {
            gate.Release();
        }
    }
}
