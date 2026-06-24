// <copyright file="StreamsController.cs" company="John Narey">
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

namespace resonance.Transfers.API
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.IO;
    using System.IO.Pipelines;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Extensions.Options;
    using resonance.Shares;
    using Soulseek;

    /// <summary>
    ///     Audio streaming from remote peers.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    public class StreamsController : ControllerBase
    {
        // Formats browsers cannot decode natively — require ffmpeg transcoding
        private static readonly HashSet<string> TranscodeExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "ape", "wma", "aiff", "aif", "alac",
        };

        // APE requires seeking — must buffer to a temp file before transcoding
        private static readonly HashSet<string> SeekableOnlyExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "ape",
        };

        private static readonly string PreviewTempDir = Path.Combine(Program.DataDirectory, "temp", "preview");
        private static readonly object PreviewLock = new();
        private static readonly HashSet<string> PreviewInProgress = new();
        private static readonly HashSet<string> PreviewFailed = new();

        // Clean up leftover previews on startup, then every 6 hours
        private static readonly Timer PreviewCleanupTimer = new(
            _ => CleanupPreviewFiles(), null, TimeSpan.Zero, TimeSpan.FromHours(6));

        // Resolved by the app-wide ffmpeg service (auto-downloaded/updated); null until provisioned.
        private string? FfmpegPath => Ffmpeg.FfmpegPath;

        public StreamsController(ISoulseekClient client, ITransferService transferService, IOptionsMonitor<resonance.Options> optionsMonitor, IShareService shareService, resonance.Common.Ffmpeg.IFfmpegService ffmpeg)
        {
            Client = client;
            Transfers = transferService;
            OptionsMonitor = optionsMonitor;
            Shares = shareService;
            Ffmpeg = ffmpeg;
        }

        private ISoulseekClient Client { get; }
        private ITransferService Transfers { get; }
        private IOptionsMonitor<resonance.Options> OptionsMonitor { get; }
        private IShareService Shares { get; }
        private resonance.Common.Ffmpeg.IFfmpegService Ffmpeg { get; }

        /// <summary>
        ///     Streams a file from a remote peer directly to the HTTP response, enabling audio preview.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("{username}")]
        [Authorize(Policy = AuthPolicy.Any)]
        public async Task StreamFile(
            string username,
            [FromQuery] string filename,
            [FromQuery] long? size = null)
        {
            var extension = Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
            var needsTranscode = TranscodeExtensions.Contains(extension) && FfmpegPath != null;

            if (needsTranscode)
            {
                Response.ContentType = "audio/mpeg";
            }
            else
            {
                Response.ContentType = extension switch
                {
                    "mp3" => "audio/mpeg",
                    "flac" => "audio/flac",
                    "ogg" => "audio/ogg",
                    "wav" => "audio/wav",
                    "m4a" => "audio/mp4",
                    "aac" => "audio/aac",
                    "opus" => "audio/ogg; codecs=opus",
                    "wma" => "audio/x-ms-wma",
                    "aiff" or "aif" => "audio/aiff",
                    _ => "audio/mpeg",
                };
            }

            Response.Headers["Cache-Control"] = "no-cache";
            Response.Headers["Accept-Ranges"] = "none";

            if (needsTranscode && SeekableOnlyExtensions.Contains(extension))
            {
                await StreamWithTempFileTranscode(username, filename, size, extension, HttpContext.RequestAborted);
            }
            else if (needsTranscode)
            {
                await StreamWithPipeTranscode(username, filename, size, extension, HttpContext.RequestAborted);
            }
            else
            {
                await StreamDirect(username, filename, size, HttpContext.RequestAborted);
            }
        }

        /// <summary>
        ///     Serves a previously downloaded local file with HTTP range request support, enabling seek.
        /// </summary>
        /// <returns></returns>
        [HttpGet("{username}/local")]
        [Authorize(Policy = AuthPolicy.Any)]
        public IActionResult ServeLocalFile(string username, [FromQuery] string filename)
        {
            var download = Transfers.Downloads.List(t =>
                t.Username == username &&
                t.Filename == filename &&
                t.State.HasFlag(TransferStates.Completed | TransferStates.Succeeded)).FirstOrDefault();

            if (download == null)
            {
                return NotFound();
            }

            string localPath;

            if (download.BatchId is not null)
            {
                var localFilename = Path.GetFileName(filename.LocalizePath());
                localPath = Path.Combine(OptionsMonitor.CurrentValue.Directories.Downloads, download.BatchId.Value.ToString(), localFilename);
            }
            else
            {
                localPath = filename.ToLocalFilename(baseDirectory: OptionsMonitor.CurrentValue.Directories.Downloads);
            }

            if (!System.IO.File.Exists(localPath))
            {
                return NotFound();
            }

            var extension = Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
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

            return PhysicalFile(localPath, contentType, enableRangeProcessing: true);
        }

        /// <summary>
        ///     Downloads a file to a temporary location and serves it with range support for seekable preview.
        ///     Returns 404 while the download is in progress (client should poll), 503 on failure.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpGet("{username}/preview")]
        [HttpHead("{username}/preview")]
        [Authorize(Policy = AuthPolicy.Any)]
        public async Task<IActionResult> PreviewFile(
            string username,
            [FromQuery] string filename,
            [FromQuery] long? size = null)
        {
            var key = $"{username}::{filename}";
            var tempPath = GetPreviewTempPath(username, filename);
            var extension = Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
            var contentType = GetAudioContentType(extension);

            lock (PreviewLock)
            {
                if (PreviewFailed.Contains(key))
                {
                    return StatusCode(503);
                }
            }

            // Serve if already cached in temp (only reached when not InProgress)
            if (System.IO.File.Exists(tempPath))
            {
                return PhysicalFile(tempPath, contentType, enableRangeProcessing: true);
            }

            // Serve directly from local shares if the requested username is our own
            if (string.Equals(username, Client.Username, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    var (_, localPath, _) = await Shares.ResolveFileAsync(filename);
                    if (localPath != null && System.IO.File.Exists(localPath))
                    {
                        return PhysicalFile(localPath, contentType, enableRangeProcessing: true);
                    }
                }
                catch (NotFoundException)
                {
                    // file not in shares — fall through to normal download
                }
            }

            // Serve if already in the downloads library
            var download = Transfers.Downloads.List(t =>
                t.Username == username &&
                t.Filename == filename &&
                t.State.HasFlag(TransferStates.Completed | TransferStates.Succeeded)).FirstOrDefault();

            if (download != null)
            {
                string localPath;
                if (download.BatchId is not null)
                {
                    var localFilename = Path.GetFileName(filename.LocalizePath());
                    localPath = Path.Combine(OptionsMonitor.CurrentValue.Directories.Downloads, download.BatchId.Value.ToString(), localFilename);
                }
                else
                {
                    localPath = filename.ToLocalFilename(baseDirectory: OptionsMonitor.CurrentValue.Directories.Downloads);
                }

                if (System.IO.File.Exists(localPath))
                {
                    return PhysicalFile(localPath, contentType, enableRangeProcessing: true);
                }
            }

            if (size > 50 * 1024 * 1024)
            {
                return StatusCode(503);
            }

            // Determine whether another request is already caching this file
            bool alreadyCaching;
            lock (PreviewLock)
            {
                alreadyCaching = PreviewInProgress.Contains(key);
                if (!alreadyCaching)
                {
                    PreviewInProgress.Add(key);
                }
            }

            // Set streaming headers before writing to the body
            Response.ContentType = contentType;
            Response.Headers["Cache-Control"] = "no-cache";
            Response.Headers["Accept-Ranges"] = "none";

            if (alreadyCaching)
            {
                // Another request is already downloading this file — stream it directly
                // without a second caching attempt; the first request will populate the cache
                await StreamDirect(username, filename, size, HttpContext.RequestAborted);
                return new EmptyResult();
            }

            // Tee-stream: pipe bytes to both the HTTP response and a cache file simultaneously.
            // The client starts receiving audio immediately; once the download finishes the
            // file is renamed to the stable cache path so future requests get Range support.
            System.IO.Directory.CreateDirectory(PreviewTempDir);
            var partPath = tempPath + ".part";
            var cacheSuccess = false;

            using var downloadCts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
            var pipe = new Pipe();

            var downloadTask = Task.Run(async () =>
            {
                try
                {
                    await Client.DownloadAsync(
                        username: username,
                        remoteFilename: filename,
                        outputStreamFactory: () => Task.FromResult<Stream>(pipe.Writer.AsStream()),
                        size: size,
                        cancellationToken: downloadCts.Token);
                }
                catch (Exception)
                {
                    lock (PreviewLock)
                    {
                        PreviewFailed.Add(key);
                    }
                }
                finally
                {
                    await pipe.Writer.CompleteAsync();
                }
            });

            try
            {
                await using var cacheStream = System.IO.File.Open(partPath, FileMode.Create, FileAccess.Write, FileShare.None);
                var clientToken = HttpContext.RequestAborted;

                while (true)
                {
                    var result = await pipe.Reader.ReadAsync(downloadCts.Token);

                    foreach (var segment in result.Buffer)
                    {
                        // Always write to cache (even if the client disconnected)
                        await cacheStream.WriteAsync(segment, downloadCts.Token);

                        // Best-effort write to response — ignore if client has gone away
                        if (!clientToken.IsCancellationRequested)
                        {
                            try
                            {
                                await Response.Body.WriteAsync(segment, clientToken);
                            }
                            catch (OperationCanceledException)
                            {
                            }
                        }
                    }

                    pipe.Reader.AdvanceTo(result.Buffer.End);
                    if (result.IsCompleted)
                    {
                        cacheSuccess = true;
                        break;
                    }
                }
            }
            catch (Exception)
            {
                System.IO.File.Delete(partPath);
            }
            finally
            {
                pipe.Reader.Complete();
                lock (PreviewLock)
                {
                    PreviewInProgress.Remove(key);
                }
            }

            await downloadTask;

            if (cacheSuccess && System.IO.File.Exists(partPath))
            {
                try
                {
                    System.IO.File.Move(partPath, tempPath, overwrite: true);
                }
                catch
                {
                    System.IO.File.Delete(partPath);
                }
            }

            return new EmptyResult();
        }

        private async Task StreamDirect(string username, string filename, long? size, CancellationToken cancellationToken)
        {
            var pipe = new Pipe();

            var downloadTask = Task.Run(async () =>
            {
                try
                {
                    await Client.DownloadAsync(
                        username: username,
                        remoteFilename: filename,
                        outputStreamFactory: () => Task.FromResult<Stream>(pipe.Writer.AsStream()),
                        size: size,
                        cancellationToken: cancellationToken);
                }
                catch (Exception)
                {
                    // pipe completion below signals the reader to stop
                }
                finally
                {
                    await pipe.Writer.CompleteAsync();
                }
            });

            try
            {
                await pipe.Reader.CopyToAsync(Response.Body, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // client disconnected
            }
            finally
            {
                pipe.Reader.Complete();
            }

            await downloadTask;
        }

        private async Task StreamWithPipeTranscode(string username, string filename, long? size, string extension, CancellationToken cancellationToken)
        {
            var inputFormat = GetFfmpegInputFormat(extension);
            var downloadPipe = new Pipe();

            var downloadTask = Task.Run(async () =>
            {
                try
                {
                    await Client.DownloadAsync(
                        username: username,
                        remoteFilename: filename,
                        outputStreamFactory: () => Task.FromResult<Stream>(downloadPipe.Writer.AsStream()),
                        size: size,
                        cancellationToken: cancellationToken);
                }
                catch (Exception)
                {
                }
                finally
                {
                    await downloadPipe.Writer.CompleteAsync();
                }
            });

            try
            {
                using var ffmpeg = new Process();
                ffmpeg.StartInfo = new ProcessStartInfo
                {
                    FileName = FfmpegPath,
                    Arguments = $"-f {inputFormat} -i pipe:0 -c:a libmp3lame -q:a 2 -f mp3 pipe:1",
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                ffmpeg.Start();

                var copyToFfmpeg = Task.Run(async () =>
                {
                    try
                    {
                        await downloadPipe.Reader.CopyToAsync(ffmpeg.StandardInput.BaseStream, cancellationToken);
                    }
                    catch (Exception)
                    {
                    }
                    finally
                    {
                        ffmpeg.StandardInput.Close();
                        downloadPipe.Reader.Complete();
                    }
                });

                try
                {
                    await ffmpeg.StandardOutput.BaseStream.CopyToAsync(Response.Body, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                }

                await copyToFfmpeg;
                await downloadTask;

                ffmpeg.Kill(entireProcessTree: true);
            }
            catch (Exception)
            {
                await downloadTask;
            }
        }

        private async Task StreamWithTempFileTranscode(string username, string filename, long? size, string extension, CancellationToken cancellationToken)
        {
            var tempFile = Path.Combine(Program.DataDirectory, "temp", $"resonance-stream-{Guid.NewGuid()}{Path.GetExtension(filename)}");

            try
            {
                await using (var tempStream = System.IO.File.OpenWrite(tempFile))
                {
                    try
                    {
                        await Client.DownloadAsync(
                            username: username,
                            remoteFilename: filename,
                            outputStreamFactory: () => Task.FromResult<Stream>(tempStream),
                            size: size,
                            cancellationToken: cancellationToken);
                    }
                    catch (Exception)
                    {
                        return;
                    }
                }

                var inputFormat = GetFfmpegInputFormat(extension);

                using var ffmpeg = new Process();
                ffmpeg.StartInfo = new ProcessStartInfo
                {
                    FileName = FfmpegPath,
                    Arguments = $"-f {inputFormat} -i \"{tempFile}\" -c:a libmp3lame -q:a 2 -f mp3 pipe:1",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                ffmpeg.Start();

                try
                {
                    await ffmpeg.StandardOutput.BaseStream.CopyToAsync(Response.Body, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                }

                ffmpeg.Kill(entireProcessTree: true);
            }
            finally
            {
                System.IO.File.Delete(tempFile);
            }
        }

        private static string GetFfmpegInputFormat(string extension) => extension switch
        {
            "ape" => "ape",
            "wma" => "asf",
            "aiff" or "aif" => "aiff",
            "alac" => "alac",
            _ => extension,
        };

        private static void CleanupPreviewFiles()
        {
            try
            {
                if (System.IO.Directory.Exists(PreviewTempDir))
                {
                    foreach (var file in System.IO.Directory.GetFiles(PreviewTempDir, "*"))
                    {
                        try
                        {
                            System.IO.File.Delete(file);
                        }
                        catch
                        {
                        }
                    }
                }
            }
            catch
            {
            }

            lock (PreviewLock)
            {
                PreviewInProgress.Clear();
                PreviewFailed.Clear();
            }
        }

        private static string GetPreviewTempPath(string username, string filename)
        {
            var bytes = Encoding.UTF8.GetBytes($"{username}::{filename}");
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            var ext = Path.GetExtension(filename);
            return Path.Combine(PreviewTempDir, $"{hash[..16]}{ext}");
        }

        private static string GetAudioContentType(string extension) => extension switch
        {
            "mp3" => "audio/mpeg",
            "flac" => "audio/flac",
            "ogg" => "audio/ogg",
            "wav" => "audio/wav",
            "m4a" => "audio/mp4",
            "aac" => "audio/aac",
            "opus" => "audio/ogg; codecs=opus",
            "wma" => "audio/x-ms-wma",
            "aiff" or "aif" => "audio/aiff",
            _ => "audio/mpeg",
        };
    }
}
