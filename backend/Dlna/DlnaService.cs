// <copyright file="DlnaService.cs" company="John Narey">
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

namespace resonance.Dlna
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Net;
    using System.Net.Sockets;
    using System.Security.Cryptography;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using Serilog;
    using SixLabors.ImageSharp;
    using SixLabors.ImageSharp.Formats.Jpeg;
    using SixLabors.ImageSharp.Processing;

    public sealed class DlnaService : IHostedService, IDisposable
    {
        private const int SsdpPort = 1900;

        private const int ThumbnailSize = 256;

        private const string SourceProtocolInfo =
            "http-get:*:audio/mpeg:DLNA.ORG_PN=MP3;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/flac:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/ogg:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/wav:DLNA.ORG_PN=LPCM;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/aac:DLNA.ORG_PN=AAC_ISO_320;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/mp4:DLNA.ORG_PN=AAC_ISO_320;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000," +
            "http-get:*:audio/x-ms-wma:DLNA.ORG_PN=WMAFULL;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

        private static readonly IPAddress SsdpMulticast = IPAddress.Parse("239.255.255.250");

        private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte[]> ArtCache = new();
        private static readonly SemaphoreSlim ArtWarmSemaphore = new(4, 4);

        private readonly MusicLibrary.IMusicLibraryService musicLibrary;
        private readonly IOptionsMonitor<resonance.Options> optionsMonitor;
        private readonly ILogger log = Log.ForContext("SourceContext", Logs.Dlna);

        private HttpListener? httpListener;
        private CancellationTokenSource? cts;
        private string uuid = string.Empty;
        private string localIp = "127.0.0.1";

        public DlnaService(
            MusicLibrary.IMusicLibraryService musicLibrary,
            IOptionsMonitor<resonance.Options> optionsMonitor)
        {
            this.musicLibrary = musicLibrary;
            this.optionsMonitor = optionsMonitor;
        }

        private static string SystemUpdateId => DlnaContentDirectory.SystemUpdateId;

        public Task StartAsync(CancellationToken cancellationToken)
        {
            var options = optionsMonitor.CurrentValue.Dlna;
            if (!options.Enabled)
            {
                log.Debug("DLNA server disabled");
                return Task.CompletedTask;
            }

            uuid = DeriveDeviceUuid();
            localIp = GetLocalIpAddress();
            log.Information("Starting DLNA server on {Ip}:{Port}", localIp, options.Port);

            cts = new CancellationTokenSource();
            StartHttpServer(options.Port);
            _ = SsdpAnnounceLoopAsync(options, cts.Token);
            _ = SsdpListenLoopAsync(options, cts.Token);

            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            cts?.Cancel();
            try
            {
                httpListener?.Stop();
            }
            catch
            {
            }

            SendSsdpByebye();
            log.Information("DLNA server stopped");
            return Task.CompletedTask;
        }

        public void Dispose()
        {
            cts?.Cancel();
            cts?.Dispose();
            httpListener?.Close();
        }

        private static string? ExtractHeader(string message, string header)
        {
            var prefix = header + ":";
            foreach (var line in message.Split('\n'))
            {
                if (line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return line[prefix.Length..].Trim();
                }
            }

            return null;
        }

        private static string? ExtractXmlValue(string xml, string element)
        {
            var open = $"<{element}>";
            var close = $"</{element}>";
            var start = xml.IndexOf(open, StringComparison.Ordinal);
            if (start < 0)
            {
                return null;
            }

            start += open.Length;
            var end = xml.IndexOf(close, start, StringComparison.Ordinal);
            return end < 0 ? null : xml[start..end];
        }

        private static byte[] MakeThumbnail(byte[] source)
        {
            try
            {
                using var img = Image.Load(source);
                int size = Math.Min(img.Width, img.Height);
                img.Mutate(ctx => ctx
                    .Crop(new Rectangle((img.Width - size) / 2, (img.Height - size) / 2, size, size))
                    .Resize(ThumbnailSize, ThumbnailSize));
                using var ms = new MemoryStream();
                img.SaveAsJpeg(ms, new JpegEncoder { Quality = 85 });
                return ms.ToArray();
            }
            catch
            {
                return source;
            }
        }

        private static async Task ServeEmbeddedArtAsync(HttpListenerResponse resp, string localPath)
        {
            if (!File.Exists(localPath))
            {
                resp.StatusCode = 404;
                resp.Close();
                return;
            }

            try
            {
                if (!ArtCache.TryGetValue(localPath, out var bytes))
                {
                    using var tf = TagLib.File.Create(localPath, TagLib.ReadStyle.None);
                    var pic = tf.Tag.Pictures?.FirstOrDefault();
                    if (pic == null || pic.Data.Count == 0)
                    {
                        resp.StatusCode = 404;
                        resp.Close();
                        return;
                    }

                    bytes = MakeThumbnail(pic.Data.Data);
                    ArtCache[localPath] = bytes;
                }

                resp.ContentType = "image/jpeg";
                resp.ContentLength64 = bytes.Length;
                await resp.OutputStream.WriteAsync(bytes);
            }
            catch
            {
                resp.StatusCode = 404;
            }

            resp.Close();
        }

        private static Task WarmEmbeddedArtAsync(string localPath) => Task.Run(() =>
        {
            if (!File.Exists(localPath))
            {
                return;
            }

            using var tf = TagLib.File.Create(localPath, TagLib.ReadStyle.None);
            var pic = tf.Tag.Pictures?.FirstOrDefault();
            if (pic == null || pic.Data.Count == 0)
            {
                return;
            }

            ArtCache[localPath] = MakeThumbnail(pic.Data.Data);
        });

        private static string? ParseCallbackUrl(string? header)
        {
            if (string.IsNullOrEmpty(header))
            {
                return null;
            }

            var start = header.IndexOf('<');
            var end = header.IndexOf('>');
            return start >= 0 && end > start ? header[(start + 1)..end] : null;
        }

        private static async Task ServeXmlAsync(HttpListenerResponse resp, string xml)
        {
            var bytes = Encoding.UTF8.GetBytes(xml);
            resp.ContentType = "text/xml; charset=\"utf-8\"";
            resp.ContentLength64 = bytes.Length;
            resp.Headers["EXT"] = string.Empty;
            resp.Headers["Server"] = "Linux/1.0 UPnP/1.0 Resonance/1.0";
            await resp.OutputStream.WriteAsync(bytes);
            resp.Close();
        }

        private static string ConnectionIdsResponse() => """
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:GetCurrentConnectionIDsResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
                  <ConnectionIDs>0</ConnectionIDs>
                </u:GetCurrentConnectionIDsResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string ConnectionInfoResponse() => """
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:GetCurrentConnectionInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
                  <RcsID>-1</RcsID>
                  <AVTransportID>-1</AVTransportID>
                  <ProtocolInfo></ProtocolInfo>
                  <PeerConnectionManager></PeerConnectionManager>
                  <PeerConnectionID>-1</PeerConnectionID>
                  <Direction>Output</Direction>
                  <Status>OK</Status>
                </u:GetCurrentConnectionInfoResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string ConnectionManagerResponse() => $"""
            <?xml version="1.0"?>
            <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                <u:GetProtocolInfoResponse xmlns:u="urn:schemas-upnp-org:service:ConnectionManager:1">
                  <Source>{SourceProtocolInfo}</Source>
                  <Sink></Sink>
                </u:GetProtocolInfoResponse>
              </s:Body>
            </s:Envelope>
            """;

        private static string DetectImageMime(byte[] bytes)
        {
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xD8)
            {
                return "image/jpeg";
            }

            if (bytes.Length >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50)
            {
                return "image/png";
            }

            if (bytes.Length >= 3 && bytes[0] == 0x47 && bytes[1] == 0x49)
            {
                return "image/gif";
            }

            return "image/jpeg";
        }

        private static string DeriveDeviceUuid()
        {
            var seed = $"resonance-dlna:{Environment.MachineName}:{AppContext.BaseDirectory}";
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(seed));
            return new Guid(hash[..16]).ToString();
        }

        private static string GetLocalIpAddress()
        {
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
                socket.Connect("8.8.8.8", 80);
                return ((IPEndPoint)socket.LocalEndPoint!).Address.ToString();
            }
            catch
            {
                return "127.0.0.1";
            }
        }

        // ── HTTP server ───────────────────────────────────────────────────────────
        private void StartHttpServer(int port)
        {
            httpListener = new HttpListener();
            httpListener.Prefixes.Add($"http://+:{port}/");
            httpListener.Start();
            _ = AcceptLoopAsync(cts!.Token);
            log.Debug("DLNA HTTP listener started on port {Port}", port);
        }

        private async Task AcceptLoopAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var context = await httpListener!.GetContextAsync();
                    _ = HandleRequestAsync(context);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    log.Warning(ex, "DLNA accept loop error");
                }
            }
        }

        private async Task HandleRequestAsync(HttpListenerContext context)
        {
            var req = context.Request;
            var resp = context.Response;
            var path = req.Url?.AbsolutePath ?? "/";

            try
            {
                log.Information("DLNA {Method} {Path} UA={UA}", req.HttpMethod, path, req.UserAgent);

                if (req.HttpMethod == "GET" && path == "/description.xml")
                {
                    await ServeDeviceDescriptionAsync(context);
                }
                else if (req.HttpMethod == "GET" && path == "/ContentDirectory/description.xml")
                {
                    await ServeXmlAsync(resp, DlnaDescriptions.ContentDirectoryDescription);
                }
                else if (req.HttpMethod == "GET" && path == "/ConnectionManager/description.xml")
                {
                    await ServeXmlAsync(resp, DlnaDescriptions.ConnectionManagerDescription);
                }
                else if (req.HttpMethod == "POST" && path == "/ContentDirectory/control")
                {
                    await HandleContentDirectoryAsync(context);
                }
                else if (req.HttpMethod == "POST" && path == "/ConnectionManager/control")
                {
                    await HandleConnectionManagerAsync(context);
                }
                else if ((req.HttpMethod == "GET" || req.HttpMethod == "HEAD") && path.StartsWith("/stream/", StringComparison.OrdinalIgnoreCase))
                {
                    await StreamAudioAsync(context);
                }
                else if (req.HttpMethod == "GET" && path.StartsWith("/art/", StringComparison.OrdinalIgnoreCase))
                {
                    await ServeArtworkAsync(context);
                }
                else if (req.HttpMethod == "SUBSCRIBE" || req.HttpMethod == "UNSUBSCRIBE")
                {
                    HandleSubscribe(context);
                }
                else
                {
                    resp.StatusCode = 404;
                    resp.Close();
                }
            }
            catch (Exception ex)
            {
                log.Error(ex, "DLNA request error for {Method} {Path}", req.HttpMethod, path);
                try
                {
                    resp.StatusCode = 500;
                    resp.Close();
                }
                catch
                {
                }
            }
        }

        // ── SSDP ─────────────────────────────────────────────────────────────────
        private async Task SsdpAnnounceLoopAsync(resonance.Options.DlnaOptions options, CancellationToken ct)
        {
            // Send alive on startup, then every 15 minutes
            await Task.Delay(500, ct).ConfigureAwait(false);
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    SendSsdpAlive(options);
                }
                catch (Exception ex)
                {
                    log.Warning(ex, "DLNA SSDP announce error");
                }

                try
                {
                    await Task.Delay(TimeSpan.FromMinutes(15), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        private async Task SsdpListenLoopAsync(resonance.Options.DlnaOptions options, CancellationToken ct)
        {
            try
            {
                using var udp = new UdpClient();
                udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                udp.Client.Bind(new IPEndPoint(IPAddress.Any, SsdpPort));
                udp.JoinMulticastGroup(SsdpMulticast, IPAddress.Any);

                log.Debug("DLNA SSDP listener started");

                while (!ct.IsCancellationRequested)
                {
                    var receiveTask = udp.ReceiveAsync(ct).AsTask();
                    var cancelTask = Task.Delay(Timeout.Infinite, ct);
                    await Task.WhenAny(receiveTask, cancelTask).ConfigureAwait(false);
                    if (ct.IsCancellationRequested)
                    {
                        break;
                    }

                    var result = await receiveTask.ConfigureAwait(false);
                    var message = Encoding.UTF8.GetString(result.Buffer);

                    if (message.StartsWith("M-SEARCH", StringComparison.OrdinalIgnoreCase))
                    {
                        HandleMSearch(message, result.RemoteEndPoint, options);
                    }
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                log.Warning(ex, "DLNA SSDP listen error");
            }
        }

        private void HandleMSearch(string message, IPEndPoint remoteEndPoint, resonance.Options.DlnaOptions options)
        {
            var st = ExtractHeader(message, "ST");
            if (st == null)
            {
                return;
            }

            var responds = st == "ssdp:all"
                || st == "upnp:rootdevice"
                || st == $"uuid:{uuid}"
                || st == "urn:schemas-upnp-org:device:MediaServer:1"
                || st == "urn:schemas-upnp-org:service:ContentDirectory:1"
                || st == "urn:schemas-upnp-org:service:ConnectionManager:1";

            if (!responds)
            {
                return;
            }

            var mx = int.TryParse(ExtractHeader(message, "MX"), out var m) ? m : 1;
            var delay = new Random().Next(0, Math.Min(mx, 3) * 1000);
            _ = Task.Delay(delay).ContinueWith(_ => SendMSearchResponse(st, remoteEndPoint, options));
        }

        private void SendMSearchResponse(string st, IPEndPoint remote, resonance.Options.DlnaOptions options)
        {
            var location = $"http://{localIp}:{options.Port}/description.xml";
            var usn = st == $"uuid:{uuid}" ? $"uuid:{uuid}" : $"uuid:{uuid}::{st}";
            var response = $"HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nDATE: {DateTime.UtcNow:R}\r\nEXT:\r\nLOCATION: {location}\r\nSERVER: Linux/1.0 UPnP/1.0 Resonance/1.0\r\nST: {st}\r\nUSN: {usn}\r\n\r\n";
            try
            {
                using var udp = new UdpClient();
                var bytes = Encoding.UTF8.GetBytes(response);
                udp.Send(bytes, bytes.Length, remote);
            }
            catch (Exception ex)
            {
                log.Warning(ex, "DLNA M-SEARCH response error");
            }
        }

        private void SendSsdpAlive(resonance.Options.DlnaOptions options)
        {
            var location = $"http://{localIp}:{options.Port}/description.xml";
            SendSsdpNotify("ssdp:alive", "upnp:rootdevice", $"uuid:{uuid}::upnp:rootdevice", location);
            SendSsdpNotify("ssdp:alive", $"uuid:{uuid}", $"uuid:{uuid}", location);
            SendSsdpNotify("ssdp:alive", "urn:schemas-upnp-org:device:MediaServer:1", $"uuid:{uuid}::urn:schemas-upnp-org:device:MediaServer:1", location);
            SendSsdpNotify("ssdp:alive", "urn:schemas-upnp-org:service:ContentDirectory:1", $"uuid:{uuid}::urn:schemas-upnp-org:service:ContentDirectory:1", location);
            SendSsdpNotify("ssdp:alive", "urn:schemas-upnp-org:service:ConnectionManager:1", $"uuid:{uuid}::urn:schemas-upnp-org:service:ConnectionManager:1", location);
            log.Debug("DLNA SSDP alive sent");
        }

        private void SendSsdpByebye()
        {
            try
            {
                SendSsdpNotify("ssdp:byebye", "upnp:rootdevice", $"uuid:{uuid}::upnp:rootdevice", null);
                SendSsdpNotify("ssdp:byebye", $"uuid:{uuid}", $"uuid:{uuid}", null);
                SendSsdpNotify("ssdp:byebye", "urn:schemas-upnp-org:device:MediaServer:1", $"uuid:{uuid}::urn:schemas-upnp-org:device:MediaServer:1", null);
            }
            catch
            {
            }
        }

        private void SendSsdpNotify(string nts, string nt, string usn, string? location)
        {
            var sb = new StringBuilder();
            sb.Append("NOTIFY * HTTP/1.1\r\n");
            sb.Append($"HOST: 239.255.255.250:1900\r\n");
            sb.Append("CACHE-CONTROL: max-age=1800\r\n");
            if (location != null)
            {
                sb.Append($"LOCATION: {location}\r\n");
            }

            sb.Append($"NT: {nt}\r\n");
            sb.Append($"NTS: {nts}\r\n");
            sb.Append("SERVER: Linux/1.0 UPnP/1.0 Resonance/1.0\r\n");
            sb.Append($"USN: {usn}\r\n");
            sb.Append("\r\n");

            using var udp = new UdpClient();
            udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            var bytes = Encoding.UTF8.GetBytes(sb.ToString());
            udp.Send(bytes, bytes.Length, new IPEndPoint(SsdpMulticast, SsdpPort));
        }

        // ── HTTP handlers ─────────────────────────────────────────────────────────
        private async Task ServeDeviceDescriptionAsync(HttpListenerContext context)
        {
            var options = optionsMonitor.CurrentValue.Dlna;
            var xml = DlnaDescriptions.BuildDeviceDescription(uuid, options.FriendlyName, localIp, options.Port);
            await ServeXmlAsync(context.Response, xml);
        }

        private async Task HandleContentDirectoryAsync(HttpListenerContext context)
        {
            using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
            var body = await reader.ReadToEndAsync();
            var serverBase = BuildServerBase(context.Request);

            // Log what the TV is actually browsing
            var objectId = ExtractXmlValue(body, "ObjectID");
            var browseFlag = ExtractXmlValue(body, "BrowseFlag");
            log.Information("DLNA Browse ObjectID={ObjectID} Flag={Flag}", objectId, browseFlag);

            DlnaContentDirectory.ServeArtwork = optionsMonitor.CurrentValue.Dlna.ServeArtwork;
            var response = DlnaContentDirectory.HandleSoap(body, serverBase, musicLibrary);

            var returned = ExtractXmlValue(response, "NumberReturned");
            var total = ExtractXmlValue(response, "TotalMatches");
            log.Information("DLNA Browse response returned={Returned} total={Total}", returned, total);

            // Log full DIDL for the root browse so we can see exactly what the TV receives
            if (objectId == "0")
            {
                var result = ExtractXmlValue(response, "Result");
                log.Information("DLNA Browse(0) DIDL: {Didl}", result);
            }

            if (optionsMonitor.CurrentValue.Dlna.ServeArtwork)
            {
                _ = WarmArtworkCacheAsync(response, serverBase);
            }

            await ServeXmlAsync(context.Response, response);
        }

        private async Task StreamAudioAsync(HttpListenerContext context)
        {
            var req = context.Request;
            var resp = context.Response;
            var encoded = req.Url!.AbsolutePath["/stream/".Length..];
            var localPath = DlnaContentDirectory.DecodeSegment(encoded);
            if (localPath == null)
            {
                resp.StatusCode = 400;
                resp.Close();
                return;
            }

            long fileSize;
            try
            {
                fileSize = new FileInfo(localPath).Length;
            }
            catch
            {
                resp.StatusCode = 404;
                resp.Close();
                return;
            }

            if (!File.Exists(localPath))
            {
                resp.StatusCode = 404;
                resp.Close();
                return;
            }

            var ext = Path.GetExtension(localPath);
            resp.ContentType = DlnaContentDirectory.GetMimeType(ext);
            resp.Headers["Accept-Ranges"] = "bytes";
            resp.Headers["transferMode.dlna.org"] = "Streaming";
            resp.Headers["contentFeatures.dlna.org"] = DlnaContentDirectory.GetProtocolInfo(ext).Split(':')[3];

            long start = 0, end = fileSize - 1;
            if (req.Headers["Range"] is string range && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
            {
                var dash = range.IndexOf('-', 6);
                if (dash > 0)
                {
                    if (long.TryParse(range[6..dash], out var s))
                    {
                        start = s;
                    }

                    if (dash + 1 < range.Length && long.TryParse(range[(dash + 1)..], out var e))
                    {
                        end = e;
                    }

                    resp.StatusCode = 206;
                    resp.Headers["Content-Range"] = $"bytes {start}-{end}/{fileSize}";
                }
            }

            resp.ContentLength64 = end - start + 1;

            if (req.HttpMethod == "HEAD")
            {
                resp.Close();
                return;
            }

            await using var fs = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, useAsync: true);
            fs.Seek(start, SeekOrigin.Begin);
            var buffer = new byte[65536];
            var remaining = end - start + 1;
            while (remaining > 0)
            {
                var toRead = (int)Math.Min(buffer.Length, remaining);
                var read = await fs.ReadAsync(buffer.AsMemory(0, toRead));
                if (read == 0)
                {
                    break;
                }

                await resp.OutputStream.WriteAsync(buffer.AsMemory(0, read));
                remaining -= read;
            }

            resp.Close();
        }

        private async Task ServeArtworkAsync(HttpListenerContext context)
        {
            var resp = context.Response;
            var path = context.Request.Url!.AbsolutePath;

            // /art/img/{b64(localPath)} — standalone image file (serve as thumbnail)
            if (path.StartsWith("/art/img/", StringComparison.OrdinalIgnoreCase))
            {
                var localPath = DlnaContentDirectory.DecodeSegment(path["/art/img/".Length..]);
                if (localPath == null || !File.Exists(localPath))
                {
                    resp.StatusCode = 404;
                    resp.Close();
                    return;
                }

                if (!ArtCache.TryGetValue(localPath, out var bytes))
                {
                    var raw = await File.ReadAllBytesAsync(localPath);
                    bytes = MakeThumbnail(raw);
                    ArtCache[localPath] = bytes;
                }

                resp.ContentType = "image/jpeg";
                resp.ContentLength64 = bytes.Length;
                await resp.OutputStream.WriteAsync(bytes);
                resp.Close();
                return;
            }

            // /art/emb/{b64(localPath)} — local audio file, extract embedded art via TagLib
            if (path.StartsWith("/art/emb/", StringComparison.OrdinalIgnoreCase))
            {
                var localPath = DlnaContentDirectory.DecodeSegment(path["/art/emb/".Length..]);
                if (localPath == null || !File.Exists(localPath))
                {
                    resp.StatusCode = 404;
                    resp.Close();
                    return;
                }

                await ServeEmbeddedArtAsync(resp, localPath);
                return;
            }

            // /art/t/{b64(localPath)} — local audio file, extract embedded art
            if (path.StartsWith("/art/t/", StringComparison.OrdinalIgnoreCase))
            {
                var localPath = DlnaContentDirectory.DecodeSegment(path["/art/t/".Length..]);
                if (localPath == null || !File.Exists(localPath))
                {
                    resp.StatusCode = 404;
                    resp.Close();
                    return;
                }

                await ServeEmbeddedArtAsync(resp, localPath);
                return;
            }

            resp.StatusCode = 404;
            resp.Close();
        }

        private async Task WarmArtworkCacheAsync(string soapResponse, string serverBase)
        {
            try
            {
                var escapedDidl = ExtractXmlValue(soapResponse, "Result");
                if (string.IsNullOrEmpty(escapedDidl))
                {
                    return;
                }

                var seen = new HashSet<string>(StringComparer.Ordinal);
                var paths = new List<(string LocalPath, bool IsImage)>();

                foreach (var (route, isImage) in new[] { ("t/", false), ("emb/", false), ("img/", true) })
                {
                    var prefix = $"{serverBase}/art/{route}";
                    var idx = 0;
                    while ((idx = escapedDidl.IndexOf(prefix, idx, StringComparison.OrdinalIgnoreCase)) >= 0)
                    {
                        idx += prefix.Length;
                        var end = escapedDidl.IndexOfAny(new[] { '"', '&', '<', '>' }, idx);
                        if (end < 0)
                        {
                            break;
                        }

                        var localPath = DlnaContentDirectory.DecodeSegment(escapedDidl[idx..end]);
                        if (localPath != null && seen.Add(localPath) && !ArtCache.ContainsKey(localPath))
                        {
                            paths.Add((localPath, isImage));
                        }
                    }
                }

                if (paths.Count == 0)
                {
                    return;
                }

                log.Debug("DLNA artwork pre-warm: {Count} items", paths.Count);

                await Task.WhenAll(paths.Select(async item =>
                {
                    if (ArtCache.ContainsKey(item.LocalPath))
                    {
                        return;
                    }

                    await ArtWarmSemaphore.WaitAsync();
                    try
                    {
                        if (ArtCache.ContainsKey(item.LocalPath))
                        {
                            return;
                        }

                        if (item.IsImage)
                        {
                            if (!File.Exists(item.LocalPath))
                            {
                                return;
                            }

                            var raw = await File.ReadAllBytesAsync(item.LocalPath);
                            ArtCache[item.LocalPath] = MakeThumbnail(raw);
                        }
                        else
                        {
                            await WarmEmbeddedArtAsync(item.LocalPath);
                        }
                    }
                    catch
                    {
                    }
                    finally
                    {
                        ArtWarmSemaphore.Release();
                    }
                }));

                log.Debug("DLNA artwork pre-warm complete: {Count} items", paths.Count);
            }
            catch (Exception ex)
            {
                log.Warning(ex, "DLNA artwork pre-warm error");
            }
        }

        private void HandleSubscribe(HttpListenerContext context)
        {
            var callbackHeader = context.Request.Headers["CALLBACK"];
            var sid = $"uuid:{Guid.NewGuid()}";
            log.Information("DLNA SUBSCRIBE callback={Callback}", callbackHeader);

            context.Response.Headers["SID"] = sid;
            context.Response.Headers["TIMEOUT"] = "Second-1800";
            context.Response.StatusCode = 200;
            context.Response.Close();

            // UPnP requires the server to immediately send an initial event NOTIFY to the callback URL.
            // Google TV and many other clients wait for this before they start browsing.
            var callbackUrl = ParseCallbackUrl(callbackHeader);
            if (callbackUrl != null)
            {
                _ = SendEventNotifyAsync(callbackUrl, sid);
            }
        }

        private async Task SendEventNotifyAsync(string callbackUrl, string sid)
        {
            var body = $"""
                <?xml version="1.0"?>
                <e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">
                  <e:property><SystemUpdateID>{SystemUpdateId}</SystemUpdateID></e:property>
                  <e:property><ContainerUpdateIDs></ContainerUpdateIDs></e:property>
                </e:propertyset>
                """;

            try
            {
                var bytes = Encoding.UTF8.GetBytes(body);
                using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                using var req = new System.Net.Http.HttpRequestMessage(new System.Net.Http.HttpMethod("NOTIFY"), callbackUrl);
                req.Headers.TryAddWithoutValidation("NT", "upnp:event");
                req.Headers.TryAddWithoutValidation("NTS", "upnp:propchange");
                req.Headers.TryAddWithoutValidation("SID", sid);
                req.Headers.TryAddWithoutValidation("SEQ", "0");
                req.Content = new System.Net.Http.ByteArrayContent(bytes);
                req.Content.Headers.TryAddWithoutValidation("Content-Type", "text/xml; charset=\"utf-8\"");
                await client.SendAsync(req);
                log.Debug("DLNA event NOTIFY sent to {Url}", callbackUrl);
            }
            catch (Exception ex)
            {
                log.Warning(ex, "DLNA event NOTIFY failed for {Url}", callbackUrl);
            }
        }

        private string BuildServerBase(HttpListenerRequest req)
        {
            var port = optionsMonitor.CurrentValue.Dlna.Port;
            var addr = req.LocalEndPoint?.Address;
            if (addr != null && addr.IsIPv4MappedToIPv6)
            {
                addr = addr.MapToIPv4();
            }

            var ip = addr?.ToString() ?? localIp;
            if (ip == "0.0.0.0" || ip == "::" || ip == "127.0.0.1")
            {
                ip = localIp;
            }

            return $"http://{ip}:{port}";
        }

        private async Task HandleConnectionManagerAsync(HttpListenerContext context)
        {
            using var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8);
            var body = await reader.ReadToEndAsync();
            string? action = null;
            try
            {
                action = System.Xml.Linq.XDocument.Parse(body).Descendants()
                    .FirstOrDefault(e => e.Parent?.Name.LocalName == "Body")?.Name.LocalName;
            }
            catch
            {
            }

            log.Information("DLNA ConnectionManager action: {Action}", action ?? "(unknown)");

            var response = action switch
            {
                "GetProtocolInfo" => ConnectionManagerResponse(),
                "GetCurrentConnectionIDs" => ConnectionIdsResponse(),
                "GetCurrentConnectionInfo" => ConnectionInfoResponse(),
                _ => ConnectionManagerResponse(),
            };
            await ServeXmlAsync(context.Response, response);
        }
    }
}
