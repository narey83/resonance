// <copyright file="DiscogsClient.cs" company="John Narey">
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
    using System.Linq;
    using System.Net.Http;
    using System.Reflection;
    using System.Text.Json;
    using System.Threading;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Options;
    using Serilog;

    /// <summary>
    ///     A client for the Discogs database, used to look up release metadata (album, year and —
    ///     crucially for electronic music — Style/genre) for a track. Discogs has far deeper coverage
    ///     of vinyl, white-labels and underground/electronic releases than MusicBrainz.
    /// </summary>
    /// <remarks>
    ///     Requires a free personal access token (discogs.com → Settings → Developers) and a descriptive
    ///     User-Agent. The authenticated rate limit is 60 requests/minute; requests are paced to
    ///     <c>MetadataLookup.RateLimitPerSecond</c>.
    /// </remarks>
    public class DiscogsClient
    {
        public DiscogsClient(IHttpClientFactory httpClientFactory, IOptionsMonitor<resonance.Options> optionsMonitor)
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
        ///     Searches Discogs for releases matching the supplied artist and title (and optionally
        ///     album), returning candidates ordered by confidence (highest first). The track title and
        ///     artist from the query are preserved; Discogs supplies album, year and genre/style.
        /// </summary>
        /// <returns>The candidate matches, best first.</returns>
        public async Task<IReadOnlyList<MetadataMatch>> SearchAsync(string artist, string title, string album, int limit, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return Array.Empty<MetadataMatch>();
            }

            var query = new List<string>
            {
                $"track={Uri.EscapeDataString(title)}",
                "type=release",
                $"per_page={Math.Clamp(limit, 1, 25)}",
            };

            if (!string.IsNullOrWhiteSpace(artist))
            {
                query.Add($"artist={Uri.EscapeDataString(artist)}");
            }

            if (!string.IsNullOrWhiteSpace(album))
            {
                query.Add($"release_title={Uri.EscapeDataString(album)}");
            }

            using var doc = await GetJsonAsync($"database/search?{string.Join("&", query)}", ct);
            return doc == null ? Array.Empty<MetadataMatch>() : ParseSearchResponse(doc.RootElement, artist, title, album);
        }

        /// <summary>
        ///     Parses a Discogs search JSON response into ordered candidates. Exposed for testing the
        ///     projection logic without a network request.
        /// </summary>
        /// <returns>The candidate matches, best first.</returns>
        public static IReadOnlyList<MetadataMatch> ParseSearchResponse(string json, string queryArtist, string queryTitle, string queryAlbum)
        {
            using var doc = JsonDocument.Parse(json);
            return ParseSearchResponse(doc.RootElement, queryArtist, queryTitle, queryAlbum);
        }

        private static IReadOnlyList<MetadataMatch> ParseSearchResponse(JsonElement root, string queryArtist, string queryTitle, string queryAlbum)
        {
            if (!root.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<MetadataMatch>();
            }

            var matches = new List<MetadataMatch>();
            foreach (var result in results.EnumerateArray())
            {
                var match = ProjectResult(result, queryArtist, queryTitle, queryAlbum);
                if (match != null)
                {
                    matches.Add(match);
                }
            }

            return matches
                .OrderByDescending(m => m.Score)
                .ToList();
        }

        private static MetadataMatch ProjectResult(JsonElement result, string queryArtist, string queryTitle, string queryAlbum)
        {
            // Discogs search returns releases titled "Artist - Release Title"
            var releaseTitle = GetString(result, "title");
            if (string.IsNullOrWhiteSpace(releaseTitle))
            {
                return null;
            }

            string artist = null;
            var album = releaseTitle;
            var separator = releaseTitle.IndexOf(" - ", StringComparison.Ordinal);
            if (separator > 0)
            {
                artist = releaseTitle[..separator].Trim();
                album = releaseTitle[(separator + 3)..].Trim();
            }

            var year = ParseYear(GetString(result, "year"));
            var genre = PickGenre(result);
            var score = Confidence(releaseTitle, artist, queryArtist, album, queryAlbum);

            var resolvedArtist = string.IsNullOrWhiteSpace(artist) ? queryArtist : artist;

            return new MetadataMatch(
                Title: queryTitle, // release search has no track title — keep the track's own title
                Artist: resolvedArtist,
                Album: album,
                AlbumArtist: resolvedArtist,
                Year: year,
                TrackNumber: 0,
                DiscNumber: 0,
                Genre: genre,
                Score: score,
                RecordingMbid: null,
                Source: "Discogs");
        }

        private static string PickGenre(JsonElement result)
        {
            // prefer the specific "style" (e.g. Techno, Tech House) over the broad "genre" (Electronic)
            var style = FirstOf(result, "styles") ?? FirstOf(result, "style");
            if (!string.IsNullOrWhiteSpace(style))
            {
                return style;
            }

            return FirstOf(result, "genres") ?? FirstOf(result, "genre");
        }

        private static string FirstOf(JsonElement element, string property)
        {
            if (element.TryGetProperty(property, out var array) && array.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in array.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var value = item.GetString();
                        if (!string.IsNullOrWhiteSpace(value))
                        {
                            return value;
                        }
                    }
                }
            }

            return null;
        }

        private static int Confidence(string releaseTitle, string parsedArtist, string queryArtist, string parsedAlbum, string queryAlbum)
        {
            // Discogs already filters by artist+track, so any result is fairly confident; bump it when
            // the artist/album corroborate the query.
            var score = 90;

            if (!string.IsNullOrWhiteSpace(queryArtist)
                && (Contains(releaseTitle, queryArtist) || Contains(parsedArtist, queryArtist) || Contains(queryArtist, parsedArtist)))
            {
                score += 5;
            }

            if (!string.IsNullOrWhiteSpace(queryAlbum) && Contains(parsedAlbum, queryAlbum))
            {
                score += 5;
            }

            return Math.Min(score, 100);
        }

        private static bool Contains(string haystack, string needle)
            => !string.IsNullOrWhiteSpace(haystack) && !string.IsNullOrWhiteSpace(needle)
                && haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

        private static uint ParseYear(string year)
            => !string.IsNullOrWhiteSpace(year) && year.Length >= 4 && uint.TryParse(year.AsSpan(0, 4), out var value) ? value : 0;

        private static string GetString(JsonElement element, string property)
            => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        private async Task<JsonDocument> GetJsonAsync(string relativeUrl, CancellationToken ct)
        {
            var opts = Options.CurrentValue.MetadataLookup;
            if (string.IsNullOrWhiteSpace(opts.Discogs.Token))
            {
                return null;
            }

            await PaceAsync(ct);

            try
            {
                using var client = HttpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(30);

                // Discogs wants a "AppName/version +contact" User-Agent. The "+contact" form isn't valid
                // per RFC, so the typed UserAgent.ParseAdd throws on it — add it without validation.
                client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", BuildUserAgent(opts.Contact));

                var separator = relativeUrl.Contains('?') ? "&" : "?";
                var url = $"https://api.discogs.com/{relativeUrl}{separator}token={Uri.EscapeDataString(opts.Discogs.Token)}";

                using var response = await client.GetAsync(url, ct);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Debug("Discogs request returned {Status}", (int)response.StatusCode);
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
                Log.Debug("Discogs request failed: {Error}", ex.Message);
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

        private static string BuildUserAgent(string contact)
        {
            var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0";
            var contactPart = string.IsNullOrWhiteSpace(contact) ? "https://github.com/narey83/resonance" : contact.Trim();
            return $"resonance/{version} +{contactPart}";
        }
    }
}
