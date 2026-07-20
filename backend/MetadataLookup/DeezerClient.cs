// <copyright file="DeezerClient.cs" company="John Narey">
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

namespace resonance.MetadataLookup
{
    using System;
    using System.Linq;
    using System.Net.Http;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Options;
    using Serilog;

    /// <summary>
    ///     A client for the Deezer API. No authentication required. Used as a no-setup fallback that
    ///     supplies release year (from the album) and a broad genre, plus album/track number.
    /// </summary>
    public class DeezerClient
    {
        public DeezerClient(IHttpClientFactory httpClientFactory, IOptionsMonitor<resonance.Options> optionsMonitor)
        {
            HttpClientFactory = httpClientFactory;
            Options = optionsMonitor;
        }

        private IHttpClientFactory HttpClientFactory { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Metadata);
        private SemaphoreSlim PacingGate { get; } = new(1, 1);
        private DateTime LastRequestUtc { get; set; } = DateTime.MinValue;

        /// <summary>
        ///     Parses a Deezer album JSON response for its genre. Exposed for testing.
        /// </summary>
        /// <returns>The genre, or null.</returns>
        public static string ParseAlbumGenre(string json)
        {
            using var doc = JsonDocument.Parse(json);
            return PickGenre(doc.RootElement);
        }

        /// <summary>
        ///     Searches Deezer for a track, then resolves its album for year and genre. The track title
        ///     and artist from the query are preserved. Returns null when no match.
        /// </summary>
        /// <returns>The match, or null.</returns>
        public async Task<MetadataMatch> SearchAsync(string artist, string title, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return null;
            }

            var q = string.IsNullOrWhiteSpace(artist) ? $"track:\"{title}\"" : $"artist:\"{artist}\" track:\"{title}\"";
            using var searchDoc = await GetJsonAsync($"search?q={Uri.EscapeDataString(q)}&limit=3", ct);
            if (searchDoc == null
                || !searchDoc.RootElement.TryGetProperty("data", out var data)
                || data.ValueKind != JsonValueKind.Array
                || data.GetArrayLength() == 0)
            {
                return null;
            }

            var top = data.EnumerateArray().First();
            var resolvedArtist = GetString(top, "artist", "name") ?? artist;
            var albumElement = top.TryGetProperty("album", out var al) && al.ValueKind == JsonValueKind.Object ? al : default;
            var albumTitle = GetString(albumElement, "title");
            var albumId = albumElement.ValueKind == JsonValueKind.Object && albumElement.TryGetProperty("id", out var id) && id.TryGetInt64(out var albumIdValue)
                ? albumIdValue
                : 0;

            uint year = 0;
            string genre = null;

            // a second request resolves the album for its release date and genre
            if (albumId != 0)
            {
                using var albumDoc = await GetJsonAsync($"album/{albumId}", ct);
                if (albumDoc != null)
                {
                    year = ParseYear(GetString(albumDoc.RootElement, "release_date"));
                    genre = PickGenre(albumDoc.RootElement);
                }
            }

            return new MetadataMatch(
                Title: title,
                Artist: resolvedArtist,
                Album: albumTitle,
                AlbumArtist: resolvedArtist,
                Year: year,
                TrackNumber: 0,
                DiscNumber: 0,
                Genre: genre,
                Score: Confidence(resolvedArtist, artist),
                RecordingMbid: null,
                Source: "Deezer");
        }

        private static string PickGenre(JsonElement album)
        {
            if (album.TryGetProperty("genres", out var genres) && genres.ValueKind == JsonValueKind.Object
                && genres.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                foreach (var genre in data.EnumerateArray())
                {
                    var name = GetString(genre, "name");
                    if (!string.IsNullOrWhiteSpace(name))
                    {
                        return name;
                    }
                }
            }

            return null;
        }

        private static int Confidence(string artist, string queryArtist)
        {
            if (string.IsNullOrWhiteSpace(queryArtist) || string.IsNullOrWhiteSpace(artist))
            {
                return 88;
            }

            return artist.Contains(queryArtist, StringComparison.OrdinalIgnoreCase)
                || queryArtist.Contains(artist, StringComparison.OrdinalIgnoreCase)
                ? 95
                : 80;
        }

        private static uint ParseYear(string date)
            => !string.IsNullOrWhiteSpace(date) && date.Length >= 4 && uint.TryParse(date.AsSpan(0, 4), out var year) ? year : 0;

        private static string GetString(JsonElement element, string property)
            => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        private static string GetString(JsonElement element, string property, string childProperty)
            => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var child) && child.ValueKind == JsonValueKind.Object
                ? GetString(child, childProperty)
                : null;

        private async Task<JsonDocument> GetJsonAsync(string relativeUrl, CancellationToken ct)
        {
            await PaceAsync(ct);

            try
            {
                using var client = HttpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(30);
                client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "resonance");

                using var response = await client.GetAsync($"https://api.deezer.com/{relativeUrl}", ct);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Debug("Deezer request returned {Status}", (int)response.StatusCode);
                    return null;
                }

                var json = await response.Content.ReadAsStringAsync(ct);
                return JsonDocument.Parse(json);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                Log.Debug("Deezer request failed: {Error}", ex.Message);
                return null;
            }
        }

        private async Task PaceAsync(CancellationToken ct)
        {
            var rate = Math.Max(0.1, Options.CurrentValue.MetadataLookup.RateLimitPerSecond);
            var minInterval = TimeSpan.FromSeconds(1.0 / rate);

            await PacingGate.WaitAsync(ct);
            try
            {
                var elapsed = DateTime.UtcNow - LastRequestUtc;
                if (elapsed < minInterval)
                {
                    await Task.Delay(minInterval - elapsed, ct);
                }

                LastRequestUtc = DateTime.UtcNow;
            }
            finally
            {
                PacingGate.Release();
            }
        }
    }
}
