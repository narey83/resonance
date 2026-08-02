// <copyright file="MusicBrainzClient.cs" company="John Narey">
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
    ///     A thin client for the MusicBrainz web service, used to look up release metadata
    ///     (title, artist, album, year, track/disc numbers and genre) for a track.
    /// </summary>
    /// <remarks>
    ///     MusicBrainz requires a descriptive User-Agent and limits the public API to ~1 request per
    ///     second. Requests are paced internally according to <c>MetadataLookup.RateLimitPerSecond</c>;
    ///     point <c>MetadataLookup.BaseUrl</c> at a self-hosted mirror to lift the limit.
    /// </remarks>
    public class MusicBrainzClient
    {
        // a light blocklist of common non-genre community tags, used only when no curated genre exists
        private static readonly HashSet<string> NonGenreTags = new(StringComparer.OrdinalIgnoreCase)
        {
            "seen live", "favorites", "favourites", "spotify", "owned", "albums i own",
            "vinyl", "cd", "beautiful", "love", "favorite", "favourite", "00s", "10s",
            "80s", "90s", "70s", "60s", "british", "american", "usa", "uk", "male vocalists",
            "female vocalists", "under 2000 listeners",
        };

        public MusicBrainzClient(IHttpClientFactory httpClientFactory, IOptionsMonitor<resonance.Options> optionsMonitor)
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
        ///     Parses a MusicBrainz recording-search JSON response into ordered candidates. Exposed for
        ///     testing the projection logic without making a network request.
        /// </summary>
        /// <returns>The candidate matches, best first.</returns>
        public static IReadOnlyList<MetadataMatch> ParseSearchResponse(string json, string? preferredAlbum)
        {
            using var doc = JsonDocument.Parse(json);
            return ParseRecordings(doc.RootElement, preferredAlbum);
        }

        /// <summary>
        ///     Parses a genre out of a MusicBrainz recording-lookup JSON response. Exposed for testing
        ///     the genre fallback chain without making a network request.
        /// </summary>
        /// <returns>The resolved genre, or null.</returns>
        public static string ParseGenre(string json)
        {
            using var doc = JsonDocument.Parse(json);
            return ParseGenreFromRecording(doc.RootElement);
        }

        /// <summary>
        ///     Searches MusicBrainz for recordings matching the supplied <paramref name="artist"/> and
        ///     <paramref name="title"/> (and optionally <paramref name="album"/>), returning the best
        ///     candidates ordered by score (highest first). Genre is not populated here; use
        ///     <see cref="ResolveGenreAsync"/> for the chosen candidate.
        /// </summary>
        /// <returns>The candidate matches, best first.</returns>
        public async Task<IReadOnlyList<MetadataMatch>> SearchRecordingsAsync(string artist, string title, string album, int limit, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(title))
            {
                return Array.Empty<MetadataMatch>();
            }

            var queryParts = new List<string> { $"recording:{Escape(title)}" };
            if (!string.IsNullOrWhiteSpace(artist))
            {
                queryParts.Add($"artist:{Escape(artist)}");
            }

            if (!string.IsNullOrWhiteSpace(album))
            {
                queryParts.Add($"release:{Escape(album)}");
            }

            var query = string.Join(" AND ", queryParts);
            var url = $"recording/?query={Uri.EscapeDataString(query)}&fmt=json&limit={Math.Clamp(limit, 1, 25)}";

            using var doc = await GetJsonAsync(url, ct);
            return doc == null ? Array.Empty<MetadataMatch>() : ParseRecordings(doc.RootElement, album);
        }

        /// <summary>
        ///     Resolves a genre for the specified recording by walking the curated genre lists
        ///     (recording → release → release-group → artist) and falling back to community tags.
        ///     Returns null when no plausible genre can be found.
        /// </summary>
        /// <returns>The resolved genre, or null.</returns>
        public async Task<string> ResolveGenreAsync(string recordingMbid, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(recordingMbid))
            {
                return null;
            }

            var url = $"recording/{recordingMbid}?fmt=json&inc=artists+releases+release-groups+genres+tags";

            using var doc = await GetJsonAsync(url, ct);
            return doc == null ? null : ParseGenreFromRecording(doc.RootElement);
        }

        private static IReadOnlyList<MetadataMatch> ParseRecordings(JsonElement root, string preferredAlbum)
        {
            if (!root.TryGetProperty("recordings", out var recordings) || recordings.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<MetadataMatch>();
            }

            var results = new List<MetadataMatch>();
            foreach (var rec in recordings.EnumerateArray())
            {
                var match = ProjectRecording(rec, preferredAlbum);
                if (match != null)
                {
                    results.Add(match);
                }
            }

            return results
                .OrderByDescending(r => r.Score)
                .ToList();
        }

        private static string ParseGenreFromRecording(JsonElement root)
        {
            // collect curated genres in priority order, then community tags as a fallback
            var genreLevels = new List<JsonElement>();
            var tagLevels = new List<JsonElement>();

            void Collect(JsonElement element)
            {
                if (element.TryGetProperty("genres", out var g) && g.ValueKind == JsonValueKind.Array)
                {
                    genreLevels.Add(g);
                }

                if (element.TryGetProperty("tags", out var t) && t.ValueKind == JsonValueKind.Array)
                {
                    tagLevels.Add(t);
                }
            }

            Collect(root);

            if (root.TryGetProperty("releases", out var releases) && releases.ValueKind == JsonValueKind.Array)
            {
                foreach (var release in releases.EnumerateArray())
                {
                    Collect(release);
                    if (release.TryGetProperty("release-group", out var rg) && rg.ValueKind == JsonValueKind.Object)
                    {
                        Collect(rg);
                    }
                }
            }

            if (root.TryGetProperty("artist-credit", out var credits) && credits.ValueKind == JsonValueKind.Array)
            {
                foreach (var credit in credits.EnumerateArray())
                {
                    if (credit.TryGetProperty("artist", out var artist) && artist.ValueKind == JsonValueKind.Object)
                    {
                        Collect(artist);
                    }
                }
            }

            foreach (var level in genreLevels)
            {
                var name = PickTopName(level, filterNonGenre: false);
                if (name != null)
                {
                    return Capitalize(name);
                }
            }

            foreach (var level in tagLevels)
            {
                var name = PickTopName(level, filterNonGenre: true);
                if (name != null)
                {
                    return Capitalize(name);
                }
            }

            return null;
        }

        private static string Escape(string value)
            => "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static MetadataMatch ProjectRecording(JsonElement rec, string preferredAlbum)
        {
            var title = GetString(rec, "title");
            if (string.IsNullOrWhiteSpace(title))
            {
                return null;
            }

            var score = rec.TryGetProperty("score", out var s) && s.TryGetInt32(out var scoreValue) ? scoreValue : 0;
            var mbid = GetString(rec, "id");
            var artist = JoinArtistCredit(rec);

            string album = null;
            string albumArtist = null;
            uint year = 0;
            uint trackNumber = 0;
            uint discNumber = 0;

            if (rec.TryGetProperty("releases", out var releases) && releases.ValueKind == JsonValueKind.Array && releases.GetArrayLength() > 0)
            {
                var release = PickRelease(releases, preferredAlbum);
                album = GetString(release, "title");
                albumArtist = JoinArtistCredit(release);
                year = ParseYear(GetString(release, "date"));
                (trackNumber, discNumber) = ParseTrackPosition(release);
            }

            return new MetadataMatch(
                Title: title,
                Artist: artist,
                Album: album,
                AlbumArtist: string.IsNullOrWhiteSpace(albumArtist) ? artist : albumArtist,
                Year: year,
                TrackNumber: trackNumber,
                DiscNumber: discNumber,
                Genre: null,
                Score: score,
                RecordingMbid: mbid);
        }

        private static JsonElement PickRelease(JsonElement releases, string preferredAlbum)
        {
            if (!string.IsNullOrWhiteSpace(preferredAlbum))
            {
                foreach (var release in releases.EnumerateArray())
                {
                    if (string.Equals(GetString(release, "title"), preferredAlbum, StringComparison.OrdinalIgnoreCase))
                    {
                        return release;
                    }
                }
            }

            return releases.EnumerateArray().First();
        }

        private static (uint Track, uint Disc) ParseTrackPosition(JsonElement release)
        {
            if (!release.TryGetProperty("media", out var media) || media.ValueKind != JsonValueKind.Array || media.GetArrayLength() == 0)
            {
                return (0, 0);
            }

            var medium = media.EnumerateArray().First();
            uint disc = medium.TryGetProperty("position", out var pos) && pos.TryGetInt32(out var discValue) ? (uint)discValue : 0;

            uint track = 0;
            if (medium.TryGetProperty("track", out var tracks) && tracks.ValueKind == JsonValueKind.Array && tracks.GetArrayLength() > 0)
            {
                var first = tracks.EnumerateArray().First();
                if (first.TryGetProperty("number", out var num) && uint.TryParse(num.GetString(), out var parsed))
                {
                    track = parsed;
                }
                else if (first.TryGetProperty("position", out var tp) && tp.TryGetInt32(out var tpValue))
                {
                    track = (uint)tpValue;
                }
            }

            return (track, disc);
        }

        private static string JoinArtistCredit(JsonElement element)
        {
            if (!element.TryGetProperty("artist-credit", out var credits) || credits.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var builder = new System.Text.StringBuilder();
            foreach (var credit in credits.EnumerateArray())
            {
                builder.Append(GetString(credit, "name"));
                if (credit.TryGetProperty("joinphrase", out var join) && join.ValueKind == JsonValueKind.String)
                {
                    builder.Append(join.GetString());
                }
            }

            var result = builder.ToString().Trim();
            return string.IsNullOrWhiteSpace(result) ? null : result;
        }

        private static uint ParseYear(string date)
        {
            if (!string.IsNullOrWhiteSpace(date) && date.Length >= 4 && uint.TryParse(date.AsSpan(0, 4), out var year))
            {
                return year;
            }

            return 0;
        }

        private static string PickTopName(JsonElement array, bool filterNonGenre)
        {
            string best = null;
            var bestCount = -1;
            foreach (var item in array.EnumerateArray())
            {
                var name = GetString(item, "name");
                if (string.IsNullOrWhiteSpace(name))
                {
                    continue;
                }

                if (filterNonGenre && NonGenreTags.Contains(name))
                {
                    continue;
                }

                var count = item.TryGetProperty("count", out var c) && c.TryGetInt32(out var countValue) ? countValue : 0;
                if (count > bestCount)
                {
                    bestCount = count;
                    best = name;
                }
            }

            return best;
        }

        private static string Capitalize(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return value;
            }

            return string.Join(' ', value.Split(' ').Select(word =>
                word.Length == 0 ? word : char.ToUpperInvariant(word[0]) + word[1..]));
        }

        private static string GetString(JsonElement element, string property)
            => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        private static string BuildUserAgent(string contact)
        {
            var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0";
            var contactPart = string.IsNullOrWhiteSpace(contact) ? "https://github.com/narey83/resonance" : contact.Trim();
            return $"resonance/{version} ( {contactPart} )";
        }

        private async Task<JsonDocument> GetJsonAsync(string relativeUrl, CancellationToken ct)
        {
            await PaceAsync(ct);

            var opts = Options.CurrentValue.MetadataLookup;
            var baseUrl = string.IsNullOrWhiteSpace(opts.BaseUrl) ? "https://musicbrainz.org/ws/2" : opts.BaseUrl.TrimEnd('/');

            try
            {
                using var client = HttpClientFactory.CreateClient();
                client.Timeout = TimeSpan.FromSeconds(30);
                client.DefaultRequestHeaders.UserAgent.Clear();
                client.DefaultRequestHeaders.UserAgent.ParseAdd(BuildUserAgent(opts.Contact));

                using var response = await client.GetAsync($"{baseUrl}/{relativeUrl}", ct);
                if (!response.IsSuccessStatusCode)
                {
                    Log.Debug("MusicBrainz request '{Url}' returned {Status}", relativeUrl, (int)response.StatusCode);
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
                Log.Debug("MusicBrainz request '{Url}' failed: {Error}", relativeUrl, ex.Message);
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
