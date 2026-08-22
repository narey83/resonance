// <copyright file="LinkPreviewController.cs" company="John Narey">
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

namespace resonance.LinkPreview.API.Controllers
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Net;
    using System.Net.Http;
    using System.Text;
    using System.Text.RegularExpressions;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Caching.Memory;

    /// <summary>
    ///     Fetches an outside page's HTML server-side and scrapes just enough of it (title, description,
    ///     image) to render a WhatsApp-style link preview card in chat, without the frontend making a
    ///     cross-origin request the browser would refuse anyway.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Authorize(Policy = AuthPolicy.FeatureMessaging)]
    public class LinkPreviewController : ControllerBase
    {
        private const string HttpClientName = "LinkPreview";

        // Meta/title tags live near the top of <head>; capping the read means a huge or slow-streaming
        // page can't tie up the request or bloat memory just to answer "what's the title".
        private const int MaxBytes = 512 * 1_024;

        private static readonly MemoryCache Cache = new(new MemoryCacheOptions());
        private static readonly TimeSpan HitTtl = TimeSpan.FromHours(6);
        private static readonly TimeSpan MissTtl = TimeSpan.FromMinutes(5);

        private static readonly Regex MetaTagRegex = new(@"<meta\s[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex TitleTagRegex = new(@"<title[^>]*>([\s\S]*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex AttrRegex = new(@"([\w:-]+)\s*=\s*(?:""([^""]*)""|'([^']*)')", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public LinkPreviewController(IHttpClientFactory httpClientFactory)
        {
            HttpClientFactory = httpClientFactory;
        }

        private IHttpClientFactory HttpClientFactory { get; }

        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any)]
        public async Task<IActionResult> Get([FromQuery] string url)
        {
            if (string.IsNullOrWhiteSpace(url) ||
                !Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                return BadRequest("url must be an absolute http(s) URL");
            }

            var hostType = Uri.CheckHostName(uri.Host);
            if ((hostType == UriHostNameType.IPv4 || hostType == UriHostNameType.IPv6) &&
                IPAddress.TryParse(uri.Host, out var literal) && SsrfGuard.IsBlocked(literal))
            {
                return BadRequest("that address can't be previewed");
            }

            var cacheKey = uri.ToString();
            if (Cache.TryGetValue(cacheKey, out LinkPreviewResponse cached))
            {
                return cached is null ? NotFound() : Ok(cached);
            }

            LinkPreviewResponse preview;

            try
            {
                preview = await FetchPreview(uri);
            }
            catch
            {
                preview = null;
            }

            // Cache misses too (a broken/slow/non-HTML link), just for less long, so a message that
            // stays on screen doesn't re-trigger the fetch on every poll tick.
            Cache.Set(cacheKey, preview, preview is null ? MissTtl : HitTtl);
            return preview is null ? NotFound() : Ok(preview);
        }

        private static async Task<string> ReadCapped(HttpResponseMessage response, int maxBytes)
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            var buffer = new byte[maxBytes];
            var totalRead = 0;
            int read;

            while (totalRead < buffer.Length &&
                   (read = await stream.ReadAsync(buffer.AsMemory(totalRead, buffer.Length - totalRead))) > 0)
            {
                totalRead += read;
            }

            return Encoding.UTF8.GetString(buffer, 0, totalRead);
        }

        private static Dictionary<string, string> ParseAttributes(string tag)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (Match match in AttrRegex.Matches(tag))
            {
                var value = match.Groups[2].Success ? match.Groups[2].Value : match.Groups[3].Value;
                result[match.Groups[1].Value] = value;
            }

            return result;
        }

        private static string Truncate(string value, int max) =>
            string.IsNullOrEmpty(value) || value.Length <= max ? value : value[..max];

        private async Task<LinkPreviewResponse> FetchPreview(Uri uri)
        {
            using var http = HttpClientFactory.CreateClient(HttpClientName);
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);

            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (contentType is not null && !contentType.Contains("html", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var html = await ReadCapped(response, MaxBytes);

            var tags = MetaTagRegex.Matches(html).Select(m => ParseAttributes(m.Value)).ToList();

            string MetaContent(params string[] keys)
            {
                foreach (var key in keys)
                {
                    var tag = tags.FirstOrDefault(a =>
                        string.Equals(a.GetValueOrDefault("property"), key, StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a.GetValueOrDefault("name"), key, StringComparison.OrdinalIgnoreCase));

                    if (tag is not null && tag.TryGetValue("content", out var content) && !string.IsNullOrWhiteSpace(content))
                    {
                        return WebUtility.HtmlDecode(content).Trim();
                    }
                }

                return null;
            }

            var titleMatch = TitleTagRegex.Match(html);
            var title = MetaContent("og:title", "twitter:title")
                ?? (titleMatch.Success ? WebUtility.HtmlDecode(titleMatch.Groups[1].Value).Trim() : null);
            var description = MetaContent("og:description", "twitter:description", "description");
            var image = MetaContent("og:image", "twitter:image");
            var siteName = MetaContent("og:site_name");

            if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(description) && string.IsNullOrWhiteSpace(image))
            {
                return null;
            }

            string absoluteImage = null;
            if (!string.IsNullOrWhiteSpace(image) &&
                Uri.TryCreate(uri, image, out var imageUri) &&
                (imageUri.Scheme == Uri.UriSchemeHttp || imageUri.Scheme == Uri.UriSchemeHttps))
            {
                absoluteImage = imageUri.ToString();
            }

            return new LinkPreviewResponse
            {
                Url = uri.ToString(),
                Title = Truncate(title, 200),
                Description = Truncate(description, 400),
                ImageUrl = absoluteImage,
                SiteName = Truncate(siteName, 100),
            };
        }
    }
}
