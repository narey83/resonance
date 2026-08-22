// <copyright file="SsrfGuard.cs" company="John Narey">
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

namespace resonance.LinkPreview
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Net;
    using System.Net.Http;
    using System.Net.Sockets;
    using System.Threading;
    using System.Threading.Tasks;
    using NetTools;

    /// <summary>
    ///     Blocks outbound connections to private, loopback, link-local and other non-public address
    ///     ranges, so a chat message's link-preview fetch can't be used to reach the host's internal
    ///     network (server-side request forgery) via a malicious or maliciously-redirecting URL.
    /// </summary>
    public static class SsrfGuard
    {
        private static readonly IPAddressRange[] BlockedRanges =
        {
            IPAddressRange.Parse("0.0.0.0/8"),
            IPAddressRange.Parse("10.0.0.0/8"),
            IPAddressRange.Parse("100.64.0.0/10"),
            IPAddressRange.Parse("127.0.0.0/8"),
            IPAddressRange.Parse("169.254.0.0/16"),
            IPAddressRange.Parse("172.16.0.0/12"),
            IPAddressRange.Parse("192.0.0.0/24"),
            IPAddressRange.Parse("192.168.0.0/16"),
            IPAddressRange.Parse("198.18.0.0/15"),
            IPAddressRange.Parse("224.0.0.0/4"),
            IPAddressRange.Parse("240.0.0.0/4"),
            IPAddressRange.Parse("::1/128"),
            IPAddressRange.Parse("64:ff9b::/96"), // NAT64 well-known prefix; can carry an embedded IPv4 target.
            IPAddressRange.Parse("fc00::/7"),
            IPAddressRange.Parse("fe80::/10"),
            IPAddressRange.Parse("ff00::/8"),
        };

        /// <summary>
        ///     Gets a value indicating whether <paramref name="address"/> falls in a private, loopback,
        ///     link-local, or otherwise non-publicly-routable range.
        /// </summary>
        /// <param name="address">The address to check.</param>
        /// <returns>true if the address is blocked; otherwise, false.</returns>
        public static bool IsBlocked(IPAddress address)
        {
            if (address is null)
            {
                return true;
            }

            var candidate = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
            return BlockedRanges.Any(range => range.Contains(candidate));
        }

        /// <summary>
        ///     A <see cref="SocketsHttpHandler.ConnectCallback"/> that resolves the target host itself and
        ///     connects only to the first address that isn't blocked. Running the check here, rather than
        ///     once up front against the requested URL, also covers redirects (the callback fires for
        ///     every TCP connection the handler makes) and defeats DNS-rebinding, where a hostname would
        ///     pass an initial check but resolve to an internal address by the time it's actually dialed.
        /// </summary>
        /// <param name="context">The connection context supplied by <see cref="SocketsHttpHandler"/>.</param>
        /// <param name="cancellationToken">A token that cancels the connect attempt.</param>
        /// <returns>The connected stream.</returns>
        public static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
            var allowed = addresses.FirstOrDefault(ip => !IsBlocked(ip));

            if (allowed is null)
            {
                throw new InvalidOperationException($"Refusing to connect to '{context.DnsEndPoint.Host}': no public address available");
            }

            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };

            try
            {
                await socket.ConnectAsync(new IPEndPoint(allowed, context.DnsEndPoint.Port), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }
    }
}
