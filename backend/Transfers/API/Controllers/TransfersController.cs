// <copyright file="TransfersController.cs" company="JP Dillingham">
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

using Microsoft.Extensions.Options;

namespace resonance.Transfers.API
{
    using System;
    using System.Collections.Generic;
    using System.ComponentModel.DataAnnotations;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using resonance.Users;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Transfers.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [Produces("application/json")]
    [Consumes("application/json")]
    [Authorize(Policy = AuthPolicy.FeatureTransfers)]
    public class TransfersController : ControllerBase
    {
        /// <summary>
        ///     How many finished transfers the list endpoints will return, newest first. In-flight
        ///     transfers are always returned in full — see CapCompleted.
        /// </summary>
        private const int MaxCompletedInList = 500;

        /// <summary>
        ///     Initializes a new instance of the <see cref="TransfersController"/> class.
        /// </summary>
        /// <param name="optionsSnapshot"></param>
        /// <param name="userService"></param>
        /// <param name="transferService"></param>
        /// <param name="blockedUsersService"></param>
        /// <param name="musicLibraryService"></param>
        public TransfersController(
            ITransferService transferService,
            IUserService userService,
            IOptionsSnapshot<Options> optionsSnapshot,
            resonance.Users.Blocking.BlockedUsersService blockedUsersService,
            resonance.MusicLibrary.IMusicLibraryService musicLibraryService)
        {
            Transfers = transferService;
            Users = userService;
            OptionsSnapshot = optionsSnapshot;
            Blocked = blockedUsersService;
            MusicLibrary = musicLibraryService;
        }

        private static SemaphoreSlim DownloadRequestLimiter { get; } = new SemaphoreSlim(2, 2);
        private ITransferService Transfers { get; }
        private IUserService Users { get; }
        private IOptionsSnapshot<Options> OptionsSnapshot { get; }
        private resonance.Users.Blocking.BlockedUsersService Blocked { get; }
        private resonance.MusicLibrary.IMusicLibraryService MusicLibrary { get; }
        private ILogger Log { get; set; } = Serilog.Log.ForContext("SourceContext", Logs.Transfers.Downloads);

