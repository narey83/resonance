// <copyright file="UpnpService.cs" company="John Narey">
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

using Microsoft.Extensions.Options;

namespace resonance.Integrations.Upnp;

using System;
using System.Collections.Concurrent;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Mono.Nat;
using Serilog;

/// <summary>
///     UPnP integration. Asks the local gateway to forward the Soulseek listen port to this host so that
///     incoming peer connections succeed without a manually configured static port forward.
/// </summary>
public class UpnpService : IDisposable
{
    /// <summary>
    ///     Initializes a new instance of the <see cref="UpnpService"/> class.
    /// </summary>
    /// <param name="optionsAtStartup"></param>
    /// <param name="optionsMonitor"></param>
    /// <param name="stateMutator"></param>
    public UpnpService(
        OptionsAtStartup optionsAtStartup,
        IOptionsMonitor<Options> optionsMonitor,
        IStateMutator<State> stateMutator)
    {
        OptionsAtStartup = optionsAtStartup;
        OptionsMonitor = optionsMonitor;
        StateMutator = stateMutator;

        if (OptionsAtStartup.Integrations.Upnp.Enabled)
        {
            var lease = OptionsAtStartup.Integrations.Upnp.LeaseDuration;

            // renew at half the lease lifetime (so a renewal always lands before expiry), bounded to a sane
            // range. with a permanent mapping (lease == 0) we still poll periodically to (re)assert the mapping
            // in case the gateway dropped it or the listen port changed.
            var renewalSeconds = lease > 0 ? Math.Clamp(lease / 2, 60, 3600) : 300;

            Timer = new System.Timers.Timer(interval: renewalSeconds * 1000d)
            {
                AutoReset = true,
            };

            Timer.Elapsed += async (_, _) => await EnsureMappingAsync();
        }
    }

    /// <summary>
    ///     Gets a value indicating whether the Soulseek listen port is currently mapped on at least one gateway.
    /// </summary>
    public bool IsMapped { get; private set; }

    private OptionsAtStartup OptionsAtStartup { get; }
    private IOptionsMonitor<Options> OptionsMonitor { get; }
    private IStateMutator<State> StateMutator { get; }
    private System.Timers.Timer Timer { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Integrations.UPnP);
    private ConcurrentDictionary<string, INatDevice> Devices { get; } = new();
    private SemaphoreSlim SyncRoot { get; } = new SemaphoreSlim(1, 1);
    private int? MappedPort { get; set; }
    private bool Started { get; set; }
    private bool Disposed { get; set; }

    /// <summary>
    ///     Begins discovering gateways and mapping the Soulseek listen port.
    /// </summary>
    public void Start()
    {
        if (!OptionsAtStartup.Integrations.Upnp.Enabled || Started)
        {
            return;
        }

        Started = true;

        NatUtility.DeviceFound += OnDeviceFound;
        NatUtility.StartDiscovery();
        Timer?.Start();

        StateMutator.SetValue(state => state with { Upnp = state.Upnp with { IsEnabled = true } });

        var options = OptionsMonitor.CurrentValue.Integrations.Upnp;
        Log.Information(
            "UPnP integration enabled; discovering gateway to map Soulseek listen port {Port}/{Protocol}",
            OptionsMonitor.CurrentValue.Soulseek.ListenPort,
            options.Protocol.ToUpperInvariant());
    }

    /// <summary>
    ///     Stops discovery and removes any mappings created by this instance.
    /// </summary>
    public void Stop()
    {
        if (!Started)
        {
            return;
        }

        Timer?.Stop();

        NatUtility.DeviceFound -= OnDeviceFound;

        try
        {
            NatUtility.StopDiscovery();
        }
        catch (Exception ex)
        {
            Log.Debug(ex, "Failed to stop UPnP discovery: {Message}", ex.Message);
        }

        // best effort; the lease will also expire on its own if this fails
        DeleteAllMappingsAsync().GetAwaiter().GetResult();

        IsMapped = false;
        MappedPort = null;
        Started = false;

        StateMutator.SetValue(state => state with { Upnp = new UpnpState() });
        Log.Information("UPnP integration stopped");
    }

    /// <summary>
    ///     Disposes this instance.
    /// </summary>
    public void Dispose()
    {
        Dispose(disposing: true);
        GC.SuppressFinalize(this);
    }

