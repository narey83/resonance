// <copyright file="MusicLibraryController.cs" company="John Narey">
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

namespace resonance.MusicLibrary.API
{
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Http;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Caching.Memory;
    using Microsoft.Extensions.Options;
    using resonance.Analysis;
    using resonance.Common;
    using resonance.Mixtapes;
    using resonance.Shares;
    using SixLabors.ImageSharp;
    using SixLabors.ImageSharp.Formats.Jpeg;
    using SixLabors.ImageSharp.Processing;
    using AppOptions = resonance.Options;

    /// <summary>
    ///     Request to analyse one or more tracks. Supply <see cref="Path"/> for a single track or
    ///     <see cref="Paths"/> for a batch — a batch is one scan, not one per track.
    /// </summary>
    /// <remarks>
    ///     <see cref="Metrics"/> is a comma-separated AnalysisMetrics flags string ("Bpm, Key,
    ///     Waveform, Loudness"). The older AnalyzeKey/AnalyzeBpm booleans still work and are used
    ///     when it is omitted.
    /// </remarks>
    public record AnalyzeTrackRequest(
        string Path = null,
        string[] Paths = null,
        bool AnalyzeKey = true,
        bool AnalyzeBpm = true,
        string Metrics = null,
        bool SkipAnalysed = false);

    public record AnalyzeFolderRequest(
        string Path,
        bool AnalyzeKey = true,
        bool AnalyzeBpm = true,
        string Metrics = null);

    public record DeleteTrackBatchRequest(string[] MaskedPaths);

    public record DeleteTrackBatchLocalRequest(string[] Paths);

    public record RenameFolderRequest(string Path, string NewName);

    public record RenameTrackRequest(string Path, string NewFilename);

    public record SignUrlsRequest(string[] Paths);

    public record SignedUrl(long Exp, string Sig);

