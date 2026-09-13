// <copyright file="GitHub.cs" company="JP Dillingham">
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

namespace resonance
{
    using System;
    using System.IO;
    using System.Net.Http;
    using System.Net.Http.Headers;
    using System.Net.Http.Json;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;

    public static class GitHub
    {
        public static async Task<Version> GetLatestReleaseVersion(string organization, string repository, string userAgent, string token = null)
        {
            var url = $"https://api.github.com/repos/{organization}/{repository}/releases/latest";

            try
            {
                using var http = new HttpClient();
                http.DefaultRequestHeaders.UserAgent.TryParseAdd(userAgent);
                http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

                // A private repository answers an anonymous caller with 404 rather than 403, so a missing
                // or expired token looks exactly like a repository that has never cut a release.
                if (!string.IsNullOrWhiteSpace(token))
                {
                    http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                }

                var response = await http.GetFromJsonAsync<JsonDocument>(url);

                // Tags are bare semantic versions ('0.1.0'), not 'v0.1.0': Version.Parse rejects the prefix.
                return Version.Parse(response.RootElement.GetProperty("tag_name").GetString());
            }
            catch (Exception ex)
            {
                throw new GitHubException($"Failed to retrieve latest release version from GitHub: {ex.Message}", ex);
            }
        }

        /// <summary>
        ///     Finds an asset attached to the latest release whose name satisfies <paramref name="predicate"/>.
        /// </summary>
        /// <returns>The asset's name and API url, or null when the release has no matching asset.</returns>
        public static async Task<(string Name, string Url)?> GetLatestReleaseAsset(string organization, string repository, string userAgent, Func<string, bool> predicate, string token = null)
        {
            var url = $"https://api.github.com/repos/{organization}/{repository}/releases/latest";

            try
            {
                using var http = Client(userAgent, token);

                var response = await http.GetFromJsonAsync<JsonDocument>(url);

                foreach (var asset in response.RootElement.GetProperty("assets").EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString();

                    if (predicate(name))
                    {
                        // The API url, not browser_download_url: only the former accepts a token, and a
                        // private repository's browser url is a login page rather than a file.
                        return (name, asset.GetProperty("url").GetString());
                    }
                }

                return null;
            }
            catch (Exception ex)
            {
                throw new GitHubException($"Failed to retrieve release assets from GitHub: {ex.Message}", ex);
            }
        }

        /// <summary>
        ///     Opens a stream over a release asset.
        /// </summary>
        /// <remarks>
        ///     The caller owns the stream and the response it belongs to; it is left open deliberately so
        ///     the bytes can be piped onward without being buffered here first.
        /// </remarks>
        /// <returns>The asset's content stream, and its length when the server reported one.</returns>
        public static async Task<(Stream Stream, long? Length)> DownloadAssetAsync(string assetUrl, string userAgent, string token = null, CancellationToken cancellationToken = default)
        {
            var http = Client(userAgent, token);

            // octet-stream is what turns the asset endpoint from metadata into the file itself.
            http.DefaultRequestHeaders.Accept.Clear();
            http.DefaultRequestHeaders.Accept.ParseAdd("application/octet-stream");

            var response = await http.GetAsync(assetUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            var length = response.Content.Headers.ContentLength;
            var stream = await response.Content.ReadAsStreamAsync(cancellationToken);

            return (stream, length);
        }

        private static HttpClient Client(string userAgent, string token)
        {
            var http = new HttpClient();
            http.DefaultRequestHeaders.UserAgent.TryParseAdd(userAgent);
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            if (!string.IsNullOrWhiteSpace(token))
            {
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }

            return http;
        }
    }
}
