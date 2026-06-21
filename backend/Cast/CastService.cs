// <copyright file="CastService.cs" company="JP Dillingham">
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

namespace resonance.Cast
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Linq;
    using System.Net;
    using System.Net.Http;
    using System.Net.Sockets;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using System.Xml;
    using Microsoft.Extensions.Logging;
    using resonance.Cast.Types;

    public class CastService : ICastService
    {
        private static readonly IPAddress SsdpMulticast = IPAddress.Parse("239.255.255.250");
        private static readonly IPEndPoint SsdpEndpoint = new(SsdpMulticast, 1900);

        private static readonly string SsdpSearch =
            "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "MX: 3\r\n" +
            "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";

        public CastService(IHttpClientFactory httpClientFactory, ILogger<CastService> logger)
        {
            Http = httpClientFactory;
            Log = logger;
        }

        public IReadOnlyList<DlnaDevice> Devices => DeviceMap.Values.ToList();
        public CastState State => state;

        private IHttpClientFactory Http { get; }
        private ILogger Log { get; }

        private ConcurrentDictionary<string, DlnaDevice> DeviceMap { get; } = new();
        private volatile CastState state;

        public async Task<IReadOnlyList<DlnaDevice>> DiscoverAsync(CancellationToken cancellationToken = default)
        {
            DeviceMap.Clear();

            var searchBytes = Encoding.UTF8.GetBytes(SsdpSearch);
            var locations = new ConcurrentBag<string>();

            using var udp = new UdpClient();
            udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            udp.Client.Bind(new IPEndPoint(IPAddress.Any, 0));

            try
            {
                await udp.SendAsync(searchBytes, searchBytes.Length, SsdpEndpoint);
            }
            catch (Exception ex)
            {
                Log.LogWarning(ex, "DLNA: failed to send M-SEARCH");
                return Devices;
            }

            // Collect SSDP responses for 3 seconds
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(TimeSpan.FromSeconds(3));

            try
            {
                while (!cts.Token.IsCancellationRequested)
                {
                    var result = await udp.ReceiveAsync(cts.Token);
                    var response = Encoding.UTF8.GetString(result.Buffer);
                    var location = ParseSsdpHeader(response, "LOCATION");
                    if (location != null)
                    {
                        locations.Add(location);
                    }
                }
            }
            catch (OperationCanceledException)
            {
            }

            // Fetch device descriptions in parallel
            var tasks = locations.Distinct(StringComparer.OrdinalIgnoreCase)
                                 .Select(loc => FetchDeviceAsync(loc, cancellationToken));
            await Task.WhenAll(tasks);

            Log.LogInformation("DLNA: discovery complete, {Count} renderer(s) found", DeviceMap.Count);
            return Devices;
        }

        public async Task PlayAsync(
            string deviceUdn,
            string absoluteStreamUrl,
            string title,
            string artist,
            string album,
            CancellationToken cancellationToken = default)
        {
            if (!DeviceMap.TryGetValue(deviceUdn, out var device))
            {
                throw new KeyNotFoundException($"DLNA device '{deviceUdn}' not found");
            }

            var didl = BuildDidlLite(absoluteStreamUrl, title, artist, album);
            var setUriBody = $"<InstanceID>0</InstanceID>" +
                $"<CurrentURI>{XmlEscape(absoluteStreamUrl)}</CurrentURI>" +
                $"<CurrentURIMetaData>{XmlEscape(didl)}</CurrentURIMetaData>";
            var setUri = BuildSoap("SetAVTransportURI", setUriBody);

            var play = BuildSoap("Play",
                "<InstanceID>0</InstanceID><Speed>1</Speed>");

            await SendSoapAsync(device.AvTransportUrl, "SetAVTransportURI", setUri, cancellationToken);
            await SendSoapAsync(device.AvTransportUrl, "Play", play, cancellationToken);

            state = new CastState(device.Udn, device.Name, absoluteStreamUrl);
        }

        public async Task StopAsync(CancellationToken cancellationToken = default)
        {
            if (state == null)
            {
                return;
            }

            if (DeviceMap.TryGetValue(state.DeviceUdn, out var device))
            {
                try
                {
                    var stop = BuildSoap("Stop", "<InstanceID>0</InstanceID>");
                    await SendSoapAsync(device.AvTransportUrl, "Stop", stop, cancellationToken);
                }
                catch (Exception ex)
                {
                    Log.LogWarning(ex, "DLNA: Stop command failed");
                }
            }

            state = null;
        }

        // ── Helpers ──────────────────────────────────────────────────────────
        private async Task FetchDeviceAsync(string location, CancellationToken cancellationToken)
        {
            try
            {
                using var http = Http.CreateClient();
                http.Timeout = TimeSpan.FromSeconds(5);

                var xml = await http.GetStringAsync(location, cancellationToken);
                var doc = new XmlDocument();
                doc.LoadXml(xml);

                var ns = new XmlNamespaceManager(doc.NameTable);
                ns.AddNamespace("u", "urn:schemas-upnp-org:device-1-0");

                var udn = doc.SelectSingleNode("//u:UDN", ns)?.InnerText?.Trim();
                var name = doc.SelectSingleNode("//u:friendlyName", ns)?.InnerText?.Trim();

                if (string.IsNullOrEmpty(udn) || string.IsNullOrEmpty(name))
                {
                    return;
                }

                var services = doc.SelectNodes("//u:service", ns);
                string controlUrl = null;

                foreach (XmlNode service in services)
                {
                    var serviceType = service.SelectSingleNode("u:serviceType", ns)?.InnerText ?? string.Empty;
                    if (!serviceType.Contains("AVTransport", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var rel = service.SelectSingleNode("u:controlURL", ns)?.InnerText;
                    if (rel != null)
                    {
                        controlUrl = new Uri(new Uri(location), rel).ToString();
                        break;
                    }
                }

                if (controlUrl == null)
                {
                    return;
                }

                DeviceMap[udn] = new DlnaDevice(udn, name, location, controlUrl);
                Log.LogDebug("DLNA: found renderer '{Name}' at {Location}", name, location);
            }
            catch (Exception ex)
            {
                Log.LogDebug(ex, "DLNA: failed to fetch device description from {Location}", location);
            }
        }

        private async Task SendSoapAsync(string url, string action, string body, CancellationToken cancellationToken)
        {
            using var http = Http.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(10);

            var content = new StringContent(body, Encoding.UTF8, "text/xml");
            content.Headers.Add("SOAPAction", $"\"urn:schemas-upnp-org:service:AVTransport:1#{action}\"");

            var response = await http.PostAsync(url, content, cancellationToken);
            response.EnsureSuccessStatusCode();
        }

        private static string BuildSoap(string action, string bodyContent) =>
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
            "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
                        "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">" +
              "<s:Body>" +
                $"<u:{action} xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">" +
                  bodyContent +
                $"</u:{action}>" +
              "</s:Body>" +
            "</s:Envelope>";

        private static string BuildDidlLite(string trackUrl, string title, string artist, string album)
        {
            var sb = new StringBuilder();
            sb.Append("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\"")
              .Append(" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"")
              .Append(" xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">")
              .Append("<item id=\"1\" parentID=\"0\" restricted=\"1\">")
              .Append($"<dc:title>{XmlEscape(title ?? string.Empty)}</dc:title>");

            if (!string.IsNullOrEmpty(artist))
            {
                sb.Append($"<dc:creator>{XmlEscape(artist)}</dc:creator>");
            }

            if (!string.IsNullOrEmpty(album))
            {
                sb.Append($"<upnp:album>{XmlEscape(album)}</upnp:album>");
            }

            sb.Append("<upnp:class>object.item.audioItem.musicTrack</upnp:class>")
              .Append($"<res protocolInfo=\"http-get:*:audio/mpeg:*\">{XmlEscape(trackUrl)}</res>")
              .Append("</item></DIDL-Lite>");

            return sb.ToString();
        }

        private static string ParseSsdpHeader(string response, string header)
        {
            foreach (var line in response.Split('\n'))
            {
                if (line.StartsWith(header + ":", StringComparison.OrdinalIgnoreCase))
                {
                    return line[(header.Length + 1)..].Trim();
                }
            }

            return null;
        }

        private static string XmlEscape(string text) =>
            text?.Replace("&", "&amp;")
                 .Replace("<", "&lt;")
                 .Replace(">", "&gt;")
                 .Replace("\"", "&quot;")
                 .Replace("'", "&apos;") ?? string.Empty;
    }
}
