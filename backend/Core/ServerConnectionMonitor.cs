// <copyright file="ServerConnectionMonitor.cs" company="John Narey">
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

namespace resonance
{
    using System;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Actively probes the Soulseek server connection so that a silently stalled ("half-open") connection is
    ///     detected and reconnected, instead of appearing healthy forever.
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         The server connection deliberately disables the client-level inactivity watchdog (see
    ///         <c>serverOptions</c> in <see cref="Application"/>) because it can legitimately idle, and relies on
    ///         OS-level TCP keepalive to detect a dead socket. That is sufficient when the socket itself dies, but it
    ///         cannot detect an <em>application-layer</em> half-open: the Soulseek server (or a middlebox on the path)
    ///         stops routing traffic to us while the TCP connection is still ACKed and therefore stays <c>ESTABLISHED</c>.
    ///         In that state the client keeps reporting <c>Connected, LoggedIn</c>, no <c>Disconnected</c> event ever
    ///         fires, and <see cref="ConnectionWatchdog"/> — which only reconnects in response to a disconnect — never
    ///         runs. Symptom: uploads/searches silently dry up for hours while the app looks perfectly healthy.
    ///     </para>
    ///     <para>
    ///         This monitor closes that gap by periodically issuing a lightweight server round-trip
    ///         (<see cref="ISoulseekClient.GetPrivilegesAsync"/>) with a timeout. A healthy connection answers even when
    ///         the network is otherwise quiet, so an idle connection is <em>not</em> mistaken for a dead one. Only when
    ///         several consecutive probes fail do we conclude the connection is stale and force a disconnect with a
    ///         non-intentional exception, which routes through <c>Client_Disconnected</c> in <see cref="Application"/> and
    ///         starts the reconnect loop — exactly the recovery path used for any other unexpected disconnect.
    ///     </para>
    ///     <para>
    ///         <see cref="ISoulseekClient.PingServerAsync"/> is intentionally not used: its own documentation notes the
    ///         live server does not reliably respond to it, which would produce false-positive reconnects.
    ///     </para>
    /// </remarks>
    public sealed class ServerConnectionMonitor : IHostedService, IDisposable
    {
        /// <summary>
        ///     How often to probe the server connection for liveness.
        /// </summary>
        private static readonly TimeSpan ProbeInterval = TimeSpan.FromMinutes(2);

        /// <summary>
        ///     How long to wait for a probe round-trip before treating it as failed.
        /// </summary>
        private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(15);

        /// <summary>
        ///     The number of consecutive failed probes tolerated before forcing a reconnect. A small allowance avoids
        ///     reacting to a single transient hiccup on an otherwise healthy connection.
        /// </summary>
        private const int MaxConsecutiveFailures = 2;

        /// <summary>
        ///     Initializes a new instance of the <see cref="ServerConnectionMonitor"/> class.
        /// </summary>
        /// <param name="soulseekClient">The Soulseek client whose server connection is monitored.</param>
        /// <param name="connectionWatchdog">The watchdog that owns the reconnect loop.</param>
        public ServerConnectionMonitor(
            ISoulseekClient soulseekClient,
            ConnectionWatchdog connectionWatchdog)
        {
            Client = soulseekClient;
            ConnectionWatchdog = connectionWatchdog;

            Timer = new System.Timers.Timer()
            {
                Interval = ProbeInterval.TotalMilliseconds,
                AutoReset = true,
                Enabled = false,
            };

            Timer.Elapsed += (_, _) => _ = ProbeAsync();
        }

        private ISoulseekClient Client { get; }
        private ConnectionWatchdog ConnectionWatchdog { get; }
        private System.Timers.Timer Timer { get; }
        private SemaphoreSlim SyncRoot { get; } = new SemaphoreSlim(1, 1);
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Connection);
        private int ConsecutiveFailures { get; set; }
        private bool Stopping { get; set; }
        private bool Disposed { get; set; }

        /// <inheritdoc/>
        public Task StartAsync(CancellationToken cancellationToken)
        {
            // relay agents never connect to the Soulseek server, so there is nothing to monitor.
            if (Program.IsRelayAgent)
            {
                return Task.CompletedTask;
            }

            Timer.Enabled = true;
            return Task.CompletedTask;
        }

        /// <inheritdoc/>
        public Task StopAsync(CancellationToken cancellationToken)
        {
            Stopping = true;
            Timer.Enabled = false;
            return Task.CompletedTask;
        }

        /// <inheritdoc/>
        public void Dispose()
        {
            if (Disposed)
            {
                return;
            }

            Timer?.Dispose();
            SyncRoot?.Dispose();
            Disposed = true;
        }

        private async Task ProbeAsync()
        {
            // skip if a probe is already in flight; the probe timeout is well under the interval, so this is just a guard.
            if (!await SyncRoot.WaitAsync(0))
            {
                return;
            }

            try
            {
                if (Stopping)
                {
                    return;
                }

                // only probe when we believe we're fully online. if we're not connected/logged in, a reconnect is
                // either already underway (ConnectionWatchdog) or was intentional; either way it's not ours to drive.
                var isOnline = Client.State.HasFlag(SoulseekClientStates.Connected)
                    && Client.State.HasFlag(SoulseekClientStates.LoggedIn);

                if (!isOnline || ConnectionWatchdog.IsEnabled)
                {
                    ConsecutiveFailures = 0;
                    return;
                }

                try
                {
                    using var cts = new CancellationTokenSource(ProbeTimeout);

                    // any server round-trip works; GetPrivileges is cheap, argument-free, and reliably answered by the
                    // live server (the app already uses it on login). we only care that a response comes back.
                    await Client.GetPrivilegesAsync(cts.Token);

                    if (ConsecutiveFailures > 0)
                    {
                        Log.Information("Server connection recovered; liveness probe succeeded after {Failures} failure(s)", ConsecutiveFailures);
                    }
                    else
                    {
                        Log.Debug("Server connection liveness probe ok");
                    }

                    ConsecutiveFailures = 0;
                }
                catch (Exception ex)
                {
                    // re-check state: the connection may have dropped legitimately mid-probe, in which case the normal
                    // disconnect path is already handling reconnection and this failure is not evidence of a stale socket.
                    var stillOnline = Client.State.HasFlag(SoulseekClientStates.Connected)
                        && Client.State.HasFlag(SoulseekClientStates.LoggedIn);

                    if (!stillOnline || ConnectionWatchdog.IsEnabled)
                    {
                        ConsecutiveFailures = 0;
                        return;
                    }

                    ConsecutiveFailures++;
                    Log.Warning(
                        "Server connection liveness probe failed ({Failures}/{Max}): {Message}",
                        ConsecutiveFailures,
                        MaxConsecutiveFailures,
                        ex.Message);

                    if (ConsecutiveFailures >= MaxConsecutiveFailures)
                    {
                        Log.Error(
                            "Server connection appears stale ({Failures} consecutive failed probes) despite reporting connected; forcing a reconnect",
                            ConsecutiveFailures);

                        ConsecutiveFailures = 0;

                        // a non-intentional disconnect routes through Client_Disconnected, which starts the
                        // ConnectionWatchdog reconnect loop — the same recovery used for any unexpected disconnect.
                        Client.Disconnect(
                            "Server connection failed liveness check",
                            new ConnectionException("Server connection failed liveness check"));
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Unexpected error in server connection monitor: {Message}", ex.Message);
            }
            finally
            {
                SyncRoot.Release();
            }
        }
    }
}