    [ApiController]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Route("api/v{version:apiVersion}/[controller]")]
    [Authorize(Policy = AuthPolicy.FeatureLibrary)]
    public class MusicLibraryController : ControllerBase
    {
        public MusicLibraryController(
            IMusicLibraryService service,
            IAnalysisService analysis,
            IShareService shares,
            IMixtapeService mixtapes,
            IOptionsSnapshot<AppOptions> options,
            IMemoryCache cache,
            StreamUrlSigner urlSigner,
            resonance.Common.Ffmpeg.IFfmpegService ffmpeg)
        {
            Service = service;
            Analysis = analysis;
            Shares = shares;
            Mixtapes = mixtapes;
            Options = options;
            Cache = cache;
            UrlSigner = urlSigner;
            Ffmpeg = ffmpeg;
        }

        private IMusicLibraryService Service { get; }

        private IAnalysisService Analysis { get; }
        private IShareService Shares { get; }
        private IMixtapeService Mixtapes { get; }
        private IOptionsSnapshot<AppOptions> Options { get; }
        private IMemoryCache Cache { get; }
        private StreamUrlSigner UrlSigner { get; }
        private resonance.Common.Ffmpeg.IFfmpegService Ffmpeg { get; }

        // Resolved by the app-wide ffmpeg service (auto-downloaded/updated); null until provisioned.
        private string? FfmpegPath => Ffmpeg.FfmpegPath;

        // ── List caching ────────────────────────────────────────────────────────
        // The grouped artist/album/folder/genre/year lists are expensive to re-aggregate and
        // re-serialize on every tab load (the album list alone is thousands of rows). They change
        // only when the library is mutated, so we cache the raw service result for a few minutes
        // and bump a generation token to invalidate on sync/rename/delete. Signatures are stamped
        // per-request (outside the cache) so they never serve stale/expired.
        private int ListCacheGeneration =>
            Cache.GetOrCreate("music:list:gen", e =>
            {
                e.Priority = CacheItemPriority.NeverRemove;
                return 0;
            });

        /// <summary>Returns total track count and duration for the library.</summary>
        /// <returns></returns>
        [HttpGet("stats")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetStats()
        {
            var (total, totalDuration) = Service.GetStats();
            return Ok(new { total, totalDuration });
        }

        /// <summary>
        ///     A cheap content version of the library (track count + latest index time). Clients fetch
        ///     this once on startup and skip the full list sync when it matches what they last synced —
        ///     so the sync only does real work when the backend library actually changed.
        /// </summary>
        /// <returns></returns>
        [HttpGet("version")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetVersion() => Ok(new { version = Service.GetLibraryVersion() });

        /// <summary>Returns the current sync state.</summary>
        /// <returns></returns>
        [HttpGet("sync")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(MusicLibrarySyncState), 200)]
        public IActionResult GetSyncState() => Ok(Service.SyncState);

        /// <summary>Triggers an immediate sync (fire-and-forget). Pass force=true to clear all indexed tracks and re-read every file from disk.</summary>
        /// <returns></returns>
        [HttpPost("sync")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        public IActionResult TriggerSync([FromQuery] bool force = false)
        {
            if (force)
            {
                Service.ForceResync();
            }
            else
            {
                Service.TriggerSync();
            }

            InvalidateListCaches();
            return Accepted();
        }

        /// <summary>Cancels the in-flight scan (if any). Use to abort an accidental full/forced rescan.</summary>
        /// <returns></returns>
        [HttpPost("sync/cancel")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        public IActionResult CancelSync()
        {
            Service.CancelSync();
            return Accepted();
        }

        /// <summary>Queries tracks from the music library.</summary>
        /// <returns></returns>
        [HttpGet("tracks")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(MusicLibraryQueryResult), 200)]
        public IActionResult GetTracks(
            [FromQuery] string search,
            [FromQuery] string artist,
            [FromQuery] string album,
            [FromQuery] string genre,
            [FromQuery] int? year,
            [FromQuery] string folder,
            [FromQuery] bool missingKey = false,
            [FromQuery] bool missingBpm = false,
            [FromQuery] bool missingTitle = false,
            [FromQuery] bool missingArtist = false,
            [FromQuery] bool missingArtwork = false,
            [FromQuery] int limit = 50,
            [FromQuery] int offset = 0,
            [FromQuery] string sort = null,
            [FromQuery] bool descending = false)
        {
            limit = Math.Max(1, limit);
            offset = Math.Max(0, offset);
            var result = Service.QueryTracks(search, artist, album, genre, year, folder, missingKey, missingBpm, missingTitle, missingArtist, missingArtwork, limit, offset, sort, descending);
            return Ok(result with { Tracks = result.Tracks.Select(SignTrack).ToList() });
        }

        /// <summary>Returns all genres grouped from the music library.</summary>
        /// <returns></returns>
        [HttpGet("genres")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicGenre>), 200)]
        public IActionResult GetGenres()
        {
            var (list, etag) = GetCachedListWithETag("genres", () => Service.GetGenres());
            return NotModifiedOrNull(etag) ?? Ok(list);
        }

        /// <summary>Returns all years grouped from the music library.</summary>
        /// <returns></returns>
        [HttpGet("years")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicYear>), 200)]
        public IActionResult GetYears()
        {
            var (list, etag) = GetCachedListWithETag("years", () => Service.GetYears());
            return NotModifiedOrNull(etag) ?? Ok(list);
        }

        /// <summary>Returns all folders that contain tracks.</summary>
        /// <returns></returns>
        [HttpGet("folders")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicFolder>), 200)]
        public IActionResult GetFolders()
        {
            var (list, etag) = GetCachedListWithETag("folders", () => Service.GetFolders());
            return NotModifiedOrNull(etag) ?? Ok(list.Select(SignFolder).ToList());
        }

        /// <summary>Returns all albums grouped from the music library.</summary>
        /// <returns></returns>
        [HttpGet("albums")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicAlbum>), 200)]
        public IActionResult GetAlbums([FromQuery] string artist = null)
        {
            var (list, etag) = GetCachedListWithETag($"albums:{artist}", () => Service.GetAlbums(artist));
            return NotModifiedOrNull(etag) ?? Ok(list.Select(SignAlbum).ToList());
        }

        /// <summary>Returns all artists grouped from the music library.</summary>
        /// <returns></returns>
        [HttpGet("artists")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicArtist>), 200)]
        public IActionResult GetArtists()
        {
            var (list, etag) = GetCachedListWithETag("artists", () => Service.GetArtists());
            return NotModifiedOrNull(etag) ?? Ok(list.Select(SignArtist).ToList());
        }

        /// <summary>Returns recently added albums (by index time).</summary>
        /// <returns></returns>
        [HttpGet("recentlyadded")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicAlbum>), 200)]
        public IActionResult GetRecentlyAdded([FromQuery] int limit = 20)
        {
            limit = Math.Clamp(limit, 1, 100);
            return Ok(Service.GetRecentlyAdded(limit).Select(SignAlbum).ToList());
        }

        /// <summary>Returns all tracks that have a key tag — used for harmonic auto-mix.</summary>
        /// <returns></returns>
        [HttpGet("keyed")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.IReadOnlyList<MusicTrack>), 200)]
        public IActionResult GetKeyedTracks()
            => Ok(Service.GetKeyedTracks().Select(SignTrack).ToList());

        /// <summary>
        ///     Issues short-lived, path-scoped signatures for the given library paths. Clients
        ///     append <c>&amp;exp=...&amp;sig=...</c> to stream/artwork URLs instead of their JWT.
        ///     Only paths inside the library are signed; others are omitted from the result.
        /// </summary>
        /// <returns>A map of path → { exp, sig } for every path that was signable.</returns>
        [HttpPost("sign")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(System.Collections.Generic.Dictionary<string, SignedUrl>), 200)]
        public IActionResult SignUrls([FromBody] SignUrlsRequest request)
        {
            var result = new System.Collections.Generic.Dictionary<string, SignedUrl>();
            if (request?.Paths == null)
            {
                return Ok(result);
            }

            foreach (var path in request.Paths)
            {
                if (string.IsNullOrWhiteSpace(path) || result.ContainsKey(path) || !Service.IsLibraryPath(path))
                {
                    continue;
                }

                var (exp, sig) = UrlSigner.Sign(path);
                result[path] = new SignedUrl(exp, sig);
            }

            return Ok(result);
        }

        /// <summary>
        ///     Streams an audio file from the music library.
        ///     With no <paramref name="quality"/> the original file is served with HTTP range
        ///     support (seekable). With <c>quality=low</c>/<c>medium</c> the file is transcoded
        ///     on the fly to a lower-bitrate MP3 for slow/metered connections — this stream is
        ///     not byte-range seekable.
        /// </summary>
        /// <returns></returns>
        [HttpGet("stream")]
        [AllowAnonymous]
        [Produces("audio/mpeg", "audio/flac", "audio/ogg", "audio/wav", "audio/mp4", "audio/aac")]
        public async Task<IActionResult> StreamTrack([FromQuery] string path, [FromQuery] long exp = 0, [FromQuery] string sig = null, [FromQuery] string quality = null)
        {
            if (!Service.IsLibraryPath(path))
            {
                return StatusCode(StatusCodes.Status403Forbidden);
            }

            if (!UrlSigner.Validate(path, exp, sig))
            {
                return Unauthorized();
            }

            if (!System.IO.File.Exists(path))
            {
                return NotFound();
            }

            // Resolve symlinks to the real file: PhysicalFile range/sendfile throws on a symlink
            // (ArgumentOutOfRangeException), and a link could point outside the library — re-check.
            var file = ResolveRealPath(path);
            if (!Service.IsLibraryPath(file))
            {
                return StatusCode(StatusCodes.Status403Forbidden);
            }

            var kbps = quality?.ToLowerInvariant() switch
            {
                "low" => 96,
                "medium" => 160,
                _ => 0,
            };

            if (kbps > 0 && FfmpegPath != null)
            {
                await StreamTranscoded(file, kbps, HttpContext.RequestAborted);
                return new EmptyResult();
            }

            var extension = Path.GetExtension(file).TrimStart('.').ToLowerInvariant();
            var contentType = extension switch
            {
                "mp3" => "audio/mpeg",
                "flac" => "audio/flac",
                "ogg" => "audio/ogg",
                "wav" => "audio/wav",
                "m4a" => "audio/mp4",
                "aac" => "audio/aac",
                "opus" => "audio/ogg; codecs=opus",
                "aiff" or "aif" => "audio/aiff",
                _ => "audio/mpeg",
            };

            return PhysicalFile(file, contentType, enableRangeProcessing: true);
        }

        /// <summary>Returns embedded album artwork for a local track file.</summary>
        /// <returns></returns>
        [HttpGet("artwork")]
        [AllowAnonymous]
        [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Client)]
        public IActionResult GetArtwork([FromQuery] string path, [FromQuery] int? size, [FromQuery] long exp = 0, [FromQuery] string sig = null)
        {
            if (!Service.IsLibraryPath(path))
            {
                return StatusCode(StatusCodes.Status403Forbidden);
            }

            if (!UrlSigner.Validate(path, exp, sig))
            {
                return Unauthorized();
            }

            if (!System.IO.File.Exists(path))
            {
                return NotFound();
            }

            // Resolve symlinks and re-check, so a link can't point at artwork outside the library.
            var file = ResolveRealPath(path);
            if (!Service.IsLibraryPath(file))
            {
                return StatusCode(StatusCodes.Status403Forbidden);
            }

            path = file;
            var cacheKey = size.HasValue ? $"artwork:{path}:{size}" : $"artwork:{path}";
            if (Cache.TryGetValue(cacheKey, out ArtworkCacheEntry? cached) && cached != null)
            {
                return File(cached.Bytes, cached.Mime);
            }

            try
            {
                using var tf = TagLib.File.Create(path, TagLib.ReadStyle.Average);
                var pic = tf.Tag.Pictures?.FirstOrDefault();
                if (pic == null || pic.Data.Count == 0)
                {
                    return NotFound();
                }

                var rawBytes = pic.Data.Data;
                if (DetectImageMime(rawBytes) == null)
                {
                    return NotFound();
                }

                byte[] bytes;
                string mime;

                if (size.HasValue && size.Value > 0)
                {
                    using var img = Image.Load(rawBytes);
                    var s = Math.Clamp(size.Value, 32, 2048);
                    img.Mutate(x => x.Resize(new ResizeOptions
                    {
                        Size = new Size(s, s),
                        Mode = ResizeMode.Max,
                    }));
                    using var ms = new MemoryStream();
                    img.Save(ms, new JpegEncoder { Quality = 85 });
                    bytes = ms.ToArray();
                    mime = "image/jpeg";
                }
                else
                {
                    bytes = rawBytes;
                    mime = DetectImageMime(rawBytes)!;
                }

                Cache.Set(cacheKey, new ArtworkCacheEntry(bytes, mime), TimeSpan.FromHours(4));
                return File(bytes, mime);
            }
            catch
            {
                return NotFound();
            }
        }

        /// <summary>Triggers key and/or BPM analysis for a specific track.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("tracks/analyze")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> AnalyzeTrackAsync([FromBody] AnalyzeTrackRequest request)
        {
            var paths = (request?.Paths ?? [])
                .Concat(string.IsNullOrWhiteSpace(request?.Path) ? [] : new[] { request.Path })
                .Where(p => !string.IsNullOrWhiteSpace(p))
                .ToArray();

            if (paths.Length == 0)
            {
                return BadRequest("Path or Paths is required.");
            }

            var metrics = MetricsFrom(request);
            if (metrics == AnalysisMetrics.None)
            {
                return BadRequest("At least one metric must be requested.");
            }

            // One scan for the whole batch. A request per track would start a scan per track, and
            // since there is a single analysis queue every one after the first is rejected as
            // already-running — which is how analysing an album used to do only its first track.
            var masked = ResolveMaskedFilenames(paths);

            if (masked.Length == 0)
            {
                return NotFound("Track not found in library.");
            }

            try
            {
                // SkipAnalysed lets a caller ask for everything and get only what the track is
                // actually missing — one decode, no redoing the metrics it already has.
                await Analysis.StartScanAsync(new AnalysisScanRequest(
                    Metrics: metrics,
                    SkipAnalysed: request.SkipAnalysed,
                    OnlyFilenames: masked));
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }

            return Accepted();
        }

        /// <summary>Triggers key and/or BPM analysis for all tracks in a folder.</summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpPost("folders/analyze")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(202)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public async Task<IActionResult> AnalyzeFolderAsync([FromBody] AnalyzeFolderRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Path))
            {
                return BadRequest("Path is required.");
            }

            var metrics = MetricsFrom(request);
            if (metrics == AnalysisMetrics.None)
            {
                return BadRequest("At least one metric must be requested.");
            }

            var result = Service.QueryTracks(null, null, null, null, null, request.Path, false, false, false, false, false, 10_000, 0);
            if (result.Total == 0)
            {
                return NotFound("No tracks found in folder.");
            }

            var maskedFilenames = ResolveMaskedFilenames(result.Tracks.Select(t => t.Path));

            if (maskedFilenames.Length == 0)
            {
                return NotFound("No analysable tracks found.");
            }

            try
            {
                await Analysis.StartScanAsync(new AnalysisScanRequest(
                    Metrics: metrics,
                    SkipAnalysed: false,
                    OnlyFilenames: maskedFilenames));
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }

            return Accepted();
        }

        /// <summary>Renames a folder on disk and updates all DB records under it.</summary>
        /// <returns></returns>
        [HttpPatch("folders")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult RenameFolder([FromBody] RenameFolderRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Path) || string.IsNullOrWhiteSpace(request.NewName))
            {
                return BadRequest("Path and NewName are required.");
            }

            if (request.NewName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            {
                return BadRequest("NewName contains invalid characters.");
            }

            var fullPath = Path.GetFullPath(request.Path);

            if (!IsWithinShareDirectory(fullPath))
            {
                return Forbid();
            }

            try
            {
                var parent = Path.GetDirectoryName(fullPath);
                var newPath = Path.Combine(parent ?? string.Empty, request.NewName);
                Service.RenameFolder(fullPath, request.NewName);
                InvalidateListCaches();
                var sep = Path.DirectorySeparatorChar.ToString();
                Mixtapes.UpdateTrackPaths(fullPath + sep, newPath + sep);
                try
                {
                    Shares.RemoveLocalPath(fullPath);
                }
                catch
                { /* non-fatal */
                }

                _ = TriggerShareScanAsync(newPath);
                return NoContent();
            }
            catch (DirectoryNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
            catch (System.IO.IOException ex)
            {
                return StatusCode(500, ex.Message);
            }
            catch (Exception ex)
            {
                Serilog.Log.Error(ex, "RenameFolder failed for {Path}", fullPath);
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>Renames a track file on disk and updates its DB record.</summary>
        /// <returns></returns>
        [HttpPatch("tracks")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        [ProducesResponseType(409)]
        public IActionResult RenameTrack([FromBody] RenameTrackRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Path) || string.IsNullOrWhiteSpace(request.NewFilename))
            {
                return BadRequest("Path and NewFilename are required.");
            }

            if (request.NewFilename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            {
                return BadRequest("NewFilename contains invalid characters.");
            }

            var fullPath = Path.GetFullPath(request.Path);

            if (!IsWithinShareDirectory(fullPath))
            {
                return Forbid();
            }

            try
            {
                var dir = Path.GetDirectoryName(fullPath) ?? string.Empty;
                var newPath = Path.Combine(dir, request.NewFilename);
                Service.RenameTrack(fullPath, request.NewFilename);
                InvalidateListCaches();
                Mixtapes.UpdateTrackPaths(fullPath, newPath);
                try
                {
                    Shares.RemoveLocalPath(fullPath);
                }
                catch
                { /* non-fatal */
                }

                _ = TriggerShareScanAsync(dir);
                return NoContent();
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return Conflict(ex.Message);
            }
            catch (System.IO.IOException ex)
            {
                return StatusCode(500, ex.Message);
            }
            catch (Exception ex)
            {
                Serilog.Log.Error(ex, "RenameTrack failed for {Path}", fullPath);
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>Deletes a track file from disk and removes it from the library.</summary>
        /// <returns></returns>
        [HttpDelete("tracks")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public IActionResult DeleteTrack([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("Path is required.");
            }

            string decoded;
            try
            {
                decoded = Encoding.UTF8.GetString(Convert.FromBase64String(path));
            }
            catch
            {
                return BadRequest("Path must be base64-encoded.");
            }

            decoded = Path.GetFullPath(decoded);

            if (!IsWithinShareDirectory(decoded))
            {
                return Forbid();
            }

            try
            {
                Service.DeleteTrack(decoded);
                InvalidateListCaches();
                try
                {
                    Shares.RemoveLocalPath(decoded);
                }
                catch
                { /* non-fatal */
                }

                return NoContent();
            }
            catch (FileNotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>Deletes a folder and all its contents from disk and removes them from the library.</summary>
        /// <returns></returns>
        [HttpDelete("folders")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(400)]
        [ProducesResponseType(403)]
        [ProducesResponseType(404)]
        public IActionResult DeleteFolder([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("Path is required.");
            }

            string decoded;
            try
            {
                decoded = Encoding.UTF8.GetString(Convert.FromBase64String(path));
            }
            catch
            {
                return BadRequest("Path must be base64-encoded.");
            }

            decoded = Path.GetFullPath(decoded);

            if (!IsWithinShareDirectory(decoded))
            {
                return Forbid();
            }

            try
            {
                Service.DeleteFolder(decoded);
                InvalidateListCaches();
                try
                {
                    Shares.RemoveLocalPath(decoded);
                }
                catch
                { /* non-fatal */
                }

                return NoContent();
            }
            catch (DirectoryNotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>
        /// Deletes a batch of tracks identified by their Soulseek masked paths.
        /// Returns a summary of deleted, not-found, and forbidden paths.
        /// </summary>
        /// <returns></returns>
        [HttpPost("tracks/delete-batch")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public IActionResult DeleteTrackBatch([FromBody] DeleteTrackBatchRequest request)
        {
            if (request?.MaskedPaths == null || request.MaskedPaths.Length == 0)
            {
                return BadRequest("MaskedPaths are required.");
            }

            // Build masked → original lookup from both tagged and untagged files
            var maskedToOriginal = new System.Collections.Generic.Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in Shares.GetTaggedFiles())
            {
                maskedToOriginal.TryAdd(f.MaskedFilename, f.OriginalFilename);
            }

            foreach (var f in Shares.GetUntaggedFiles())
            {
                maskedToOriginal.TryAdd(f.MaskedFilename, f.OriginalFilename);
            }

            var deleted = 0;
            var notFound = 0;
            var forbidden = 0;

            foreach (var masked in request.MaskedPaths)
            {
                if (!maskedToOriginal.TryGetValue(masked, out var originalPath))
                {
                    notFound++;
                    continue;
                }

                var fullPath = Path.GetFullPath(originalPath);

                if (!IsWithinShareDirectory(fullPath))
                {
                    forbidden++;
                    continue;
                }

                try
                {
                    System.IO.File.Delete(fullPath);
                    try
                    {
                        Shares.RemoveLocalPath(fullPath);
                    }
                    catch
                    { /* non-fatal */
                    }

                    deleted++;
                }
                catch
                {
                    notFound++;
                }
            }

            if (deleted > 0)
            {
                InvalidateListCaches();
                Service.TriggerImmediateSync();
            }

            return Ok(new { deleted, notFound, forbidden });
        }

        /// <summary>Deletes a batch of tracks identified by their base64-encoded local paths.</summary>
        /// <returns></returns>
        [HttpPost("tracks/delete-batch-local")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public IActionResult DeleteTrackBatchLocal([FromBody] DeleteTrackBatchLocalRequest request)
        {
            if (request?.Paths == null || request.Paths.Length == 0)
            {
                return BadRequest("Paths are required.");
            }

            var deleted = 0;
            var notFound = 0;
            var forbidden = 0;

            foreach (var encodedPath in request.Paths)
            {
                string decoded;
                try
                {
                    decoded = Encoding.UTF8.GetString(Convert.FromBase64String(encodedPath));
                }
                catch
                {
                    forbidden++;
                    continue;
                }

                var fullPath = Path.GetFullPath(decoded);

                if (!IsWithinShareDirectory(fullPath))
                {
                    forbidden++;
                    continue;
                }

                try
                {
                    System.IO.File.Delete(fullPath);
                    try
                    {
                        Shares.RemoveLocalPath(fullPath);
                    }
                    catch
                    { /* non-fatal */
                    }

                    deleted++;
                }
                catch
                {
                    notFound++;
                }
            }

            if (deleted > 0)
            {
                InvalidateListCaches();
                Service.TriggerImmediateSync();
            }

            return Ok(new { deleted, notFound, forbidden });
        }

        // Order-INDEPENDENT content ETag: the grouped queries only ORDER BY the group key, so tied
        // rows can come back in different orders between runs — hashing the serialized list directly
        // would then change the ETag every refill and defeat conditional GETs (every client would
        // re-download in full). Instead XOR each row's hash (commutative → order doesn't matter) and
        // fold in the row count, so the ETag is stable as long as the underlying data is.
        // An explicit Metrics string wins; otherwise fall back to the older key/bpm booleans.
        private static AnalysisMetrics MetricsFrom(string metrics, bool key, bool bpm)
        {
            if (!string.IsNullOrWhiteSpace(metrics)
                && Enum.TryParse<AnalysisMetrics>(metrics, ignoreCase: true, out var parsed))
            {
                return parsed;
            }

            return (key ? AnalysisMetrics.Key : AnalysisMetrics.None)
                | (bpm ? AnalysisMetrics.Bpm : AnalysisMetrics.None);
        }

        private static AnalysisMetrics MetricsFrom(AnalyzeTrackRequest r) =>
            MetricsFrom(r.Metrics, r.AnalyzeKey, r.AnalyzeBpm);

        private static AnalysisMetrics MetricsFrom(AnalyzeFolderRequest r) =>
            MetricsFrom(r.Metrics, r.AnalyzeKey, r.AnalyzeBpm);

        private static string ComputeListETag<T>(System.Collections.Generic.IReadOnlyList<T> list)
        {
            var acc = new byte[20];
            foreach (var item in list)
            {
                var rowHash = System.Security.Cryptography.SHA1.HashData(
                    System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(item));
                for (var i = 0; i < acc.Length; i++)
                {
                    acc[i] ^= rowHash[i];
                }
            }

            var countBytes = BitConverter.GetBytes(list.Count);
            var combined = new byte[countBytes.Length + acc.Length];
            Buffer.BlockCopy(countBytes, 0, combined, 0, countBytes.Length);
            Buffer.BlockCopy(acc, 0, combined, countBytes.Length, acc.Length);
            return $"\"{Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(combined))}\"";
        }

        /// <summary>
        ///     Resolves a (possibly symlinked) path to its real on-disk target, following a chain
        ///     of links. Returns the original path unchanged if it is not a link or cannot be
        ///     resolved. Callers must re-validate the result with <see cref="IMusicLibraryService.IsLibraryPath"/>.
        /// </summary>
        private static string ResolveRealPath(string path)
        {
            try
            {
                var target = new FileInfo(path).ResolveLinkTarget(returnFinalTarget: true);
                return target?.FullName ?? path;
            }
            catch
            {
                return path;
            }
        }

        /// <summary>
        ///     Copies exactly <paramref name="count"/> bytes from <paramref name="source"/> to
        ///     <paramref name="destination"/>, zero-padding if the source ends early so the written
        ///     length always equals the declared Content-Length.
        /// </summary>
        private static async Task CopyExactlyAsync(Stream source, Stream destination, long count, CancellationToken cancellationToken)
        {
            var buffer = new byte[81920];
            var remaining = count;
            while (remaining > 0)
            {
                var want = (int)Math.Min(buffer.Length, remaining);
                var read = await source.ReadAsync(buffer.AsMemory(0, want), cancellationToken);
                if (read <= 0)
                {
                    break; // source exhausted — pad below
                }

                await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                remaining -= read;
            }

            // Zero-pad any shortfall (the CBR size estimate slightly overshot the actual output).
            if (remaining > 0)
            {
                Array.Clear(buffer);
                while (remaining > 0)
                {
                    var pad = (int)Math.Min(buffer.Length, remaining);
                    await destination.WriteAsync(buffer.AsMemory(0, pad), cancellationToken);
                    remaining -= pad;
                }
            }
        }

        private static string? DetectImageMime(byte[] bytes)
        {
            if (bytes.Length < 4)
            {
                return null;
            }

            if (bytes[0] == 0xFF && bytes[1] == 0xD8)
            {
                return "image/jpeg";
            }

            if (bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
            {
                return "image/png";
            }

            if (bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46)
            {
                return "image/gif";
            }

            if (bytes.Length >= 12 && bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
            {
                return "image/webp";
            }

            return null;
        }

        private void InvalidateListCaches() =>
            Cache.Set("music:list:gen", ListCacheGeneration + 1, new MemoryCacheEntryOptions { Priority = CacheItemPriority.NeverRemove });

        // Returns the cached list plus a content ETag computed over the UNSIGNED list. The ETag is
        // stable across requests (it does NOT include the per-request rotating signatures) and
        // changes only when the underlying data changes, so clients can issue conditional GETs and
        // get 304 (~0 bytes) for any list that didn't actually change — incremental updates without
        // re-pulling unchanged aggregates. The ETag is computed once per cache fill and cached with
        // the list, so a 304 costs only a hash comparison.
        private (System.Collections.Generic.IReadOnlyList<T> List, string ETag) GetCachedListWithETag<T>(string key, Func<System.Collections.Generic.IReadOnlyList<T>> factory) =>
            Cache.GetOrCreate($"music:list:{ListCacheGeneration}:{key}", e =>
            {
                e.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
                var list = factory();
                return (list, ComputeListETag(list));
            });

        // True when the client's If-None-Match already matches the current ETag → respond 304.
        private bool ClientHasETag(string etag)
        {
            var inm = Request.Headers.IfNoneMatch.ToString();
            return !string.IsNullOrEmpty(inm) && (inm == etag || inm == "*");
        }

        // Sets the ETag header and returns a 304 if the client already has this exact data,
        // otherwise null (caller returns the full signed body).
        private IActionResult? NotModifiedOrNull(string etag)
        {
            Response.Headers.ETag = etag;
            return ClientHasETag(etag) ? StatusCode(StatusCodes.Status304NotModified) : null;
        }

        // ── Signature stamping ──────────────────────────────────────────────────
        // Embed a fresh path-scoped signature so the client can build signed artwork/stream URLs
        // without a second POST /sign round-trip (which previously blocked every list render).
        private MusicTrack SignTrack(MusicTrack t)
        {
            var (exp, sig) = UrlSigner.Sign(t.Path);
            return t with { Exp = exp, Sig = sig };
        }

        private MusicAlbum SignAlbum(MusicAlbum a)
        {
            if (string.IsNullOrEmpty(a.CoverPath))
            {
                return a;
            }

            var (exp, sig) = UrlSigner.Sign(a.CoverPath);
            return a with { Exp = exp, Sig = sig };
        }

        private MusicArtist SignArtist(MusicArtist a)
        {
            if (string.IsNullOrEmpty(a.CoverPath))
            {
                return a;
            }

            var (exp, sig) = UrlSigner.Sign(a.CoverPath);
            return a with { Exp = exp, Sig = sig };
        }

        private MusicFolder SignFolder(MusicFolder f)
        {
            if (string.IsNullOrEmpty(f.CoverPath))
            {
                return f;
            }

            var (exp, sig) = UrlSigner.Sign(f.CoverPath);
            return f with { Exp = exp, Sig = sig };
        }

        /// <summary>
        ///     Transcodes a local audio file to a constant-bitrate MP3 with ffmpeg and streams it
        ///     to the response. Used for the low-bandwidth streaming quality modes.
        ///     <para>
        ///     The output is made byte-range seekable: because the transcode is constant-bitrate,
        ///     a byte offset maps linearly to a time offset (<c>time = offset / bytesPerSecond</c>),
        ///     so we can declare a <c>Content-Length</c> estimated from the track duration, honour
        ///     <c>Range</c> requests by seeking ffmpeg with <c>-ss</c>, and write exactly the
        ///     requested number of bytes (truncating or zero-padding the tail to match). This lets
        ///     ExoPlayer/AVPlayer scrub within a transcoded stream. If the duration is unknown we
        ///     fall back to a non-seekable pipe.
        ///     </para>
        /// </summary>
        private async Task StreamTranscoded(string path, int kbps, CancellationToken cancellationToken)
        {
            var bitrate = $"{kbps}k";
            var durationSeconds = Service.GetTrack(path)?.Duration ?? 0;
            var bytesPerSecond = kbps * 1000L / 8; // CBR: kbps → bytes/s
            var totalBytes = durationSeconds > 0 ? (long)(durationSeconds * bytesPerSecond) : 0;

            Response.ContentType = "audio/mpeg";
            Response.Headers["Cache-Control"] = "no-cache";

            // Without a known duration we can't size the stream, so seeking isn't possible.
            if (totalBytes <= 0)
            {
                Response.Headers["Accept-Ranges"] = "none";
                await PipeTranscode(path, bitrate, startSeconds: 0, byteBudget: null, cancellationToken);
                return;
            }

            Response.Headers["Accept-Ranges"] = "bytes";

            // Parse a single "bytes=start-[end]" range; multi-range is not supported (nor needed).
            long startByte = 0;
            var isPartial = false;
            var rangeHeader = Request.Headers["Range"].ToString();
            if (!string.IsNullOrEmpty(rangeHeader) && rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
            {
                var spec = rangeHeader.Substring("bytes=".Length).Split(',')[0];
                var dash = spec.IndexOf('-');
                if (dash > 0 && long.TryParse(spec.Substring(0, dash), out var s) && s >= 0 && s < totalBytes)
                {
                    startByte = s;
                    isPartial = true;
                }
            }

            var byteBudget = totalBytes - startByte;

            if (isPartial)
            {
                Response.StatusCode = StatusCodes.Status206PartialContent;
                Response.Headers["Content-Range"] = $"bytes {startByte}-{totalBytes - 1}/{totalBytes}";
            }

            Response.ContentLength = byteBudget;

            var startSeconds = (double)startByte / bytesPerSecond;
            await PipeTranscode(path, bitrate, startSeconds, byteBudget, cancellationToken);
        }

        /// <summary>
        ///     Runs ffmpeg to transcode <paramref name="path"/> to CBR MP3 starting at
        ///     <paramref name="startSeconds"/> and copies the output to the response. When
        ///     <paramref name="byteBudget"/> is set, exactly that many bytes are written — the
        ///     tail is truncated if ffmpeg produces more, or zero-padded if it produces fewer —
        ///     so the body length always matches the declared <c>Content-Length</c>.
        /// </summary>
        private async Task PipeTranscode(string path, string bitrate, double startSeconds, long? byteBudget, CancellationToken cancellationToken)
        {
            using var ffmpeg = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = FfmpegPath,

                    // ArgumentList avoids quoting bugs with paths containing spaces.
                    // -ss before -i seeks the input quickly (accurate enough for CBR mapping);
                    // -vn drops any embedded cover-art (video) stream; -ar 44100 keeps the
                    // sample rate within MP3's supported range for hi-res sources.
                    ArgumentList =
                    {
                        "-hide_banner", "-loglevel", "error",
                    },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };

            if (startSeconds > 0)
            {
                ffmpeg.StartInfo.ArgumentList.Add("-ss");
                ffmpeg.StartInfo.ArgumentList.Add(startSeconds.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture));
            }

            foreach (var arg in new[]
            {
                "-i", path,
                "-vn",
                "-c:a", "libmp3lame", "-b:a", bitrate, "-ar", "44100",
                "-f", "mp3", "pipe:1",
            })
            {
                ffmpeg.StartInfo.ArgumentList.Add(arg);
            }

            ffmpeg.Start();

            try
            {
                var source = ffmpeg.StandardOutput.BaseStream;
                if (byteBudget == null)
                {
                    await source.CopyToAsync(Response.Body, cancellationToken);
                }
                else
                {
                    await CopyExactlyAsync(source, Response.Body, byteBudget.Value, cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                // Client disconnected (skipped track, closed app) — fall through to kill ffmpeg.
            }
            finally
            {
                try
                {
                    if (!ffmpeg.HasExited)
                    {
                        ffmpeg.Kill(entireProcessTree: true);
                    }
                }
                catch
                {
                    // best-effort
                }
            }
        }

        // ── Share sync helpers ────────────────────────────────────────────────
        private async Task TriggerShareScanAsync(string directory)
        {
            try
            {
                await Shares.ScanDirectoriesAsync(new[] { directory });
            }
            catch (ShareScanInProgressException)
            {
                // scan already running — it will pick up the changes
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning(ex, "Share rescan after library change failed");
            }
        }

        private string ResolveOneMaskedFilename(string originalPath) =>
            ResolveMaskedFilenames([originalPath]).FirstOrDefault();

        /// <summary>
        ///     Maps library paths to their masked names in a single pass over the share.
        /// </summary>
        /// <remarks>
        ///     Both sides are reduced to the stored root-relative form first: the share holds paths
        ///     that way while clients send the absolute path the library API gave them, so a direct
        ///     comparison never matched and every analyse request answered "not found".
        ///     Resolving the whole batch at once also avoids re-walking tens of thousands of shared
        ///     files once per requested track.
        /// </remarks>
        /// <returns>The masked filenames that resolved; unresolvable paths are dropped.</returns>
        private string[] ResolveMaskedFilenames(IEnumerable<string> originalPaths)
        {
            var wanted = new HashSet<string>(
                originalPaths.Where(p => !string.IsNullOrWhiteSpace(p)).Select(MusicPath.ToRelative),
                StringComparer.OrdinalIgnoreCase);

            if (wanted.Count == 0)
            {
                return [];
            }

            var resolved = Shares.GetTaggedFiles()
                .Select(f => (f.MaskedFilename, f.OriginalFilename))
                .Concat(Shares.GetUntaggedFiles().Select(f => (f.MaskedFilename, f.OriginalFilename)))
                .Where(f => wanted.Contains(MusicPath.ToRelative(f.OriginalFilename)))
                .Select(f => f.MaskedFilename)
                .Distinct()
                .ToArray();

            return resolved;
        }

        private bool IsWithinShareDirectory(string fullPath)
        {
            var shareDirs = Options.Value.Shares.Directories
                .Select(d => Path.GetFullPath(new Share(d.TrimEnd('/', '\\')).LocalPath))
                .Where(Directory.Exists);

            return shareDirs.Any(shareDir =>
                fullPath.StartsWith(shareDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                || string.Equals(fullPath, shareDir, StringComparison.OrdinalIgnoreCase));
        }
    }

    internal sealed record ArtworkCacheEntry(byte[] Bytes, string Mime);
}