        /// <summary>
        ///     Cancels the specified download.
        /// </summary>
        /// <param name="username">The username of the download source.</param>
        /// <param name="id">The id of the download.</param>
        /// <param name="remove">A value indicating whether the tracked download should be removed after cancellation.</param>
        /// <returns></returns>
        /// <response code="204">The download was cancelled successfully.</response>
        /// <response code="404">The specified download was not found.</response>
        [HttpDelete("downloads/{username}/{id}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult CancelDownloadAsync([FromRoute, UrlEncoded, Required] string username, [FromRoute, Required] string id, [FromQuery] bool remove = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Guid.TryParse(id, out var guid))
            {
                return BadRequest();
            }

            try
            {
                Transfers.Downloads.TryCancel(guid);

                if (remove)
                {
                    Transfers.Downloads.Remove(guid);
                }

                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>
        ///     Cancels all incomplete downloads from the specified user, optionally limited to a single directory.
        /// </summary>
        /// <param name="username">The username of the download source.</param>
        /// <param name="directory">The remote directory to limit the cancellation to; all directories if omitted.</param>
        /// <param name="remove">A value indicating whether the tracked downloads should be removed after cancellation.</param>
        /// <returns>The number of downloads cancelled.</returns>
        /// <response code="200">The downloads were cancelled successfully.</response>
        [HttpDelete("downloads/{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(int), 200)]
        public IActionResult CancelDownloads([FromRoute, UrlEncoded, Required] string username, [FromQuery] string directory = null, [FromQuery] bool remove = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var matches = Transfers.Downloads.List(t => t.Username == username)
                .Where(t => !TransferStateCategories.Completed.Contains(t.State))
                .Where(t => directory is null || t.Filename.DirectoryName() == directory)
                .ToList();

            foreach (var transfer in matches)
            {
                Transfers.Downloads.TryCancel(transfer.Id);

                if (remove)
                {
                    Transfers.Downloads.Remove(transfer.Id);
                }
            }

            Log.Information("Cancelled {Count} downloads from {Username}{Directory}", matches.Count, username, directory is null ? string.Empty : $" in {directory}");
            return Ok(matches.Count);
        }

        /// <summary>
        ///     Removes all completed downloads, regardless of whether they failed or succeeded.
        /// </summary>
        /// <returns></returns>
        /// <response code="204">The downloads were removed successfully.</response>
        [HttpDelete("downloads/all/completed")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public IActionResult ClearCompletedDownloads()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            try
            {
                Transfers.Downloads.Remove(t => !t.Removed && TransferStateCategories.Completed.Contains(t.State));
                return NoContent();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to remove completed downloads: {Message}", ex.Message);
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>
        ///     Cancels the specified upload.
        /// </summary>
        /// <param name="username">The username of the upload destination.</param>
        /// <param name="id">The id of the upload.</param>
        /// <param name="remove">A value indicating whether the tracked upload should be removed after cancellation.</param>
        /// <returns></returns>
        /// <response code="204">The upload was cancelled successfully.</response>
        /// <response code="404">The specified upload was not found.</response>
        [HttpDelete("uploads/{username}/{id}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        [ProducesResponseType(404)]
        public IActionResult CancelUpload([FromRoute, UrlEncoded, Required] string username, [FromRoute, Required] string id, [FromQuery] bool remove = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Guid.TryParse(id, out var guid))
            {
                return BadRequest();
            }

            try
            {
                Transfers.Uploads.TryCancel(guid);

                if (remove)
                {
                    Transfers.Uploads.Remove(guid);
                }

                return NoContent();
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
        }

        /// <summary>
        ///     Cancels all incomplete uploads to the specified user, optionally limited to a single directory.
        /// </summary>
        /// <remarks>
        ///     Cancelled uploads are dispositioned as completed, so the peer is free to request the same files again.
        /// </remarks>
        /// <param name="username">The username of the upload destination.</param>
        /// <param name="directory">The remote directory to limit the cancellation to; all directories if omitted.</param>
        /// <param name="remove">A value indicating whether the tracked uploads should be removed after cancellation.</param>
        /// <returns>The number of uploads cancelled.</returns>
        /// <response code="200">The uploads were cancelled successfully.</response>
        [HttpDelete("uploads/{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(int), 200)]
        public IActionResult CancelUploads([FromRoute, UrlEncoded, Required] string username, [FromQuery] string directory = null, [FromQuery] bool remove = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var matches = Transfers.Uploads.List(t => t.Username == username, includeRemoved: false)
                .Where(t => !TransferStateCategories.Completed.Contains(t.State))
                .Where(t => directory is null || t.Filename.DirectoryName() == directory)
                .ToList();

            foreach (var transfer in matches)
            {
                Transfers.Uploads.TryCancel(transfer.Id);

                if (remove)
                {
                    Transfers.Uploads.Remove(transfer.Id);
                }
            }

            Log.Information("Cancelled {Count} uploads to {Username}{Directory}", matches.Count, username, directory is null ? string.Empty : $" in {directory}");
            return Ok(matches.Count);
        }

        /// <summary>
        ///     Removes all completed uploads, regardless of whether they failed or succeeded.
        /// </summary>
        /// <returns></returns>
        /// <response code="204">The uploads were removed successfully.</response>
        [HttpDelete("uploads/all/completed")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(204)]
        public IActionResult ClearCompletedUploads()
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            try
            {
                Transfers.Uploads.Remove(t => !t.Removed && TransferStateCategories.Completed.Contains(t.State));
                return NoContent();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to remove completed uploads: {Message}", ex.Message);
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>
        ///     Enqueues the specified download.
        /// </summary>
        /// <param name="username">The username of the download source.</param>
        /// <param name="requests">The list of download requests.</param>
        /// <returns></returns>
        /// <response code="201">The download was successfully enqueued.</response>
        /// <response code="403">The download was rejected.</response>
        /// <response code="500">An unexpected error was encountered.</response>
        [HttpPost("downloads/{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(201)]
        [ProducesResponseType(typeof(string), 403)]
        [ProducesResponseType(typeof(string), 500)]
        public async Task<IActionResult> EnqueueAsync([FromRoute, UrlEncoded, Required] string username, [FromBody] IEnumerable<QueueDownloadRequest> requests)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState.GetReadableString());
            }

            if (!requests?.Any() ?? true)
            {
                return BadRequest("At least one file is required");
            }

            if (requests.Any(r => r is null))
            {
                return BadRequest("One or more records in the request are null");
            }

            if (!await DownloadRequestLimiter.WaitAsync(30_000))
            {
                return StatusCode(429, "Request timed out waiting to be processed. Try again.");
            }

            try
            {
                if (Blocked.IsBlocked(username, resonance.Users.Blocking.BlockedUserScope.Transfers))
                {
                    return StatusCode(403, "User is blocked; unblock them to download");
                }

                var endpoint = await Users.GetIPEndPointAsync(username);

                if (Users.IsBlacklisted(username, endpoint.Address))
                {
                    throw new UserOfflineException($"User {username} appears to be offline");
                }

                var destinationFolder = requests.FirstOrDefault()?.DestinationFolder;
                var possibleDuplicate = FindPossibleDuplicateAlbum(requests);

                if (possibleDuplicate is not null)
                {
                    Log.Warning(
                        "Downloading {Count} file(s) from {Username} whose remote folder name resembles an album already in the library: {Artist} - {Album}",
                        requests.Count(), username, possibleDuplicate.Artist, possibleDuplicate.Album);
                }

                var (enqueued, failed) = await Transfers.Downloads.EnqueueAsync(username, requests.Select(r => (r.Filename, r.Size)), destinationFolder);

                return StatusCode(201, new { Enqueued = enqueued, Failed = failed, PossibleDuplicateOfAlbum = possibleDuplicate });
            }
            catch (InsufficientDiskSpaceException ex)
            {
                Log.Warning("Refused to enqueue {Count} files for {Username}: {Message}", requests.Count(), username, ex.Message);
                return StatusCode(507, ex.Message);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to enqueue {Count} files for {Username}: {Message}", requests.Count(), username, ex.Message);
                return StatusCode(500, ex.Message);
            }
            finally
            {
                DownloadRequestLimiter.Release();
            }
        }

        /// <summary>
        ///     Gets all downloads.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("downloads")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetDownloadsAsync([FromQuery] bool includeRemoved = false, [FromQuery] bool activeOnly = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var downloads = Transfers.Downloads.List(includeRemoved: includeRemoved);

            if (activeOnly)
            {
                downloads = downloads.Where(t => !TransferStateCategories.Completed.Contains(t.State)).ToList();
            }

            downloads = CapCompleted(downloads);

            var response = downloads.GroupBy(t => t.Username).Select(grouping => new UserResponse()
            {
                Username = grouping.Key,
                PeerAddress = Transfers.Downloads.GetPeerAddress(grouping.Key),
                Directories = grouping.GroupBy(g => g.Filename.DirectoryName()).Select(d => new DirectoryResponse()
                {
                    Directory = d.Key,
                    FileCount = d.Count(),
                    Files = d.ToList(),
                }),
            });

            return Ok(response);
        }

        /// <summary>
        ///     Gets all downloads for the specified username.
        /// </summary>
        /// <param name="username"></param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("downloads/{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetDownloadsAsync([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var downloads = Transfers.Downloads.List(d => d.Username == username);

            if (!downloads.Any())
            {
                return NotFound();
            }

            var response = new UserResponse()
            {
                Username = username,
                Directories = downloads.GroupBy(g => g.Filename.DirectoryName()).Select(d => new DirectoryResponse()
                {
                    Directory = d.Key,
                    FileCount = d.Count(),
                    Files = d.ToList(),
                }),
            };

            return Ok(response);
        }

        [HttpGet("downloads/{username}/{id}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(API.Transfer), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetDownload([FromRoute, UrlEncoded, Required] string username, [FromRoute, Required] string id)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Guid.TryParse(id, out var guid))
            {
                return BadRequest();
            }

            var download = Transfers.Downloads.Find(t => t.Id == guid);

            if (download == default)
            {
                return NotFound();
            }

            return Ok(download);
        }

        /// <summary>
        ///     Gets the download for the specified username matching the specified filename, and requests
        ///     the current place in the remote queue of the specified download.
        /// </summary>
        /// <param name="username">The username of the download source.</param>
        /// <param name="id">The id of the download.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        /// <response code="404">The specified download was not found.</response>
        [HttpGet("downloads/{username}/{id}/position")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(API.Transfer), 200)]
        [ProducesResponseType(404)]
        public async Task<IActionResult> GetPlaceInQueueAsync([FromRoute, UrlEncoded, Required] string username, [FromRoute, Required] string id)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (Users.IsBlacklisted(username))
            {
                return NotFound();
            }

            if (!Guid.TryParse(id, out var guid))
            {
                return BadRequest();
            }

            try
            {
                var place = await Transfers.Downloads.GetPlaceInQueueAsync(guid);
                return Ok(place);
            }
            catch (NotFoundException)
            {
                return NotFound();
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>
        ///     Gets all uploads.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("uploads")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetUploads([FromQuery] bool includeRemoved = false, [FromQuery] bool activeOnly = false)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var uploads = Transfers.Uploads.List(
                activeOnly
                    ? (t => !TransferStateCategories.Completed.Contains(t.State))
                    : (t => true),
                includeRemoved: includeRemoved);

            uploads = CapCompleted(uploads);

            var response = uploads.GroupBy(t => t.Username).Select(grouping => new UserResponse()
            {
                Username = grouping.Key,
                PeerAddress = Transfers.Uploads.GetPeerAddress(grouping.Key),
                Directories = grouping.GroupBy(g => g.Filename.DirectoryName()).Select(d => new DirectoryResponse()
                {
                    Directory = d.Key,
                    FileCount = d.Count(),
                    Files = d.ToList(),
                }),
            });

            return Ok(response);
        }

        /// <summary>
        ///     Gets all uploads for the specified username.
        /// </summary>
        /// <param name="username"></param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("uploads/{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetUploads([FromRoute, UrlEncoded, Required] string username)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            var uploads = Transfers.Uploads.List(d => d.Username == username, includeRemoved: false);

            if (!uploads.Any())
            {
                return NotFound();
            }

            var response = new UserResponse()
            {
                Username = username,
                Directories = uploads.GroupBy(g => g.Filename.DirectoryName()).Select(d => new DirectoryResponse()
                {
                    Directory = d.Key,
                    FileCount = d.Count(),
                    Files = d.ToList(),
                }),
            };

            return Ok(response);
        }

        /// <summary>
        ///     Gets the upload for the specified username matching the specified filename.
        /// </summary>
        /// <param name="username">The username of the upload destination.</param>
        /// <param name="id">The id of the upload.</param>
        /// <returns></returns>
        /// <response code="200">The request completed successfully.</response>
        [HttpGet("uploads/{username}/{id}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        public IActionResult GetUploads([FromRoute, UrlEncoded, Required] string username, [FromRoute, Required] string id)
        {
            if (Program.IsRelayAgent)
            {
                return Forbid();
            }

            if (!Guid.TryParse(id, out var guid))
            {
                return BadRequest();
            }

            var upload = Transfers.Uploads.Find(t => t.Id == guid);

            if (upload == default)
            {
                return NotFound();
            }

            return Ok(upload);
        }

        /// <summary>
        ///     Lists subfolders within the downloads directory at the given relative path.
        /// </summary>
        /// <param name="path">Relative path within the downloads directory (empty for root).</param>
        /// <returns></returns>
        [HttpGet("downloads/folders")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<string>), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(404)]
        public IActionResult GetDownloadFolders([FromQuery] string path = "")
        {
            var downloadsRoot = System.IO.Path.GetFullPath(OptionsSnapshot.Value.Directories.Downloads);

            var sanitized = (path ?? string.Empty)
                .Replace('/', System.IO.Path.DirectorySeparatorChar)
                .Replace('\\', System.IO.Path.DirectorySeparatorChar)
                .TrimStart(System.IO.Path.DirectorySeparatorChar);

            var targetDir = string.IsNullOrEmpty(sanitized)
                ? downloadsRoot
                : System.IO.Path.Combine(downloadsRoot, sanitized);

            var resolved = System.IO.Path.GetFullPath(targetDir);

            if (!resolved.StartsWith(downloadsRoot, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Path is outside the downloads directory");
            }

            if (!System.IO.Directory.Exists(resolved))
            {
                return NotFound();
            }

            var folders = System.IO.Directory.GetDirectories(resolved)
                .Select(System.IO.Path.GetFileName)
                .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Ok(folders);
        }

        /// <summary>
        ///     Creates a folder within the downloads directory at the given relative path.
        /// </summary>
        /// <returns></returns>
        [HttpPost("downloads/folders")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(201)]
        [ProducesResponseType(400)]
        public IActionResult CreateDownloadFolder([FromBody] CreateFolderRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Path))
            {
                return BadRequest("Path is required");
            }

            var downloadsRoot = System.IO.Path.GetFullPath(OptionsSnapshot.Value.Directories.Downloads);

            var sanitized = request.Path
                .Replace('/', System.IO.Path.DirectorySeparatorChar)
                .Replace('\\', System.IO.Path.DirectorySeparatorChar)
                .TrimStart(System.IO.Path.DirectorySeparatorChar);

            if (string.IsNullOrWhiteSpace(sanitized))
            {
                return BadRequest("Invalid path");
            }

            var targetDir = System.IO.Path.Combine(downloadsRoot, sanitized);
            var resolved = System.IO.Path.GetFullPath(targetDir);

            if (!resolved.StartsWith(downloadsRoot, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Path is outside the downloads directory");
            }

            try
            {
                System.IO.Directory.CreateDirectory(resolved);
                return StatusCode(201);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to create folder {Path}: {Message}", request.Path, ex.Message);
                return StatusCode(500, ex.Message);
            }
        }

        /// <summary>
        ///     Returns every in-flight transfer plus only the most recently finished
        ///     <see cref="MaxCompletedInList"/> completed ones.
        /// </summary>
        /// <remarks>
        ///     These endpoints returned the entire transfer history. On a long-lived instance that is
        ///     1.5 million rows and a 13 MB response taking four and a half seconds to build — polled
        ///     every two seconds by the mobile transfers screen, so responses overlapped and piled up
        ///     until the connection pool was full and the client spent seconds parsing each one. No
        ///     client can display that many rows, and none tries to: they all filter client-side.
        ///     In-flight transfers are never dropped, however many there are.
        /// </remarks>
        private static List<resonance.Transfers.Transfer> CapCompleted(IEnumerable<resonance.Transfers.Transfer> transfers)
        {
            var completed = new List<resonance.Transfers.Transfer>();
            var live = new List<resonance.Transfers.Transfer>();

            foreach (var t in transfers)
            {
                if (TransferStateCategories.Completed.Contains(t.State))
                {
                    completed.Add(t);
                }
                else
                {
                    live.Add(t);
                }
            }

            if (completed.Count > MaxCompletedInList)
            {
                completed = completed
                    .OrderByDescending(t => t.EndedAt ?? t.RequestedAt)
                    .Take(MaxCompletedInList)
                    .ToList();
            }

            live.AddRange(completed);
            return live;
        }

        /// <summary>
        ///     Checks whether the remote folder these files are coming from resembles an album already present in
        ///     the library, so the caller can warn the user before they end up with a second copy.
        /// </summary>
        /// <remarks>
        ///     This is a heuristic, not an exact match (remote folder naming isn't standardized), so it only warns;
        ///     it never blocks the download.
        /// </remarks>
        private resonance.MusicLibrary.MusicAlbum FindPossibleDuplicateAlbum(IEnumerable<QueueDownloadRequest> requests)
        {
            var folderName = requests.FirstOrDefault()?.Filename?.ParentFolderName().ToFuzzyMatchKey();

            if (string.IsNullOrEmpty(folderName))
            {
                return null;
            }

            return MusicLibrary.GetAlbums().FirstOrDefault(album =>
            {
                var artistKey = album.Artist.ToFuzzyMatchKey();
                var albumKey = album.Album.ToFuzzyMatchKey();

                return !string.IsNullOrEmpty(albumKey) && folderName.Contains(albumKey)
                    && !string.IsNullOrEmpty(artistKey) && folderName.Contains(artistKey);
            });
        }
    }
}
