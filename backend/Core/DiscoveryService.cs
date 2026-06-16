// <copyright file="DiscoveryService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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

namespace resonance
{
    using System.Threading;
    using System.Threading.Tasks;
    using Makaretu.Dns;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using Serilog;

    public class DiscoveryService : IHostedService
    {
        public DiscoveryService(IOptions<Options> options)
        {
            Port = (ushort)options.Value.Web.Port;
        }

        private ILogger Log { get; } = Serilog.Log.ForContext<DiscoveryService>();
        private MulticastService Mdns { get; set; }
        private ServiceDiscovery ServiceDiscovery { get; set; }
        private ushort Port { get; }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            try
            {
                Mdns = new MulticastService();
                ServiceDiscovery = new ServiceDiscovery(Mdns);

                var profile = new ServiceProfile("Resonance", "_resonance._tcp", Port);
                ServiceDiscovery.Advertise(profile);
                Mdns.Start();

                Log.Information("mDNS discovery advertising on port {Port}", Port);
            }
            catch (System.Exception ex)
            {
                Log.Warning(ex, "Failed to start mDNS discovery: {Message}", ex.Message);
            }

            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            try
            {
                ServiceDiscovery?.Unadvertise();
                Mdns?.Stop();
            }
            catch
            {
            }

            return Task.CompletedTask;
        }
    }
}
