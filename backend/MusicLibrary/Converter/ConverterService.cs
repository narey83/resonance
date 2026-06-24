// <copyright file="ConverterService.cs" company="John Narey">
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

namespace resonance.MusicLibrary.Converter;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using resonance.Common.Audio;
using resonance.Common.Ffmpeg;
using resonance.MusicLibrary.Converter.Types;
using resonance.Shares;
using Serilog;

public sealed class ConverterService : IConverterService
{
    private const int MaxErrorsRetained = 100;
    private const int MaxJobsRetained = 25;

    // Audio file types we will enumerate inside a folder and consider for conversion.
    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "aiff", "aif", "alac", "ape", "wv", "mpc",
    };

    private static readonly ILogger Log = Serilog.Log.ForContext<ConverterService>();

    private readonly IOptionsMonitor<resonance.Options> options;
    private readonly IShareService shares;
    private readonly IMusicLibraryService library;
    private readonly IFfmpegService ffmpeg;

    private readonly ConcurrentDictionary<Guid, ConverterJob> jobs = new();
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> cancellations = new();

    public ConverterService(
        IOptionsMonitor<resonance.Options> options,
        IShareService shares,
        IMusicLibraryService library,
        IFfmpegService ffmpeg)
    {
        this.options = options;
        this.shares = shares;
        this.library = library;
        this.ffmpeg = ffmpeg;
    }

    public ConverterJob Start(IEnumerable<string> filePaths, IEnumerable<string> folderPaths, string format, int quality)
    {
        if (!AudioConverter.IsConvertibleTarget(format))
        {
            throw new ArgumentException($"'{format}' is not a supported conversion target.", nameof(format));
        }

        var shareDirs = GetShareDirectories();

        // Resolve the working set: explicit files + every audio file under each folder (recursive).
        // Everything is constrained to a configured share directory and to files that actually
        // need converting (i.e. not already in the target format).
        var files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var file in filePaths ?? Enumerable.Empty<string>())
        {
            var full = SafeFullPath(file);
            if (full != null && IsWithinShare(full, shareDirs) && File.Exists(full))
            {
                files.Add(full);
            }
        }

        foreach (var folder in folderPaths ?? Enumerable.Empty<string>())
        {
            var full = SafeFullPath(folder);
            if (full == null || !IsWithinShare(full, shareDirs) || !Directory.Exists(full))
            {
                continue;
            }

            foreach (var file in EnumerateAudioFiles(full))
            {
                files.Add(file);
            }
        }

        var toConvert = files
            .Where(f => AudioConverter.NeedsConversion(f, format))
            .ToList();

        var job = new ConverterJob
        {
            Format = format,
            Quality = Math.Clamp(quality, 0, 9),
            Total = toConvert.Count,
        };

        jobs[job.Id] = job;
        TrimJobs();

        if (toConvert.Count == 0)
        {
            job.State = ConverterJobState.Completed;
            job.CompletedAt = DateTime.UtcNow;
            return job;
        }

        var cts = new CancellationTokenSource();
        cancellations[job.Id] = cts;
        _ = Task.Run(() => RunAsync(job, toConvert, cts.Token), CancellationToken.None);

        return job;
    }

    public ConverterJob? Get(Guid id) => jobs.TryGetValue(id, out var job) ? job : null;

    public IReadOnlyList<ConverterJob> List() => jobs.Values.OrderByDescending(j => j.StartedAt).ToList();

    public void Cancel(Guid id)
    {
        if (cancellations.TryGetValue(id, out var cts))
        {
            try
            {
                cts.Cancel();
            }
            catch
            {
                // already disposed
            }
        }
    }

    private async Task RunAsync(ConverterJob job, IReadOnlyList<string> files, CancellationToken cancellationToken)
    {
        var affectedDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var ffmpegPath = await ffmpeg.GetFfmpegPathAsync(cancellationToken);

            foreach (var source in files)
            {
                cancellationToken.ThrowIfCancellationRequested();

                job.CurrentFile = Path.GetFileName(source);

                if (!File.Exists(source))
                {
                    job.Skipped++;
                    continue;
                }

                var result = await AudioConverter.ConvertAsync(ffmpegPath, source, job.Format, job.Quality, cancellationToken);

                if (result.Success && result.DestinationPath != null)
                {
                    try
                    {
                        File.Delete(source);
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Converter: converted {File} but could not remove original: {Error}", source, ex.Message);
                    }

                    try
                    {
                        shares.RemoveLocalPath(source);
                    }
                    catch
                    {
                        // non-fatal; the directory rescan below reconciles the share cache
                    }

                    var dir = Path.GetDirectoryName(result.DestinationPath);
                    if (dir != null)
                    {
                        affectedDirectories.Add(dir);
                    }

                    job.Converted++;
                }
                else
                {
                    job.Failed++;
                    AddError(job, $"{Path.GetFileName(source)}: {result.Error}");
                    Log.Warning("Converter: failed to convert {File} to {Format}: {Error}", source, job.Format, result.Error);
                }
            }
        }
        catch (OperationCanceledException)
        {
            job.State = ConverterJobState.Cancelled;
            Log.Information("Converter: job {Id} cancelled after {Done}/{Total}", job.Id, job.Converted, job.Total);
        }
        catch (Exception ex)
        {
            AddError(job, $"Conversion run failed: {ex.Message}");
            Log.Error(ex, "Converter: job {Id} failed: {Message}", job.Id, ex.Message);
        }
        finally
        {
            job.CurrentFile = null;
            if (job.State == ConverterJobState.Running)
            {
                job.State = ConverterJobState.Completed;
            }

            job.CompletedAt = DateTime.UtcNow;

            // Re-index the freshly-converted files: rescan the affected share directories and
            // trigger a music-library sync so the new paths replace the old ones.
            if (affectedDirectories.Count > 0)
            {
                try
                {
                    await shares.ScanDirectoriesAsync(affectedDirectories);
                }
                catch (ShareScanInProgressException)
                {
                    // a scan is already running — it will pick up the changes
                }
                catch (Exception ex)
                {
                    Log.Warning("Converter: share rescan after job {Id} failed: {Error}", job.Id, ex.Message);
                }

                library.TriggerImmediateSync();
            }

            cancellations.TryRemove(job.Id, out var cts);
            cts?.Dispose();
        }
    }

    private static void AddError(ConverterJob job, string message)
    {
        if (job.Errors.Count < MaxErrorsRetained)
        {
            job.Errors.Add(message);
        }
    }

    private void TrimJobs()
    {
        if (jobs.Count <= MaxJobsRetained)
        {
            return;
        }

        foreach (var stale in jobs.Values
            .Where(j => j.State != ConverterJobState.Running)
            .OrderBy(j => j.StartedAt)
            .Take(jobs.Count - MaxJobsRetained))
        {
            jobs.TryRemove(stale.Id, out _);
        }
    }

    private static IEnumerable<string> EnumerateAudioFiles(string directory)
    {
        IEnumerable<string> entries;
        try
        {
            entries = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories);
        }
        catch (Exception ex)
        {
            Log.Warning("Converter: could not enumerate {Directory}: {Error}", directory, ex.Message);
            yield break;
        }

        foreach (var file in entries)
        {
            var ext = Path.GetExtension(file).TrimStart('.');
            if (AudioExtensions.Contains(ext))
            {
                yield return file;
            }
        }
    }

    private IReadOnlyList<string> GetShareDirectories()
        => options.CurrentValue.Shares.Directories
            .Select(d => SafeFullPath(new Share(d.TrimEnd('/', '\\')).LocalPath))
            .Where(p => p != null && Directory.Exists(p))
            .Select(p => p!)
            .ToList();

    private static bool IsWithinShare(string fullPath, IReadOnlyList<string> shareDirs)
        => shareDirs.Any(shareDir =>
            fullPath.StartsWith(shareDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || string.Equals(fullPath, shareDir, StringComparison.OrdinalIgnoreCase));

    private static string? SafeFullPath(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return null;
        }
    }
}
