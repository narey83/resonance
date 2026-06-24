// <copyright file="LastfmClient.cs" company="John Narey">
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
    using System.Collections.Generic;
    using System.Net.Http;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Options;
    using Serilog;

    /// <summary>
    ///     A client for the Last.fm API, used mainly as a genre source — its community "tags" cover the
    ///     long tail of obscure/electronic tracks that curated databases miss. Also yields album and,
    ///     when present, track number. Last.fm does not provide a release year.
    /// </summary>
    /// <remarks>Requires a free API key (last.fm/api/account/create).</remarks>
    public class LastfmClient
    {
        // common Last.fm tags that aren't genres — skipped when picking a genre
        private static readonly HashSet<string> NonGenreTags = new(StringComparer.OrdinalIgnoreCase)
        {
            "seen live", "favorites", "favourites", "spotify", "owned", "vinyl", "cd", "beautiful",
            "love", "favorite", "favourite", "00s", "10s", "80s", "90s", "70s", "60s", "british",
            "american", "usa", "uk", "male vocalists", "female vocalists", "under 2000 listeners",
            "albums i own", "awesome", "good", "best", "amazing", "cool", "songs", "music",
        };

        public LastfmClient(IHttpClientFactory httpClientFactory, IOptionsMonitor<resonance.Options> optionsMonitor)
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
        ///     Looks up a track on Last.fm and projects it to a match (genre/album/track number; the
        ///     track title and artist from the query are preserved). Returns null when no match.
        /// </summary>
        /// <returns>The match, or null.</returns>
        public async Task<MetadataMatch> SearchAsync(string artist, string title, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(artist) || string.IsNullOrWhiteSpace(title))
            {
                return null;
            }

            var url = $"?method=track.getInfo&api_key={Uri.EscapeDataString(Options.CurrentValue.MetadataLookup.Lastfm.ApiKey ?? string.Empty)}"
                + $"&artist={Uri.EscapeDataString(artist)}&track={Uri.EscapeDataString(title)}&autocorrect=1&format=json";

            using var doc = await GetJsonAsync(url, ct);
            return doc == null ? null : ParseTrackInfo(doc.RootElement, artist, title);
        }

        /// <summary>
        ///     Parses a Last.fm <c>track.getInfo</c> JSON response into a match. Exposed for testing.
        /// </summary>
        /// <returns>The match, or null.</returns>
        public static MetadataMatch ParseTrackInfo(string json, string queryArtist, string queryTitle)
        {
            using var doc = JsonDocument.Parse(json);
            return ParseTrackInfo(doc.RootElement, queryArtist, queryTitle);
        }

        private static MetadataMatch ParseTrackInfo(JsonElement root, string queryArtist, string queryTitle)
        {
            if (!root.TryGetProperty("track", out var track) || track.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var artist = GetString(track, "artist", "name") ?? queryArtist;

            string album = null;
            uint trackNumber = 0;
            if (track.TryGetProperty("album", out var albumElement) && albumElement.ValueKind == JsonValueKind.Object)
            {
                album = GetString(albumElement, "title");
                if (albumElement.TryGetProperty("@attr", out var attr) && attr.ValueKind == JsonValueKind.Object
                    && attr.TryGetProperty("position", out var pos) && uint.TryParse(pos.GetString(), out var position))
                {
                    trackNumber = position;
                }
            }

            var genre = PickTopTag(track);
            var score = Confidence(artist, queryArtist);

            return new MetadataMatch(
                Title: queryTitle, // keep the track's own title
                Artist: artist,
                Album: album,
                AlbumArtist: artist,
                Year: 0, // Last.fm does not expose a release year
                TrackNumber: trackNumber,
                DiscNumber: 0,
                Genre: genre,
                Score: score,
                RecordingMbid: null,
                Source: "Last.fm");
        }

        private static string PickTopTag(JsonElement track)
        {
            if (!track.TryGetProperty("toptags", out var toptags) || toptags.ValueKind != JsonValueKind.Object
                || !toptags.TryGetProperty("tag", out var tags) || tags.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            // tags are ordered by popularity; take the first that looks like a genre
            foreach (var tag in tags.EnumerateArray())
            {
                var name = GetString(tag, "name");
                if (!string.IsNullOrWhiteSpace(name) && !NonGenreTags.Contains(name))
                {
                    return Capitalize(name);
                }
            }

            return null;
        }

        private static int Confidence(string artist, string queryArtist)
        {
            if (string.IsNullOrWhiteSpace(queryArtist) || string.IsNullOrWhiteSpace(artist))
            {
                return 80;
            }

            return artist.Contains(queryArtist, StringComparison.OrdinalIgnoreCase)
                || queryArtist.Contains(artist, StringComparison.OrdinalIgnoreCase)
                ? 92
                : 80;
        }

        private static string Capitalize(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return value;
            }

            return char.ToUpperInvariant(value[0]) + value[1..];
        }

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
            if (string.IsNullOrWhiteSpace(Options.CurrentValue.MetadataLookup.Lastfm.ApiKey))
            {
                return null;
            }

            await PaceAsync(ct);

            try
            {
                using var client = HttpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(30);
                client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "resonance");

                using var response = await client.GetAsync($"https://ws.audioscrobbler.com/2.0/{relativeUrl}", ct);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Debug("Last.fm request returned {Status}", (int)response.StatusCode);
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
                Log.Debug("Last.fm request failed: {Error}", ex.Message);
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