    /// <summary>
    ///     Disposes this instance.
    /// </summary>
    /// <param name="disposing"></param>
    protected virtual void Dispose(bool disposing)
    {
        if (!Disposed)
        {
            if (disposing)
            {
                if (Started)
                {
                    Stop();
                }

                Timer?.Dispose();
                SyncRoot?.Dispose();
            }

            Disposed = true;
        }
    }

    private void OnDeviceFound(object sender, DeviceEventArgs args)
    {
        var device = args.Device;
        var key = DeviceKey(device);

        if (Devices.TryAdd(key, device))
        {
            Log.Information("UPnP gateway discovered: {Gateway}", key);
        }
        else
        {
            Devices[key] = device;
        }

        // fire and forget; EnsureMappingAsync is internally synchronized and swallows its own exceptions
        _ = EnsureMappingAsync();
    }

    private async Task EnsureMappingAsync()
    {
        // one mapping pass at a time
        if (!await SyncRoot.WaitAsync(0))
        {
            return;
        }

        try
        {
            var options = OptionsMonitor.CurrentValue.Integrations.Upnp;

            if (!options.Enabled || Devices.IsEmpty)
            {
                return;
            }

            var port = OptionsMonitor.CurrentValue.Soulseek.ListenPort;
            var protocol = options.Protocol.ToEnum<UpnpProtocol>() == UpnpProtocol.Udp
                ? Protocol.Udp
                : Protocol.Tcp;

            var anyMapped = false;
            IPAddress externalIp = null;
            DateTime? expiresAt = null;
            string lastError = null;

            foreach (var device in Devices.Values)
            {
                try
                {
                    // if the listen port changed since we last mapped, remove the stale mapping first
                    if (MappedPort.HasValue && MappedPort != port)
                    {
                        try
                        {
                            await device.DeletePortMapAsync(new Mapping(protocol, MappedPort.Value, MappedPort.Value));
                        }
                        catch (Exception ex)
                        {
                            Log.Debug(ex, "Failed to remove stale UPnP mapping for port {Port}: {Message}", MappedPort, ex.Message);
                        }
                    }

                    var mapping = await device.CreatePortMapAsync(
                        new Mapping(protocol, privatePort: port, publicPort: port, options.LeaseDuration, "resonance (Soulseek)"));

                    anyMapped = true;

                    if (mapping?.Expiration is DateTime exp && exp > DateTime.UtcNow)
                    {
                        expiresAt = exp;
                    }

                    try
                    {
                        externalIp ??= await device.GetExternalIPAsync();
                    }
                    catch (Exception ex)
                    {
                        Log.Debug(ex, "Failed to read external IP from UPnP gateway: {Message}", ex.Message);
                    }
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    Log.Warning("Failed to create UPnP mapping for port {Port} on {Gateway}: {Message}", port, DeviceKey(device), ex.Message);
                }
            }

            var wasMapped = IsMapped;
            IsMapped = anyMapped;

            if (anyMapped)
            {
                MappedPort = port;

                if (!wasMapped)
                {
                    Log.Information(
                        "UPnP mapping active: {External}:{Port} → :{Port} ({Protocol})",
                        externalIp?.ToString() ?? "?",
                        port,
                        protocol.ToString().ToUpperInvariant());
                }
            }

            StateMutator.SetValue(state => state with
            {
                Upnp = new UpnpState
                {
                    IsEnabled = true,
                    IsMapped = anyMapped,
                    ExternalIPAddress = externalIp,
                    MappedPort = anyMapped ? port : null,
                    LeaseExpiresAt = expiresAt,
                    LastError = anyMapped ? null : lastError,
                },
            });
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "UPnP mapping pass failed: {Message}", ex.Message);
        }
        finally
        {
            SyncRoot.Release();
        }
    }

    private async Task DeleteAllMappingsAsync()
    {
        if (!MappedPort.HasValue)
        {
            return;
        }

        var protocol = OptionsMonitor.CurrentValue.Integrations.Upnp.Protocol.ToEnum<UpnpProtocol>() == UpnpProtocol.Udp
            ? Protocol.Udp
            : Protocol.Tcp;

        foreach (var device in Devices.Values)
        {
            try
            {
                await device.DeletePortMapAsync(new Mapping(protocol, MappedPort.Value, MappedPort.Value));
            }
            catch (Exception ex)
            {
                Log.Debug(ex, "Failed to remove UPnP mapping for port {Port}: {Message}", MappedPort, ex.Message);
            }
        }
    }

    private static string DeviceKey(INatDevice device)
        => device?.DeviceEndpoint?.ToString() ?? device?.GetHashCode().ToString();
}
