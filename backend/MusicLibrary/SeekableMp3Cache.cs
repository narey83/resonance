// <copyright file="SeekableMp3Cache.cs" company="John Narey">
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
//   ├╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ╌ ╌╌╌ ╌
//   │ SPDX-FileCopyrightText: John Narey
//   │ SPDX-License-Identifier: AGPL-3.0-only
//   ╰───────────────────────────────────────────╶──── ─ ─── ── ──┈  ┈
// </copyright>

namespace resonance.MusicLibrary
{
    using System;
    using System.Diagnostics;
    using System.IO;
    using System.Linq;
    using System.Security.Cryptography;
    using System.Text;
    using System.Threading;
    using System.Threading.Tasks;

    /// <summary>
    ///     Keeps a bounded cache of MP3 audio remuxed into indexed MP4 files. Chromium's MP3
    ///     seek clock can disagree with the decoded samples on VBR files; MP4 sample tables
    ///     make seeks accurate without changing or re-encoding the library audio.
    /// </summary>
    public sealed class SeekableMp3Cache : IDisposable
    {
        private const long MaximumBytes = 1L << 30;
        private readonly string directory;
        private readonly Func<string, string, string, CancellationToken, Task> remux;
        private readonly SemaphoreSlim createLock = new(1, 1);

        public SeekableMp3Cache(string directory)
            : this(directory, RemuxAsync)
        {
        }

        internal SeekableMp3Cache(
            string directory,
            Func<string, string, string, CancellationToken, Task> remux)
        {
            this.directory = directory;
            this.remux = remux;
        }

        /// <summary>Opens the cached file before returning so eviction cannot interrupt a range response.</summary>
        /// <returns>An open, range-readable stream owned by the HTTP response.</returns>
        public async Task<FileStream> OpenAsync(string sourcePath, string ffmpegPath, CancellationToken cancellationToken)
        {
            var source = new FileInfo(sourcePath);
            var identity = $"{Path.GetFullPath(sourcePath)}\n{source.Length}\n{source.LastWriteTimeUtc.Ticks}";
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
            var target = Path.Combine(directory, $"{key}.mp4");

            if (File.Exists(target))
            {
                try
                {
                    return OpenCached(target);
                }
                catch (FileNotFoundException)
                {
                    // Eviction raced this cache hit. The locked path below recreates it.
                }
            }

            await createLock.WaitAsync(cancellationToken);
            try
            {
                if (!File.Exists(target))
                {
                    Directory.CreateDirectory(directory);
                    var temporary = Path.Combine(directory, $"{key}.{Guid.NewGuid():N}.tmp");
                    try
                    {
                        var started = Stopwatch.StartNew();
                        await remux(sourcePath, temporary, ffmpegPath, cancellationToken);
                        if (!File.Exists(temporary) || new FileInfo(temporary).Length == 0)
                        {
                            throw new IOException("MP3 remux produced no audio file.");
                        }

                        source.Refresh();
                        if (identity != $"{Path.GetFullPath(sourcePath)}\n{source.Length}\n{source.LastWriteTimeUtc.Ticks}")
                        {
                            throw new IOException("The source track changed during playback preparation.");
                        }

                        File.Move(temporary, target);
                        Serilog.Log.Information(
                            "Prepared indexed MP4 playback for {Path} in {ElapsedMs}ms",
                            sourcePath, started.ElapsedMilliseconds);
                    }
                    finally
                    {
                        if (File.Exists(temporary))
                        {
                            File.Delete(temporary);
                        }
                    }
                }

                var stream = OpenCached(target);
                try
                {
                    Trim(target);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    Serilog.Log.Warning(ex, "Could not trim the indexed playback cache");
                }

                return stream;
            }
            finally
            {
                createLock.Release();
            }
        }

        public void Dispose() => createLock.Dispose();

        private static FileStream OpenCached(string path)
        {
            var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                FileShare.Read | FileShare.Delete, 64 * 1024, useAsync: true);
            try
            {
                File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Playback remains valid when a cache access time cannot be updated.
            }

            return stream;
        }

        private static async Task RemuxAsync(
            string sourcePath, string targetPath, string ffmpegPath, CancellationToken cancellationToken)
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = ffmpegPath,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };
            foreach (var argument in new[]
            {
                "-nostdin", "-v", "error", "-i", sourcePath,
                "-map", "0:a:0", "-c:a", "copy", "-map_metadata", "-1",
                "-movflags", "+faststart", "-f", "mp4", targetPath,
            })
            {
                process.StartInfo.ArgumentList.Add(argument);
            }

            process.Start();
            var errors = process.StandardError.ReadToEndAsync(cancellationToken);
            try
            {
                await process.WaitForExitAsync(cancellationToken);
            }
            catch
            {
                if (!process.HasExited)
                {
                    process.Kill(entireProcessTree: true);
                }

                await process.WaitForExitAsync(CancellationToken.None);
                throw;
            }

            if (process.ExitCode != 0)
            {
                var detail = await errors;
                throw new IOException($"MP3 remux failed (exit {process.ExitCode}): {detail[..Math.Min(detail.Length, 512)]}");
            }

            await errors;
        }

        private void Trim(string protectedPath)
        {
            var files = Directory.EnumerateFiles(directory, "*.mp4")
                .Select(path => new FileInfo(path))
                .OrderBy(file => file.LastWriteTimeUtc)
                .ToArray();
            var total = files.Sum(file => file.Length);
            foreach (var file in files)
            {
                if (total <= MaximumBytes)
                {
                    break;
                }

                if (file.FullName == protectedPath)
                {
                    continue;
                }

                try
                {
                    var length = file.Length;
                    file.Delete();
                    total -= length;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // An open file may not be removable on every platform. Try another.
                }
            }
        }
    }
}
