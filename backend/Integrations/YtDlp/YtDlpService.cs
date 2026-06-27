// <copyright file="YtDlpService.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using resonance.Common.Audio;
using Resonance.Integrations.YtDlp.API.Hubs;
using Resonance.Integrations.YtDlp.Data;
using Resonance.Integrations.YtDlp.Types;
using resonance.MusicLibrary;
using Serilog;

public sealed class YtDlpService : IYtDlpService, IDisposable
{
    private const int EventBufferMax = 500;

    private static readonly ILogger Log = Serilog.Log.ForContext<YtDlpService>();

    private readonly IOptionsMonitor<resonance.Options> options;
    private readonly IHubContext<YtDlpHub> hub;
    private readonly IMusicLibraryService library;
    private readonly resonance.Shares.IShareService shares;
    private readonly IDbContextFactory<YtDlpDbContext> dbFactory;
    private readonly IHttpClientFactory httpClientFactory;
    private readonly resonance.Common.Ffmpeg.IFfmpegService ffmpeg;

    private readonly ConcurrentDictionary<Guid, YtDlpJob> jobs = new();
    private readonly ConcurrentDictionary<Guid, Process> processes = new();
    private readonly ConcurrentQueue<YtDlpEvent> eventBuffer = new();
    private readonly ConcurrentDictionary<Guid, YtDlpSubscription> subscriptions = new();
    private readonly SemaphoreSlim subscriptionCheckLock = new(1, 1);
    private SemaphoreSlim workerSlots;
    private CancellationTokenSource cts = new();
    private string? jsRuntimeArg;

    public YtDlpService(
        IOptionsMonitor<resonance.Options> options,
        IHubContext<YtDlpHub> hub,
        IMusicLibraryService library,
        resonance.Shares.IShareService shares,
        IDbContextFactory<YtDlpDbContext> dbFactory,
        IHttpClientFactory httpClientFactory,
        resonance.Common.Ffmpeg.IFfmpegService ffmpeg)
    {
        this.options = options;
        this.hub = hub;
        this.library = library;
        this.shares = shares;
        this.dbFactory = dbFactory;
        this.httpClientFactory = httpClientFactory;
        this.ffmpeg = ffmpeg;
        workerSlots = new SemaphoreSlim(options.CurrentValue.Integrations.YtDlp.MaxConcurrentDownloads);
    }

    // ── IHostedService ──────────────────────────────────────────────────────
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        jsRuntimeArg = await DetectJsRuntimeAsync();
        if (jsRuntimeArg != null)
        {
            Log.Information("YtDlp: using JS runtime {Arg}", jsRuntimeArg);
        }
        else
        {
            Log.Warning("YtDlp: no JS runtime found — some YouTube videos may fail to download");
        }

        // The staging root lives inside the shared/library music tree, so register it as a
        // system-managed share exclusion and keep the library scanner away from partial files
        var stagingRoot = GetStagingRoot();
        try
        {
            Directory.CreateDirectory(stagingRoot);
        }
        catch (Exception ex)
        {
            Log.Warning("YtDlp: could not create staging root {Path}: {Message}", stagingRoot, ex.Message);
        }

        shares.SetManagedShare(stagingRoot, "yt-dlp-staging", isExcluded: true);
        library.ExcludeFromSync(stagingRoot);
        Log.Information("YtDlp: staging directory is {Path} (excluded from shares and library)", stagingRoot);

        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        // Reset any tracks that were in-progress when the app last shut down
        var stuckTracks = await db.Tracks
            .Where(t => t.State == YtDlpTrackState.InProgress)
            .ToListAsync(cancellationToken);

        foreach (var t in stuckTracks)
        {
            t.State = YtDlpTrackState.Queued;
        }

        if (stuckTracks.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        // Load all jobs into the hot cache
        var allJobs = await db.Jobs.OrderByDescending(j => j.RequestedAt).ToListAsync(cancellationToken);

        foreach (var job in allJobs)
        {
            jobs[job.Id] = job;

            if (job.State != YtDlpJobState.Enumerating && job.State != YtDlpJobState.Active)
            {
                continue;
            }

            var tracks = await db.Tracks
                .Where(t => t.JobId == job.Id && t.State == YtDlpTrackState.Queued)
                .ToListAsync(cancellationToken);

            // If no pending tracks remain, the job finished while the service was down — close it out
            var hasPending = tracks.Count > 0 || await db.Tracks
                .AnyAsync(t => t.JobId == job.Id && t.State == YtDlpTrackState.InProgress, cancellationToken);

            if (!hasPending)
            {
                Log.Information("YtDlp: job {Title} had no pending tracks on resume — finalizing", job.Title ?? job.Url);
                await FinalizeJobAsync(job, db, cancellationToken);
                continue;
            }

            job.State = YtDlpJobState.Active;
            foreach (var track in tracks)
            {
                _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
            }
        }

        if (allJobs.Count > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        // Load channel subscriptions into the hot cache and start the poll loop
        var allSubs = await db.Subscriptions.OrderByDescending(s => s.CreatedAt).ToListAsync(cancellationToken);
        foreach (var sub in allSubs)
        {
            subscriptions[sub.Id] = sub;
        }

        _ = Task.Run(() => RunSubscriptionPollLoopAsync(cts.Token), CancellationToken.None);
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        cts.Cancel();
        foreach (var p in processes.Values)
        {
            try
            {
                p.Kill(entireProcessTree: true);
            }
            catch
            {
            }
        }

        return Task.CompletedTask;
    }

    // ── Public API ──────────────────────────────────────────────────────────
    public IReadOnlyList<YtDlpJob> ListJobs()
        => jobs.Values.OrderByDescending(j => j.RequestedAt).ToList();

    public IReadOnlyList<YtDlpEvent> GetRecentEvents() => eventBuffer.ToArray();

    public async Task<YtDlpJob> SubmitAsync(string url, string? outputDirectory = null, string? audioFormat = null, int? audioQuality = null, string? defaultGenre = null, int? minTrackDurationSeconds = null, int? maxTrackDurationSeconds = null, string? convertOnCompletionFormat = null, string? uploadedAfter = null, CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var outDir = !string.IsNullOrWhiteSpace(outputDirectory) ? outputDirectory
            : !string.IsNullOrWhiteSpace(opts.OutputDirectory) ? opts.OutputDirectory
            : options.CurrentValue.Directories.Downloads;

        var job = new YtDlpJob
        {
            Url = url,
            OutputDirectory = outDir,
            StartedAt = DateTime.UtcNow,
            AudioFormatOverride = audioFormat,
            AudioQualityOverride = audioQuality,
            DefaultGenreOverride = defaultGenre,
            MinTrackDurationSecondsOverride = minTrackDurationSeconds,
            MaxTrackDurationSecondsOverride = maxTrackDurationSeconds,
            ConvertOnCompletionFormatOverride = convertOnCompletionFormat,
            UploadedAfterOverride = uploadedAfter,
        };
        jobs[job.Id] = job;

        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        db.Jobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);

        await BroadcastJobsAsync();
        await EmitEventAsync(job.Id, "info", $"Submitted: {url}", job);

        _ = Task.Run(() => RunJobAsync(job, cts.Token), CancellationToken.None);

        return job;
    }

    public async Task<IReadOnlyList<YtDlpTrack>> GetTracksAsync(Guid jobId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.Tracks.Where(t => t.JobId == jobId).OrderBy(t => t.PlaylistIndex).ToListAsync();
    }

    public async Task<IReadOnlyList<YtDlpTrack>> GetTagErrorTracksAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        return await db.Tracks
            .Where(t => t.TagWritingError != null)
            .OrderByDescending(t => t.CompletedAt)
            .ToListAsync();
    }

    public async Task CancelJobAsync(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job))
        {
            return;
        }

        if (job.State is YtDlpJobState.Completed or YtDlpJobState.Failed or YtDlpJobState.Cancelled)
        {
            return;
        }

        // Graceful stop: queued tracks are cancelled, but in-flight downloads run to
        // completion so finished work is never discarded. The job finalizes (completed
        // files moved to the output directory, staging leftovers removed) once the last
        // in-flight track ends — immediately, if nothing is in flight.
        job.State = YtDlpJobState.Cancelled;
        job.CompletedAt = DateTime.UtcNow;

        await using var db = await dbFactory.CreateDbContextAsync();
        var tracks = await db.Tracks.Where(t => t.JobId == jobId).ToListAsync();

        foreach (var track in tracks.Where(t => t.State == YtDlpTrackState.Queued))
        {
            track.State = YtDlpTrackState.Cancelled;
        }

        var dbJob = await db.Jobs.FindAsync(jobId);
        if (dbJob != null)
        {
            dbJob.State = job.State;
            dbJob.CompletedAt = job.CompletedAt;
        }

        await db.SaveChangesAsync();

        var inFlight = tracks.Count(t => t.State == YtDlpTrackState.InProgress);

        var stopMessage = inFlight > 0
            ? $"Stopped — letting {inFlight} in-flight track(s) finish: {job.Title ?? job.Url}"
            : $"Stopped: {job.Title ?? job.Url}";

        await BroadcastJobsAsync();
        await EmitEventAsync(jobId, "warning", stopMessage, job);

        if (inFlight == 0)
        {
            await FinalizeJobAsync(job, db);
        }
    }

    public async Task PauseJobAsync(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job) || job.State != YtDlpJobState.Active)
        {
            return;
        }

        // Graceful pause: no new tracks start (workers check this state before downloading),
        // but in-flight downloads run to completion so finished work is never discarded
        job.State = YtDlpJobState.Paused;

        await using var db = await dbFactory.CreateDbContextAsync();
        var inFlight = await db.Tracks
            .CountAsync(t => t.JobId == jobId && t.State == YtDlpTrackState.InProgress);

        var dbJob = await db.Jobs.FindAsync(jobId);
        if (dbJob != null)
        {
            dbJob.State = YtDlpJobState.Paused;
        }

        await db.SaveChangesAsync();

        var pauseMessage = inFlight > 0
            ? $"Paused — letting {inFlight} in-flight track(s) finish: {job.Title ?? job.Url}"
            : $"Paused: {job.Title ?? job.Url}";

        await BroadcastJobsAsync();
        await EmitEventAsync(jobId, "warning", pauseMessage, job);
    }

    public async Task ResumeJobAsync(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job) || job.State != YtDlpJobState.Paused)
        {
            return;
        }

        job.State = YtDlpJobState.Active;

        await using var db = await dbFactory.CreateDbContextAsync();
        var dbJob = await db.Jobs.FindAsync(jobId);
        if (dbJob != null)
        {
            dbJob.State = YtDlpJobState.Active;
        }

        var queued = await db.Tracks
            .Where(t => t.JobId == jobId && t.State == YtDlpTrackState.Queued)
            .ToListAsync();

        await db.SaveChangesAsync();
        await BroadcastJobsAsync();
        await EmitEventAsync(jobId, "info", $"Resumed ({queued.Count} track(s) queued): {job.Title ?? job.Url}", job);

        foreach (var track in queued)
        {
            _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
        }
    }

    public async Task CancelTrackAsync(Guid trackId)
    {
        if (processes.TryRemove(trackId, out var process))
        {
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
            }
        }

        await using var db = await dbFactory.CreateDbContextAsync();
        var track = await db.Tracks.FindAsync(trackId);
        if (track is null)
        {
            return;
        }

        track.State = YtDlpTrackState.Cancelled;
        await db.SaveChangesAsync();

        if (jobs.TryGetValue(track.JobId, out var job))
        {
            await BroadcastJobsAsync();
        }
    }

    public async Task RemoveJobAsync(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job))
        {
            return;
        }

        // Removing is the hard discard: kill live downloads and delete staged files.
        // Mark cancelled first so workers and failure handlers stand down.
        job.State = YtDlpJobState.Cancelled;

        await using var db = await dbFactory.CreateDbContextAsync();
        var tracks = await db.Tracks.Where(t => t.JobId == jobId).ToListAsync();

        foreach (var track in tracks)
        {
            if (processes.TryRemove(track.Id, out var process))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch
                {
                }
            }
        }

        jobs.TryRemove(jobId, out _);

        db.Tracks.RemoveRange(tracks);
        var dbJob = await db.Jobs.FindAsync(jobId);
        if (dbJob != null)
        {
            db.Jobs.Remove(dbJob);
        }

        await db.SaveChangesAsync();

        var stagingDir = GetStagingDirectory(jobId);
        try
        {
            Directory.Delete(stagingDir, recursive: true);
        }
        catch
        {
        }

        await BroadcastJobsAsync();
    }

    public async Task RetryFailedTracksAsync(Guid jobId)
    {
        if (!jobs.TryGetValue(jobId, out var job))
        {
            return;
        }

        await using var db = await dbFactory.CreateDbContextAsync();
        var failed = await db.Tracks
            .Where(t => t.JobId == jobId && t.State == YtDlpTrackState.Failed)
            .ToListAsync();

        foreach (var track in failed)
        {
            track.State = YtDlpTrackState.Queued;
            track.AttemptCount = 0;
            track.Error = null;
        }

        job.FailedTracks -= failed.Count;
        job.State = YtDlpJobState.Active;
        await db.SaveChangesAsync();
        await BroadcastJobsAsync();
        await EmitEventAsync(jobId, "info", $"Retrying {failed.Count} failed track(s): {job.Title ?? job.Url}", job);

        foreach (var track in failed)
        {
            _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
        }
    }

    public async Task RetryTagWritingAsync(Guid trackId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var track = await db.Tracks.FindAsync(trackId);

        if (track is null || track.State != YtDlpTrackState.Completed || track.FilePath is null)
        {
            return;
        }

        if (!File.Exists(track.FilePath))
        {
            track.TagWritingError = "File no longer exists on disk.";
            await db.SaveChangesAsync();
            await BroadcastJobsAsync();
            return;
        }

        var opts = options.CurrentValue.Integrations.YtDlp;
        var metadata = YtDlpMetadataParser.Parse(track.Title, track.Uploader, track.PlaylistIndex, track.UploadDate, opts.DefaultGenre);
        var error = YtDlpTagWriter.Write(track.FilePath, metadata, track.Url, out _);

        if (jobs.TryGetValue(track.JobId, out var job))
        {
            if (error is null && track.TagWritingError != null)
            {
                job.TagFailedTracks = Math.Max(0, job.TagFailedTracks - 1);
            }
            else if (error != null && track.TagWritingError is null)
            {
                job.TagFailedTracks++;
            }
        }

        track.TagWritingError = error;
        await db.SaveChangesAsync();
        await BroadcastJobsAsync();
    }

    public async Task<IReadOnlyList<YtDlpSearchResult>> SearchAsync(string query, int limit = 25, string? type = null, string? duration = null, string? uploadDate = null, string? sortBy = null, CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var results = new List<YtDlpSearchResult>();

        var searchUrl = $"https://www.youtube.com/results?search_query={Uri.EscapeDataString(query)}";
        var sp = BuildSearchFilterParam(type, duration, uploadDate, sortBy);
        if (sp != null)
        {
            searchUrl += $"&sp={Uri.EscapeDataString(sp)}";
        }

        var args = new System.Text.StringBuilder($"--flat-playlist --dump-json -I 1:{limit}");
        if (jsRuntimeArg != null)
        {
            args.Append($" {jsRuntimeArg}");
        }

        var cookieFile = AcquireCookieFile();
        if (cookieFile != null)
        {
            args.Append($" --cookies \"{cookieFile}\"");
        }

        args.Append($" \"{searchUrl}\"");

        var process = new Process
        {
            StartInfo = new ProcessStartInfo(opts.ExecutablePath)
            {
                Arguments = args.ToString(),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };

        try
        {
            process.Start();

            // Read stderr concurrently — if unread, the pipe buffer fills and the process deadlocks
            var stderr = new System.Text.StringBuilder();
            var stderrTask = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync(CancellationToken.None)) != null)
                {
                    stderr.AppendLine(errLine);
                }
            }, CancellationToken.None);

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(cancellationToken)) != null)
            {
                var result = ParseSearchResult(line);
                if (result != null)
                {
                    results.Add(result);
                }
            }

            await Task.WhenAll(process.WaitForExitAsync(cancellationToken), stderrTask);

            if (results.Count == 0 && process.ExitCode != 0)
            {
                Log.Warning("YtDlp: search for \"{Query}\" failed (exit {ExitCode}): {Stderr}", query, process.ExitCode, stderr.ToString().Trim());
            }

            return results;
        }
        finally
        {
            ReleaseCookieFile(cookieFile);
        }
    }

    // YouTube's sp parameter is a base64 protobuf: field 1 = sort order,
    // field 2 = embedded filter message { 1: upload date, 2: type, 3: duration }
    private static string? BuildSearchFilterParam(string? type, string? duration, string? uploadDate, string? sortBy)
    {
        var sort = sortBy switch { "rating" => 1, "date" => 2, "views" => 3, _ => 0 };
        var dateValue = uploadDate switch { "hour" => 1, "today" => 2, "week" => 3, "month" => 4, "year" => 5, _ => 0 };
        var typeValue = type switch { "video" => 1, "channel" => 2, "playlist" => 3, "movie" => 4, _ => 0 };
        var durationValue = duration switch { "short" => 1, "long" => 2, "medium" => 3, _ => 0 };

        if (sort == 0 && dateValue == 0 && typeValue == 0 && durationValue == 0)
        {
            return null;
        }

        var filters = new List<byte>();
        if (dateValue > 0)
        {
            filters.Add(0x08);
            filters.Add((byte)dateValue);
        }

        if (typeValue > 0)
        {
            filters.Add(0x10);
            filters.Add((byte)typeValue);
        }

        if (durationValue > 0)
        {
            filters.Add(0x18);
            filters.Add((byte)durationValue);
        }

        var bytes = new List<byte>();
        if (sort > 0)
        {
            bytes.Add(0x08);
            bytes.Add((byte)sort);
        }

        if (filters.Count > 0)
        {
            bytes.Add(0x12);
            bytes.Add((byte)filters.Count);
            bytes.AddRange(filters);
        }

        return Convert.ToBase64String(bytes.ToArray());
    }

    public async Task<(string? YtDlpVersion, string? FfmpegVersion)> GetVersionsAsync(CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var ytdlpVersion = await RunVersionCommandAsync(opts.ExecutablePath, "--version", cancellationToken);
        var ffmpegVersion = await ffmpeg.GetVersionAsync(cancellationToken);
        return (ytdlpVersion, ffmpegVersion);
    }

    public async Task<(string? Current, string? Latest, bool UpdateAvailable)> CheckForUpdateAsync(CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var current = await RunVersionCommandAsync(opts.ExecutablePath, "--version", cancellationToken);

        try
        {
            using var http = httpClientFactory.CreateClient();
            http.DefaultRequestHeaders.Add("User-Agent", "resonance");
            var release = await http.GetFromJsonAsync<JsonElement>(
                "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", cancellationToken);
            var latest = release.GetProperty("tag_name").GetString()?.Trim();
            var updateAvailable = !string.IsNullOrEmpty(current) && !string.IsNullOrEmpty(latest)
                && current.Trim() != latest;
            return (current?.Trim(), latest, updateAvailable);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "YtDlp: failed to check for updates from GitHub");
            return (current?.Trim(), null, false);
        }
    }

    public async Task<string> UpdateYtDlpAsync(CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;

        // Resolve the full path if only a bare name was given (e.g. "yt-dlp")
        var execPath = opts.ExecutablePath;
        if (!Path.IsPathRooted(execPath))
        {
            var which = await RunVersionCommandAsync(RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "where" : "which", execPath, cancellationToken);
            if (!string.IsNullOrWhiteSpace(which))
            {
                execPath = which.Split('\n', StringSplitOptions.RemoveEmptyEntries)[0].Trim();
            }
        }

        // Fetch latest release from GitHub
        using var http = httpClientFactory.CreateClient();
        http.DefaultRequestHeaders.Add("User-Agent", "resonance");
        var release = await http.GetFromJsonAsync<JsonElement>(
            "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", cancellationToken);
        var tag = release.GetProperty("tag_name").GetString()
            ?? throw new InvalidOperationException("Could not determine latest yt-dlp version.");

        var assetName = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "yt-dlp.exe" : "yt-dlp";
        var downloadUrl = $"https://github.com/yt-dlp/yt-dlp/releases/download/{tag}/{assetName}";

        Log.Information("YtDlp: downloading {Version} from {Url}", tag, downloadUrl);

        var bytes = await http.GetByteArrayAsync(downloadUrl, cancellationToken);
        var tempPath = execPath + ".tmp";
        await File.WriteAllBytesAsync(tempPath, bytes, cancellationToken);

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            var chmod = new Process { StartInfo = new ProcessStartInfo("chmod", $"+x \"{tempPath}\"") { UseShellExecute = false, CreateNoWindow = true } };
            chmod.Start();
            await chmod.WaitForExitAsync(cancellationToken);
        }

        File.Move(tempPath, execPath, overwrite: true);
        Log.Information("YtDlp: updated to {Version}", tag);
        return tag;
    }

    // ── Job execution ────────────────────────────────────────────────────────
    private async Task RunJobAsync(YtDlpJob job, CancellationToken cancellationToken)
    {
        var opts = ApplyJobOverrides(options.CurrentValue.Integrations.YtDlp, job);

        try
        {
            Log.Information("YtDlp: enumerating {Url}", job.Url);
            await EmitEventAsync(job.Id, "info", $"Enumerating: {job.Url}", job);

            var process = new Process
            {
                StartInfo = new ProcessStartInfo(opts.ExecutablePath)
                {
                    Arguments = $"--flat-playlist --dump-json{(jsRuntimeArg != null ? " " + jsRuntimeArg : string.Empty)} \"{job.Url}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };

            process.Start();

            // Read stderr concurrently — if unread, the pipe buffer fills and the process deadlocks
            var stderrTask = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync(CancellationToken.None)) != null)
                {
                    if (!string.IsNullOrWhiteSpace(errLine))
                    {
                        await hub.BroadcastJobLogAsync(job.Id, errLine, isError: false);
                        await EmitEventAsync(job.Id, "raw", errLine, job);
                    }
                }
            }, CancellationToken.None);

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(cancellationToken)) != null)
            {
                // Stopped or removed mid-enumeration — kill the enumerator and stop adding tracks
                if (job.State == YtDlpJobState.Cancelled || !jobs.ContainsKey(job.Id))
                {
                    try
                    {
                        process.Kill(entireProcessTree: true);
                    }
                    catch
                    {
                    }

                    break;
                }

                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                var track = await ParseAndInsertTrackAsync(job, line, opts, cancellationToken);
                if (track != null)
                {
                    await EmitEventAsync(job.Id, "info", $"Found: {track.Title}", job);
                    _ = Task.Run(() => RunWorkerAsync(track, cancellationToken), CancellationToken.None);
                }
            }

            await Task.WhenAll(process.WaitForExitAsync(cancellationToken), stderrTask);

            if (job.State == YtDlpJobState.Cancelled || !jobs.ContainsKey(job.Id))
            {
                return;
            }

            await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
            var dbJob = await db.Jobs.FindAsync([job.Id], cancellationToken);
            if (dbJob != null)
            {
                dbJob.State = YtDlpJobState.Active;
                await db.SaveChangesAsync(cancellationToken);
            }

            job.State = YtDlpJobState.Active;
            await BroadcastJobsAsync();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log.Error(ex, "YtDlp: enumeration failed for {Url}", job.Url);
            job.State = YtDlpJobState.Failed;
            job.CompletedAt = DateTime.UtcNow;

            await using var db = await dbFactory.CreateDbContextAsync(CancellationToken.None);
            var dbJob = await db.Jobs.FindAsync(job.Id);
            if (dbJob != null)
            {
                dbJob.State = job.State;
                dbJob.CompletedAt = job.CompletedAt;
                await db.SaveChangesAsync();
            }

            await BroadcastJobsAsync();
            await EmitEventAsync(job.Id, "error", $"Enumeration failed: {ex.Message}", job);
        }
    }

    private async Task<YtDlpTrack?> ParseAndInsertTrackAsync(YtDlpJob job, string json, resonance.Options.IntegrationsOptions.YtDlpOptions opts, CancellationToken cancellationToken)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var videoId = root.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? string.Empty : string.Empty;
            var url = root.TryGetProperty("url", out var urlProp) ? urlProp.GetString() ?? string.Empty : string.Empty;
            var title = root.TryGetProperty("title", out var titleProp) ? titleProp.GetString() ?? string.Empty : string.Empty;
            var uploader = root.TryGetProperty("uploader", out var uploaderProp) ? uploaderProp.GetString() ?? string.Empty : string.Empty;
            var thumbnail = root.TryGetProperty("thumbnail", out var thumbProp) ? thumbProp.GetString() : null;
            var duration = root.TryGetProperty("duration", out var durProp) && durProp.TryGetInt32(out var dur) ? (int?)dur : null;
            var playlistIndex = root.TryGetProperty("playlist_index", out var idxProp) && idxProp.TryGetInt32(out var idx) ? (int?)idx : null;

            // If the URL is just a video ID, build the full URL
            if (!url.StartsWith("http") && videoId.Length > 0)
            {
                url = $"https://www.youtube.com/watch?v={videoId}";
            }

            // Populate job title/uploader from first track if not set
            if (string.IsNullOrEmpty(job.Title) && !string.IsNullOrEmpty(uploader))
            {
                job.Title = uploader;
                job.Uploader = uploader;
                job.ThumbnailUrl = thumbnail;
            }

            await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

            YtDlpTrackState initialState = YtDlpTrackState.Queued;

            // Duration filter (only when duration is known)
            string? skipReason = null;
            if (duration.HasValue)
            {
                if (opts.MinTrackDurationSeconds > 0 && duration.Value < opts.MinTrackDurationSeconds)
                {
                    initialState = YtDlpTrackState.Skipped;
                    skipReason = $"too short ({FormatDuration(duration.Value)} < {FormatDuration(opts.MinTrackDurationSeconds)} min)";
                }
                else if (opts.MaxTrackDurationSeconds > 0 && duration.Value > opts.MaxTrackDurationSeconds)
                {
                    initialState = YtDlpTrackState.Skipped;
                    skipReason = $"too long ({FormatDuration(duration.Value)} > {FormatDuration(opts.MaxTrackDurationSeconds)} max)";
                }
            }

            // Duplicate detection
            if (initialState == YtDlpTrackState.Queued && opts.SkipExistingFiles && !string.IsNullOrEmpty(videoId))
            {
                var exists = await db.Tracks
                    .AnyAsync(t => t.VideoId == videoId && t.State == YtDlpTrackState.Completed, cancellationToken);

                if (exists)
                {
                    initialState = YtDlpTrackState.Skipped;
                    skipReason = "already downloaded";
                }
            }

            if (skipReason != null)
            {
                await EmitEventAsync(job.Id, "info", $"Skipped ({skipReason}): {title}", job);
            }

            var track = new YtDlpTrack
            {
                JobId = job.Id,
                VideoId = videoId,
                Url = url,
                Title = title,
                Uploader = uploader,
                ThumbnailUrl = thumbnail,
                Duration = duration,
                PlaylistIndex = playlistIndex,
                State = initialState,
                Error = skipReason,
            };

            db.Tracks.Add(track);

            // Update job counters
            var dbJob = await db.Jobs.FindAsync([job.Id], cancellationToken);
            if (dbJob != null)
            {
                dbJob.TotalTracks++;
                if (initialState == YtDlpTrackState.Skipped)
                {
                    dbJob.SkippedTracks++;
                }
            }

            job.TotalTracks++;
            if (initialState == YtDlpTrackState.Skipped)
            {
                job.SkippedTracks++;
            }

            await db.SaveChangesAsync(cancellationToken);
            await BroadcastJobsAsync();

            return initialState == YtDlpTrackState.Queued ? track : null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "YtDlp: failed to parse track entry from enumeration");
            return null;
        }
    }

    private async Task RunWorkerAsync(YtDlpTrack track, CancellationToken cancellationToken)
    {
        jobs.TryGetValue(track.JobId, out var jobForOpts);
        var opts = ApplyJobOverrides(options.CurrentValue.Integrations.YtDlp, jobForOpts ?? new YtDlpJob());

        await workerSlots.WaitAsync(cancellationToken);
        try
        {
            await DownloadTrackAsync(track, opts, cancellationToken);
        }
        finally
        {
            workerSlots.Release();
        }
    }

    private async Task DownloadTrackAsync(YtDlpTrack track, resonance.Options.IntegrationsOptions.YtDlpOptions opts, CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(CancellationToken.None);
        var dbTrack = await db.Tracks.FindAsync([track.Id], CancellationToken.None);
        if (dbTrack is null || dbTrack.State == YtDlpTrackState.Cancelled)
        {
            return;
        }

        // Job was paused or stopped while this worker waited for a slot — don't start new work
        if (jobs.TryGetValue(track.JobId, out var jobAtStart)
            && jobAtStart.State is YtDlpJobState.Paused or YtDlpJobState.Cancelled)
        {
            return;
        }

        dbTrack.State = YtDlpTrackState.InProgress;
        dbTrack.AttemptCount++;
        dbTrack.StartedAt = DateTime.UtcNow;
        track.State = YtDlpTrackState.InProgress;
        track.AttemptCount = dbTrack.AttemptCount;

        if (jobs.TryGetValue(track.JobId, out var job))
        {
            job.CurrentTrackTitle = track.Title;
        }

        var downloadMessage = track.AttemptCount > 1
            ? $"Downloading (attempt {track.AttemptCount}/{opts.MaxRetryAttempts}): {track.Title}"
            : $"Downloading: {track.Title}";

        await db.SaveChangesAsync(CancellationToken.None);
        await BroadcastJobsAsync();
        await EmitEventAsync(track.JobId, "info", downloadMessage, job);

        var stagingDir = GetStagingDirectory(track.JobId);
        Directory.CreateDirectory(stagingDir);
        var outputTemplate = Path.Combine(stagingDir, opts.OutputTemplate + ".%(ext)s");

        var cookieFile = AcquireCookieFile();
        var ffmpegLocation = Path.GetDirectoryName(await ffmpeg.GetFfmpegPathAsync(cancellationToken)) ?? string.Empty;
        var args = BuildDownloadArgs(track.Url, opts, outputTemplate, cookieFile, ffmpegLocation);

        var process = new Process
        {
            StartInfo = new ProcessStartInfo(opts.ExecutablePath)
            {
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };

        processes[track.Id] = process;
        string? resolvedFilePath = null;
        bool filteredByDuration = false;
        string? stderrError = null;

        try
        {
            process.Start();

            // Read stderr concurrently — if unread, the pipe buffer fills and the process deadlocks
            var stderrTask = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync(CancellationToken.None)) != null)
                {
                    if (!string.IsNullOrWhiteSpace(errLine))
                    {
                        if (errLine.Contains("age-restricted", StringComparison.OrdinalIgnoreCase) ||
                            errLine.Contains("Sign in to confirm your age", StringComparison.OrdinalIgnoreCase))
                        {
                            stderrError = "Age-restricted — upload a YouTube cookie file in Settings";
                        }

                        await hub.BroadcastJobLogAsync(track.JobId, errLine, isError: false);
                        await EmitEventAsync(track.JobId, "raw", errLine, job);
                    }
                }
            }, CancellationToken.None);

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(cancellationToken)) != null)
            {
                if (line.StartsWith("download:", StringComparison.OrdinalIgnoreCase))
                {
                    await HandleProgressLineAsync(track, line[9..]);
                }
                else if (line.StartsWith("[download] Destination:", StringComparison.OrdinalIgnoreCase))
                {
                    resolvedFilePath = line["[download] Destination:".Length..].Trim();
                }
                else if (line.StartsWith("[ExtractAudio] Destination:", StringComparison.OrdinalIgnoreCase))
                {
                    resolvedFilePath = line["[ExtractAudio] Destination:".Length..].Trim();
                }
                else if (line.StartsWith("[download] ", StringComparison.OrdinalIgnoreCase)
                    && line.Contains(" has already been downloaded", StringComparison.OrdinalIgnoreCase))
                {
                    // A previous attempt (killed by pause/stop/shutdown) left the finished file
                    // behind — adopt it instead of treating the track as having no output
                    var endIdx = line.IndexOf(" has already been downloaded", StringComparison.OrdinalIgnoreCase);
                    resolvedFilePath = line["[download] ".Length..endIdx].Trim();
                }
                else
                {
                    // yt-dlp prints this when --match-filter rejects a video before download starts
                    if (line.Contains("does not pass filter", StringComparison.OrdinalIgnoreCase))
                    {
                        filteredByDuration = true;
                    }

                    if (!string.IsNullOrWhiteSpace(line))
                    {
                        await EmitEventAsync(track.JobId, "raw", line, job);
                    }
                }
            }

            await Task.WhenAll(process.WaitForExitAsync(cancellationToken), stderrTask);

            if (process.ExitCode == 0)
            {
                if (filteredByDuration)
                {
                    await HandleFilteredByDurationAsync(track, opts, db, job);
                }
                else
                {
                    await HandleSuccessAsync(track, resolvedFilePath, opts, db, job);
                }
            }
            else
            {
                await HandleFailureAsync(track, stderrError ?? "yt-dlp exited with code " + process.ExitCode, opts, db, job);
            }
        }
        catch (OperationCanceledException)
        {
            track.State = YtDlpTrackState.Cancelled;
        }
        catch (Exception ex)
        {
            await HandleFailureAsync(track, ex.Message, opts, db, job);
        }
        finally
        {
            ReleaseCookieFile(cookieFile);
            processes.TryRemove(track.Id, out _);
            try
            {
                process.Dispose();
            }
            catch
            {
            }
        }
    }

    private async Task HandleProgressLineAsync(YtDlpTrack track, string progressData)
    {
        // Format: "downloaded_bytes|total_bytes|speed|eta|percent"
        var parts = progressData.Split('|');
        if (parts.Length >= 5)
        {
            if (double.TryParse(parts[4].Replace("%", string.Empty).Trim(), out var pct))
            {
                track.Progress = pct;
            }

            track.Speed = parts[2] != "None" ? parts[2] : null;
            track.Eta = parts[3] != "None" ? parts[3] : null;
        }

        await hub.BroadcastTrackProgressAsync(track);
    }

    private async Task HandleSuccessAsync(YtDlpTrack track, string? filePath, resonance.Options.IntegrationsOptions.YtDlpOptions opts, YtDlpDbContext db, YtDlpJob? job)
    {
        var metadata = YtDlpMetadataParser.Parse(track.Title, track.Uploader, track.PlaylistIndex, track.UploadDate, opts.DefaultGenre);
        string? tagError = null;

        int? fileDuration = null;
        if (filePath == null || !File.Exists(filePath))
        {
            tagError = "Downloaded file not found on disk — tags not written.";
            Log.Warning("YtDlp: {Error} ({File})", tagError, filePath ?? "<no path>");
            await EmitEventAsync(track.JobId, "error", $"Tags not written for \"{track.Title}\": file not found", job);
        }
        else
        {
            tagError = YtDlpTagWriter.Write(filePath, metadata, track.Url, out fileDuration);
            if (tagError != null)
            {
                Log.Warning("YtDlp: tag writing failed for {File}: {Error}", filePath, tagError);
                await EmitEventAsync(track.JobId, "error", $"Tag problem for \"{track.Title}\": {tagError}", job);
            }
            else
            {
                var parts = new System.Collections.Generic.List<string>
                {
                    $"artist={metadata.Artist}",
                    $"title={metadata.Title}",
                };
                if (metadata.Album != null)
                {
                    parts.Add($"album={metadata.Album}");
                }

                if (metadata.Year.HasValue)
                {
                    parts.Add($"year={metadata.Year}");
                }

                if (metadata.TrackNumber.HasValue)
                {
                    parts.Add($"track={metadata.TrackNumber}");
                }

                if (metadata.Genre != null)
                {
                    parts.Add($"genre={metadata.Genre}");
                }

                await EmitEventAsync(track.JobId, "info", $"ID3: {string.Join(" · ", parts)}", job);
            }
        }

        track.State = YtDlpTrackState.Completed;
        track.Progress = 100;
        track.FilePath = filePath;
        track.TagWritingError = tagError;
        track.CompletedAt = DateTime.UtcNow;
        if (fileDuration.HasValue)
        {
            track.Duration = fileDuration.Value;
        }

        var dbTrack = await db.Tracks.FindAsync(track.Id);
        if (dbTrack != null)
        {
            dbTrack.State = track.State;
            dbTrack.Progress = track.Progress;
            dbTrack.FilePath = filePath;
            dbTrack.TagWritingError = tagError;
            dbTrack.CompletedAt = track.CompletedAt;
            if (fileDuration.HasValue)
            {
                dbTrack.Duration = fileDuration.Value;
            }
        }

        if (job != null)
        {
            job.CompletedTracks++;

            // If this track previously failed (attempt > 1), uncount that failure
            if (track.AttemptCount > 1)
            {
                job.FailedTracks = Math.Max(0, job.FailedTracks - 1);
            }

            if (tagError != null)
            {
                job.TagFailedTracks++;
            }

            var dbJob = await db.Jobs.FindAsync(job.Id);
            if (dbJob != null)
            {
                dbJob.CompletedTracks = job.CompletedTracks;
                dbJob.TagFailedTracks = job.TagFailedTracks;
            }
        }

        try
        {
            await db.SaveChangesAsync();
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
        {
            Log.Debug("YtDlp: track {Title} was removed before completion could be saved — skipping", track.Title);
            return;
        }

        if (tagError != null)
        {
            await EmitEventAsync(track.JobId, "warning", $"Tag error: {track.Title} — {tagError}", job);
        }
        else
        {
            await EmitEventAsync(track.JobId, "success", $"Completed: {track.Title}", job);
        }

        await CheckJobCompletionAsync(track.JobId, db, job);
        await BroadcastJobsAsync();

        Log.Information("YtDlp: completed {Title}", track.Title);
    }

    private async Task HandleFilteredByDurationAsync(YtDlpTrack track, resonance.Options.IntegrationsOptions.YtDlpOptions opts, YtDlpDbContext db, YtDlpJob? job)
    {
        var reason = opts.MinTrackDurationSeconds > 0 && opts.MaxTrackDurationSeconds > 0
            ? $"duration outside {FormatDuration(opts.MinTrackDurationSeconds)}–{FormatDuration(opts.MaxTrackDurationSeconds)}"
            : opts.MinTrackDurationSeconds > 0
                ? $"shorter than {FormatDuration(opts.MinTrackDurationSeconds)} min"
                : $"longer than {FormatDuration(opts.MaxTrackDurationSeconds)} max";

        track.State = YtDlpTrackState.Skipped;
        track.Error = reason;
        track.CompletedAt = DateTime.UtcNow;

        var dbTrack = await db.Tracks.FindAsync(track.Id);
        if (dbTrack != null)
        {
            dbTrack.State = YtDlpTrackState.Skipped;
            dbTrack.Error = reason;
            dbTrack.CompletedAt = track.CompletedAt;
        }

        if (job != null)
        {
            job.SkippedTracks++;
            var dbJob = await db.Jobs.FindAsync(job.Id);
            if (dbJob != null)
            {
                dbJob.SkippedTracks = job.SkippedTracks;
            }
        }

        try
        {
            await db.SaveChangesAsync();
        }
        catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
        {
            return;
        }

        await EmitEventAsync(track.JobId, "info", $"Skipped ({reason}): {track.Title}", job);
        await CheckJobCompletionAsync(track.JobId, db, job);
        await BroadcastJobsAsync();
    }

    private async Task HandleFailureAsync(YtDlpTrack track, string error, resonance.Options.IntegrationsOptions.YtDlpOptions opts, YtDlpDbContext db, YtDlpJob? job)
    {
        // While paused, don't count failures or spawn retry workers — re-queue so the
        // track is retried on resume (also covers tracks killed by an app shutdown)
        if (job?.State == YtDlpJobState.Paused)
        {
            track.State = YtDlpTrackState.Queued;
            track.AttemptCount = Math.Max(0, track.AttemptCount - 1);
            track.Progress = 0;
            track.Speed = null;
            track.Eta = null;

            var pausedDbTrack = await db.Tracks.FindAsync(track.Id);
            if (pausedDbTrack != null)
            {
                pausedDbTrack.State = YtDlpTrackState.Queued;
                pausedDbTrack.AttemptCount = track.AttemptCount;
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
                {
                }
            }

            return;
        }

        // A stopped job won't retry — mark the track cancelled and let the job finalize
        if (job?.State == YtDlpJobState.Cancelled)
        {
            track.State = YtDlpTrackState.Cancelled;

            var cancelledDbTrack = await db.Tracks.FindAsync(track.Id);
            if (cancelledDbTrack != null)
            {
                cancelledDbTrack.State = YtDlpTrackState.Cancelled;
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
                {
                    return;
                }
            }

            // Skip finalization when the job was removed (rows are being deleted)
            if (jobs.ContainsKey(track.JobId))
            {
                await CheckJobCompletionAsync(track.JobId, db, job);
                await BroadcastJobsAsync();
            }

            return;
        }

        if (track.AttemptCount < opts.MaxRetryAttempts)
        {
            Log.Warning("YtDlp: attempt {Attempt}/{Max} failed for {Title}, retrying", track.AttemptCount, opts.MaxRetryAttempts, track.Title);
            await EmitEventAsync(track.JobId, "warning", $"Retry ({track.AttemptCount}/{opts.MaxRetryAttempts}): {track.Title} — {error}", job);
            track.State = YtDlpTrackState.Queued;

            var dbTrack = await db.Tracks.FindAsync(track.Id);
            if (dbTrack != null)
            {
                dbTrack.State = YtDlpTrackState.Queued;
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
                {
                    Log.Debug("YtDlp: track {Title} was removed before retry could be saved — skipping", track.Title);
                    return;
                }
            }

            _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
        }
        else
        {
            Log.Warning("YtDlp: failed {Title}: {Error}", track.Title, error);
            track.State = YtDlpTrackState.Failed;
            track.Error = error;
            track.CompletedAt = DateTime.UtcNow;

            var dbTrack = await db.Tracks.FindAsync(track.Id);
            if (dbTrack != null)
            {
                dbTrack.State = YtDlpTrackState.Failed;
                dbTrack.Error = error;
                dbTrack.CompletedAt = track.CompletedAt;
            }

            if (job != null)
            {
                job.FailedTracks++;
                var dbJob = await db.Jobs.FindAsync(job.Id);
                if (dbJob != null)
                {
                    dbJob.FailedTracks = job.FailedTracks;
                }
            }

            try
            {
                await db.SaveChangesAsync();
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
            {
                Log.Debug("YtDlp: track {Title} was removed before failure could be saved — skipping", track.Title);
                return;
            }

            await EmitEventAsync(track.JobId, "error", $"Failed: {track.Title} — {error}", job);
            await CheckJobCompletionAsync(track.JobId, db, job);
            await BroadcastJobsAsync();
        }
    }

    private async Task CheckJobCompletionAsync(Guid jobId, YtDlpDbContext db, YtDlpJob? job)
    {
        var pending = await db.Tracks
            .CountAsync(t => t.JobId == jobId && (t.State == YtDlpTrackState.Queued || t.State == YtDlpTrackState.InProgress));

        // Stopped (cancelled) jobs finalize too, once their in-flight tracks have ended —
        // completed files still get moved out and staging leftovers removed
        if (pending == 0 && job != null)
        {
            await FinalizeJobAsync(job, db);
        }
    }

    private async Task FinalizeJobAsync(YtDlpJob job, YtDlpDbContext db, CancellationToken cancellationToken = default)
    {
        var failedCount = await db.Tracks.CountAsync(t => t.JobId == job.Id && t.State == YtDlpTrackState.Failed, cancellationToken);

        // A stopped job stays Cancelled; everything else finalizes as Completed
        var finalState = job.State == YtDlpJobState.Cancelled ? YtDlpJobState.Cancelled : YtDlpJobState.Completed;
        job.State = finalState;
        job.CompletedAt ??= DateTime.UtcNow;
        job.FailedTracks = failedCount;

        var dbJob = await db.Jobs.FindAsync([job.Id], cancellationToken);
        if (dbJob != null)
        {
            dbJob.State = finalState;
            dbJob.CompletedAt = job.CompletedAt;
            dbJob.FailedTracks = failedCount;
        }

        // Move all staged files to the final output directory and update DB paths
        var stagingDir = GetStagingDirectory(job.Id);
        if (Directory.Exists(stagingDir))
        {
            var completedTracks = await db.Tracks
                .Where(t => t.JobId == job.Id && t.FilePath != null)
                .ToListAsync(cancellationToken);

            // Optional post-completion format conversion. Done here, in staging, *before* the
            // go-live move below — so the output/share directory only ever sees the converted
            // files and the subsequent library/share rescan indexes the final paths.
            var convertFormat = (job.ConvertOnCompletionFormatOverride
                ?? options.CurrentValue.Integrations.YtDlp.ConvertOnCompletionFormat)?.Trim();
            if (AudioConverter.IsConvertibleTarget(convertFormat))
            {
                var pending = completedTracks.Count(t => AudioConverter.NeedsConversion(t.FilePath, convertFormat!));
                if (pending > 0)
                {
                    await EmitEventAsync(job.Id, "info", $"Converting {pending} track(s) to {convertFormat} before publishing…", job);
                }

                foreach (var t in completedTracks)
                {
                    await ConvertStagedTrackAsync(t, convertFormat!, job, cancellationToken);
                }
            }

            foreach (var t in completedTracks)
            {
                try
                {
                    var relative = Path.GetRelativePath(stagingDir, t.FilePath!);
                    var dest = Path.Combine(job.OutputDirectory, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    File.Move(t.FilePath!, dest, overwrite: true);
                    t.FilePath = dest;
                }
                catch (Exception ex)
                {
                    Log.Warning("YtDlp: failed to move staged file {Path}: {Error}", t.FilePath, ex.Message);
                }
            }

            try
            {
                Directory.Delete(stagingDir, recursive: true);
            }
            catch
            {
            }
        }

        await db.SaveChangesAsync(cancellationToken);

        // Refresh both indexes for the freshly-moved files: the music library
        // (TriggerSync scans the configured share/library directories) and the
        // Soulseek share cache (a targeted rescan of just the output directory).
        // Both only pick up the new files if the output directory is within a
        // configured share — see Shares.Directories.
        library.TriggerSync();
        try
        {
            await shares.ScanDirectoriesAsync(new[] { job.OutputDirectory });
        }
        catch (resonance.ShareScanInProgressException)
        {
            // A scan is already running — it will pick up the new files
        }
        catch (Exception ex)
        {
            Log.Warning("YtDlp: share rescan of {Dir} after job completion failed: {Error}", job.OutputDirectory, ex.Message);
        }

        var verb = job.State == YtDlpJobState.Cancelled ? "Stopped" : "Done";
        await EmitEventAsync(job.Id, "success",
            $"{verb}: {job.Title ?? job.Url} ({job.CompletedTracks} completed, {job.FailedTracks} failed, {job.SkippedTracks} skipped)",
            job);
    }

    public async Task ReconcileJobAsync(Guid jobId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();

        // Load from DB if not in hot cache (e.g. already-completed jobs not reloaded on startup)
        if (!jobs.TryGetValue(jobId, out var job))
        {
            var dbJob = await db.Jobs.FindAsync(jobId);
            if (dbJob == null)
            {
                return;
            }

            job = dbJob;
            jobs[jobId] = job;
        }

        var pending = await db.Tracks
            .CountAsync(t => t.JobId == jobId && (t.State == YtDlpTrackState.Queued || t.State == YtDlpTrackState.InProgress));

        if (pending > 0)
        {
            return;
        }

        Log.Information("YtDlp: reconciling job {Title} — moving files and triggering library sync", job.Title ?? job.Url);
        await FinalizeJobAsync(job, db);
        await BroadcastJobsAsync();
    }

    public async Task<(int Updated, int Failed, int Skipped)> BackfillDurationsAsync(CancellationToken cancellationToken = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        var tracks = await db.Tracks
            .Where(t => t.State == YtDlpTrackState.Completed && t.FilePath != null && (t.Duration == null || t.Duration == 0))
            .ToListAsync(cancellationToken);

        int updated = 0, failed = 0, skipped = 0;

        foreach (var track in tracks)
        {
            if (!File.Exists(track.FilePath))
            {
                skipped++;
                continue;
            }

            try
            {
                using var file = TagLib.File.Create(track.FilePath);
                var duration = (int)file.Properties.Duration.TotalSeconds;
                if (duration > 0)
                {
                    track.Duration = duration;
                    updated++;
                }
                else
                {
                    skipped++;
                }
            }
            catch
            {
                failed++;
            }
        }

        if (updated > 0)
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        Log.Information("YtDlp: duration backfill complete — updated={Updated} failed={Failed} skipped={Skipped}", updated, failed, skipped);
        return (updated, failed, skipped);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    private async Task EmitEventAsync(Guid? jobId, string level, string message, YtDlpJob? job = null)
    {
        var ev = new YtDlpEvent(DateTime.UtcNow, jobId, job?.Title ?? job?.Url, level, message);
        eventBuffer.Enqueue(ev);
        while (eventBuffer.Count > EventBufferMax)
        {
            eventBuffer.TryDequeue(out _);
        }

        await hub.BroadcastEventAsync(ev);
    }

    private string GetStagingRoot()
    {
        var opts = options.CurrentValue;
        return !string.IsNullOrWhiteSpace(opts.Integrations.YtDlp.StagingDirectory)
            ? opts.Integrations.YtDlp.StagingDirectory
            : Path.Combine(opts.Directories.Downloads, "yt-dlp-staging");
    }

    private string GetStagingDirectory(Guid jobId)
        => Path.Combine(GetStagingRoot(), jobId.ToString());

    private static resonance.Options.IntegrationsOptions.YtDlpOptions ApplyJobOverrides(
        resonance.Options.IntegrationsOptions.YtDlpOptions opts, YtDlpJob job)
    {
        if (job.AudioFormatOverride == null && job.AudioQualityOverride == null &&
            job.DefaultGenreOverride == null && job.MinTrackDurationSecondsOverride == null &&
            job.MaxTrackDurationSecondsOverride == null && job.UploadedAfterOverride == null)
        {
            return opts;
        }

        return new resonance.Options.IntegrationsOptions.YtDlpOptions
        {
            Enabled = opts.Enabled,
            ExecutablePath = opts.ExecutablePath,
            FfmpegPath = opts.FfmpegPath,
            AudioFormat = job.AudioFormatOverride ?? opts.AudioFormat,
            AudioQuality = job.AudioQualityOverride ?? opts.AudioQuality,
            OutputTemplate = opts.OutputTemplate,
            OutputDirectory = opts.OutputDirectory,
            MaxConcurrentDownloads = opts.MaxConcurrentDownloads,
            MaxRetryAttempts = opts.MaxRetryAttempts,
            BandwidthLimit = opts.BandwidthLimit,
            DefaultGenre = job.DefaultGenreOverride ?? opts.DefaultGenre,
            SponsorBlock = opts.SponsorBlock,
            SkipExistingFiles = opts.SkipExistingFiles,
            MinTrackDurationSeconds = job.MinTrackDurationSecondsOverride ?? opts.MinTrackDurationSeconds,
            MaxTrackDurationSeconds = job.MaxTrackDurationSecondsOverride ?? opts.MaxTrackDurationSeconds,
            ConvertOnCompletionFormat = opts.ConvertOnCompletionFormat,
            UploadedAfter = job.UploadedAfterOverride ?? opts.UploadedAfter,
        };
    }

    // ── Post-completion conversion ───────────────────────────────────────────
    // Transcodes a single staged file in place (new extension, original removed). On any
    // failure the original is kept so the track still goes live in its downloaded format.
    private async Task ConvertStagedTrackAsync(YtDlpTrack track, string targetFormat, YtDlpJob job, CancellationToken cancellationToken)
    {
        var source = track.FilePath;
        if (!AudioConverter.NeedsConversion(source, targetFormat) || !File.Exists(source))
        {
            return;
        }

        var quality = options.CurrentValue.Integrations.YtDlp.AudioQuality;
        var ffmpegPath = await ffmpeg.GetFfmpegPathAsync(cancellationToken);
        var result = await AudioConverter.ConvertAsync(ffmpegPath, source!, targetFormat, quality, cancellationToken);

        if (result.Success && result.DestinationPath != null)
        {
            try
            {
                File.Delete(source!);
            }
            catch (Exception ex)
            {
                Log.Warning("YtDlp: converted {Title} but could not remove original {Path}: {Error}", track.Title, source, ex.Message);
            }

            track.FilePath = result.DestinationPath;
            Log.Information("YtDlp: converted {Title} to {Format}", track.Title, targetFormat);
            await EmitEventAsync(track.JobId, "info", $"Converted to {targetFormat}: {track.Title}", job);
        }
        else
        {
            Log.Warning("YtDlp: conversion to {Format} failed for {Title}: {Error}", targetFormat, track.Title, result.Error);
            await EmitEventAsync(track.JobId, "warning", $"Conversion to {targetFormat} failed for \"{track.Title}\" — keeping original", job);
        }
    }

    private string BuildDownloadArgs(string url, resonance.Options.IntegrationsOptions.YtDlpOptions opts, string outputTemplate, string? cookieFile, string ffmpegLocation)
    {
        var args = new System.Text.StringBuilder();

        args.Append("--extract-audio");
        args.Append($" --audio-format {opts.AudioFormat}");
        args.Append($" --audio-quality {opts.AudioQuality}");
        args.Append(" --no-embed-metadata");
        args.Append(" --write-thumbnail");
        args.Append(" --no-playlist");
        args.Append(" --newline");
        if (!string.IsNullOrEmpty(ffmpegLocation))
        {
            args.Append($" --ffmpeg-location \"{ffmpegLocation}\"");
        }

        if (jsRuntimeArg != null)
        {
            args.Append($" {jsRuntimeArg}");
        }

        args.Append(" --progress-template \"download:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s|%(progress._percent_str)s\"");
        args.Append($" --output \"{outputTemplate}\"");

        if (!string.IsNullOrWhiteSpace(opts.BandwidthLimit))
        {
            args.Append($" --limit-rate {opts.BandwidthLimit}");
        }

        // Duration filter applied by yt-dlp before downloading — prevents fetching a full file just to discard it
        var matchParts = new System.Collections.Generic.List<string>();
        if (opts.MinTrackDurationSeconds > 0)
        {
            matchParts.Add($"duration >= {opts.MinTrackDurationSeconds}");
        }

        if (opts.MaxTrackDurationSeconds > 0)
        {
            matchParts.Add($"duration <= {opts.MaxTrackDurationSeconds}");
        }

        if (matchParts.Count > 0)
        {
            args.Append($" --match-filter \"{string.Join(" & ", matchParts)}\"");
        }

        // Upload-date lower bound for channel/playlist downloads. Whitelisted to fixed relative
        // values so nothing user-supplied is interpolated into the yt-dlp argument string.
        var dateAfter = opts.UploadedAfter switch
        {
            "today" => "today",
            "week" => "today-1week",
            "month" => "today-1month",
            "year" => "today-1year",
            _ => null,
        };

        if (dateAfter != null)
        {
            args.Append($" --dateafter {dateAfter}");
        }

        if (opts.SponsorBlock)
        {
            args.Append(" --sponsorblock-remove sponsor,intro,outro");
        }

        if (cookieFile != null)
        {
            args.Append($" --cookies \"{cookieFile}\"");
        }

        args.Append($" \"{url}\"");
        return args.ToString();
    }

    // yt-dlp rewrites the cookie file on every run to persist updated cookies, so concurrent
    // workers sharing the master file corrupt it. Each invocation gets a private throwaway
    // copy; the uploaded master is never handed to yt-dlp directly.
    private static string? AcquireCookieFile()
    {
        var path = Path.Combine(resonance.Program.AppDirectory, "ytdlp-cookies.txt");
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length == 0)
            {
                return null;
            }

            var temp = Path.Combine(Path.GetTempPath(), $"resonance-ytdlp-cookies-{Guid.NewGuid():N}.txt");
            File.Copy(path, temp, overwrite: true);
            return temp;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static void ReleaseCookieFile(string? tempPath)
    {
        if (tempPath == null)
        {
            return;
        }

        try
        {
            File.Delete(tempPath);
        }
        catch
        {
        }
    }

    private static string FormatDuration(int seconds)
    {
        var m = seconds / 60;
        var s = seconds % 60;
        return m > 0 ? $"{m}m{s:D2}s" : $"{s}s";
    }

    private static async Task<string?> DetectJsRuntimeAsync()
    {
        // Try each JS runtime yt-dlp supports, in preference order
        string[] candidates = ["node", "bun", "deno"];
        foreach (var runtime in candidates)
        {
            var whichCmd = RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "where" : "which";
            try
            {
                using var p = new Process
                {
                    StartInfo = new ProcessStartInfo(whichCmd, runtime)
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                    },
                };
                p.Start();
                var path = (await p.StandardOutput.ReadLineAsync())?.Trim();
                await p.WaitForExitAsync();
                if (p.ExitCode == 0 && !string.IsNullOrWhiteSpace(path))
                {
                    return $"--js-runtimes {runtime}:{path}";
                }
            }
            catch
            {
            }
        }

        return null;
    }

    private YtDlpSearchResult? ParseSearchResult(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var videoId = root.TryGetProperty("id", out var id) ? id.GetString() ?? string.Empty : string.Empty;
            var url = root.TryGetProperty("url", out var u) ? u.GetString() ?? string.Empty : string.Empty;
            var title = root.TryGetProperty("title", out var t) ? t.GetString() ?? string.Empty : string.Empty;
            var uploader = root.TryGetProperty("uploader", out var up) ? up.GetString() ?? string.Empty : string.Empty;
            var thumbnail = root.TryGetProperty("thumbnail", out var th) ? th.GetString() : null;

            // Flat-playlist output has no top-level "thumbnail", only a "thumbnails" array (smallest first)
            if (thumbnail is null
                && root.TryGetProperty("thumbnails", out var thumbs)
                && thumbs.ValueKind == JsonValueKind.Array
                && thumbs.GetArrayLength() > 0
                && thumbs[thumbs.GetArrayLength() - 1].TryGetProperty("url", out var thumbUrl))
            {
                thumbnail = thumbUrl.GetString();
            }

            // duration is a float in flat-playlist output (e.g. 322.0)
            var duration = root.TryGetProperty("duration", out var dur) && dur.ValueKind == JsonValueKind.Number
                ? (int?)(int)dur.GetDouble()
                : null;

            if (!url.StartsWith("http") && videoId.Length > 0)
            {
                url = $"https://www.youtube.com/watch?v={videoId}";
            }

            // Channels and playlists both come back as "YoutubeTab" entries; videos are "Youtube"
            var ieKey = root.TryGetProperty("ie_key", out var ie) ? ie.GetString() : null;
            var resultType = ieKey == "YoutubeTab"
                ? (url.Contains("/playlist", StringComparison.OrdinalIgnoreCase) ? "playlist" : "channel")
                : "video";

            var subscriberCount = root.TryGetProperty("channel_follower_count", out var followers) && followers.ValueKind == JsonValueKind.Number
                ? (long?)followers.GetInt64()
                : null;

            if (resultType == "channel" && string.IsNullOrEmpty(uploader))
            {
                uploader = root.TryGetProperty("uploader_id", out var handle) ? handle.GetString() ?? string.Empty : string.Empty;
            }

            return new YtDlpSearchResult(videoId, url, title, uploader, thumbnail, duration, resultType, subscriberCount);
        }
        catch
        {
            return null;
        }
    }

    private async Task<string?> RunVersionCommandAsync(string executable, string args, CancellationToken cancellationToken)
    {
        try
        {
            var process = new Process
            {
                StartInfo = new ProcessStartInfo(executable)
                {
                    Arguments = args,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };
            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            return output.Split('\n').FirstOrDefault()?.Trim();
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────
    public IReadOnlyList<YtDlpSubscription> ListSubscriptions()
        => subscriptions.Values.OrderByDescending(s => s.CreatedAt).ToList();

    public async Task<YtDlpSubscription> AddSubscriptionAsync(string channelUrl, YtDlpSubscriptionOverrides? overrides = null, CancellationToken cancellationToken = default)
    {
        var url = NormalizeChannelUrl(channelUrl.Trim());

        var existing = subscriptions.Values.FirstOrDefault(s =>
            string.Equals(s.ChannelUrl, url, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            throw new InvalidOperationException("Already subscribed to this channel.");
        }

        var sub = new YtDlpSubscription
        {
            ChannelUrl = url,
            OutputDirectoryOverride = overrides?.OutputDirectory,
            AudioFormatOverride = overrides?.AudioFormat,
            AudioQualityOverride = overrides?.AudioQuality,
            DefaultGenreOverride = overrides?.DefaultGenre,
            MinTrackDurationSecondsOverride = overrides?.MinTrackDurationSeconds,
            MaxTrackDurationSecondsOverride = overrides?.MaxTrackDurationSeconds,
            ConvertOnCompletionFormatOverride = overrides?.ConvertOnCompletionFormat,
            UploadedAfterOverride = overrides?.UploadedAfter,
        };

        subscriptions[sub.Id] = sub;

        await using (var db = await dbFactory.CreateDbContextAsync(cancellationToken))
        {
            db.Subscriptions.Add(sub);
            await db.SaveChangesAsync(cancellationToken);
        }

        await BroadcastSubscriptionsAsync();
        await EmitEventAsync(null, "info", $"Subscription added: {url}");

        // First check establishes the baseline (records the newest video, downloads nothing)
        // so subscribing doesn't pull the channel's entire back-catalogue.
        await CheckSubscriptionAsync(sub, cancellationToken);

        return sub;
    }

    public async Task UpdateSubscriptionAsync(Guid id, bool? enabled, int? pollIntervalMinutes, YtDlpSubscriptionOverrides? overrides, CancellationToken cancellationToken = default)
    {
        if (!subscriptions.TryGetValue(id, out var sub))
        {
            return;
        }

        if (enabled.HasValue)
        {
            sub.Enabled = enabled.Value;
        }

        if (pollIntervalMinutes.HasValue)
        {
            sub.PollIntervalMinutes = Math.Max(0, pollIntervalMinutes.Value);
        }

        if (overrides != null)
        {
            sub.OutputDirectoryOverride = overrides.OutputDirectory;
            sub.AudioFormatOverride = overrides.AudioFormat;
            sub.AudioQualityOverride = overrides.AudioQuality;
            sub.DefaultGenreOverride = overrides.DefaultGenre;
            sub.MinTrackDurationSecondsOverride = overrides.MinTrackDurationSeconds;
            sub.MaxTrackDurationSecondsOverride = overrides.MaxTrackDurationSeconds;
            sub.ConvertOnCompletionFormatOverride = overrides.ConvertOnCompletionFormat;
            sub.UploadedAfterOverride = overrides.UploadedAfter;
        }

        await PersistSubscriptionAsync(sub, cancellationToken);
        await BroadcastSubscriptionsAsync();
    }

    public async Task RemoveSubscriptionAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (!subscriptions.TryRemove(id, out var sub))
        {
            return;
        }

        await using (var db = await dbFactory.CreateDbContextAsync(cancellationToken))
        {
            var dbSub = await db.Subscriptions.FindAsync([id], cancellationToken);
            if (dbSub != null)
            {
                db.Subscriptions.Remove(dbSub);
                await db.SaveChangesAsync(cancellationToken);
            }
        }

        await BroadcastSubscriptionsAsync();
        await EmitEventAsync(null, "info", $"Subscription removed: {sub.ChannelTitle ?? sub.ChannelUrl}");
    }

    public async Task CheckSubscriptionNowAsync(Guid id, CancellationToken cancellationToken = default)
    {
        if (subscriptions.TryGetValue(id, out var sub))
        {
            await CheckSubscriptionAsync(sub, cancellationToken);
        }
    }

    // Ticks once a minute and checks every subscription whose interval has elapsed. Checks run
    // one-at-a-time (subscriptionCheckLock) so a burst of due subscriptions doesn't spawn a pile
    // of concurrent yt-dlp enumerations and download jobs.
    private async Task RunSubscriptionPollLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (!options.CurrentValue.Integrations.YtDlp.Enabled)
                {
                    continue;
                }

                var globalInterval = Math.Max(5, options.CurrentValue.Integrations.YtDlp.SubscriptionPollMinutes);
                var now = DateTime.UtcNow;

                foreach (var sub in subscriptions.Values)
                {
                    if (!sub.Enabled)
                    {
                        continue;
                    }

                    var interval = sub.PollIntervalMinutes > 0 ? sub.PollIntervalMinutes : globalInterval;
                    if (sub.LastCheckedAt.HasValue && (now - sub.LastCheckedAt.Value).TotalMinutes < interval)
                    {
                        continue;
                    }

                    await CheckSubscriptionAsync(sub, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log.Error(ex, "YtDlp: subscription poll loop terminated unexpectedly");
        }
    }

    private async Task CheckSubscriptionAsync(YtDlpSubscription sub, CancellationToken cancellationToken)
    {
        await subscriptionCheckLock.WaitAsync(cancellationToken);
        try
        {
            var opts = options.CurrentValue.Integrations.YtDlp;
            var count = Math.Clamp(opts.SubscriptionCheckCount, 1, 100);

            List<ChannelEntry> entries;
            try
            {
                entries = await EnumerateChannelRecentAsync(sub.ChannelUrl, count, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                sub.LastError = ex.Message;
                sub.LastCheckedAt = DateTime.UtcNow;
                await PersistSubscriptionAsync(sub, CancellationToken.None);
                await BroadcastSubscriptionsAsync();
                await EmitEventAsync(null, "error", $"Subscription check failed ({sub.ChannelTitle ?? sub.ChannelUrl}): {ex.Message}");
                return;
            }

            if (entries.Count == 0)
            {
                sub.LastError = "No videos returned from channel";
                sub.LastCheckedAt = DateTime.UtcNow;
                await PersistSubscriptionAsync(sub, CancellationToken.None);
                await BroadcastSubscriptionsAsync();
                return;
            }

            // Populate display metadata from the listing the first time we see it
            if (string.IsNullOrEmpty(sub.ChannelTitle) && !string.IsNullOrEmpty(entries[0].Uploader))
            {
                sub.ChannelTitle = entries[0].Uploader;
            }

            if (string.IsNullOrEmpty(sub.ThumbnailUrl))
            {
                sub.ThumbnailUrl = entries[0].ThumbnailUrl;
            }

            // Baseline: the very first check records the newest video and downloads nothing.
            if (sub.LastVideoId == null)
            {
                sub.LastVideoId = entries[0].VideoId;
                sub.LastCheckedAt = DateTime.UtcNow;
                sub.LastError = null;
                await PersistSubscriptionAsync(sub, CancellationToken.None);
                await BroadcastSubscriptionsAsync();
                await EmitEventAsync(null, "info", $"Subscription baselined: {sub.ChannelTitle ?? sub.ChannelUrl} ({entries.Count} videos)");
                return;
            }

            // Channel listings are newest-first; everything ahead of the cursor is new.
            var newEntries = new List<ChannelEntry>();
            foreach (var entry in entries)
            {
                if (entry.VideoId == sub.LastVideoId)
                {
                    break;
                }

                newEntries.Add(entry);
            }

            sub.LastVideoId = entries[0].VideoId;
            sub.LastCheckedAt = DateTime.UtcNow;
            sub.LastError = null;

            // Download oldest-first so playlists/library ordering reflects upload order
            newEntries.Reverse();
            var queued = 0;
            foreach (var entry in newEntries)
            {
                if (string.IsNullOrEmpty(entry.Url))
                {
                    continue;
                }

                await SubmitAsync(
                    entry.Url,
                    sub.OutputDirectoryOverride,
                    sub.AudioFormatOverride,
                    sub.AudioQualityOverride,
                    sub.DefaultGenreOverride,
                    sub.MinTrackDurationSecondsOverride,
                    sub.MaxTrackDurationSecondsOverride,
                    sub.ConvertOnCompletionFormatOverride,
                    sub.UploadedAfterOverride,
                    cancellationToken);
                queued++;
            }

            sub.NewVideosFound += queued;
            await PersistSubscriptionAsync(sub, CancellationToken.None);
            await BroadcastSubscriptionsAsync();

            if (queued > 0)
            {
                await EmitEventAsync(null, "info", $"Subscription found {queued} new video(s): {sub.ChannelTitle ?? sub.ChannelUrl}");
            }
        }
        finally
        {
            subscriptionCheckLock.Release();
        }
    }

    // Enumerates the most recent `count` uploads of a channel/playlist without downloading.
    private async Task<List<ChannelEntry>> EnumerateChannelRecentAsync(string channelUrl, int count, CancellationToken cancellationToken)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var entries = new List<ChannelEntry>();

        var args = new System.Text.StringBuilder($"--flat-playlist --dump-json --playlist-end {count}");
        if (jsRuntimeArg != null)
        {
            args.Append($" {jsRuntimeArg}");
        }

        var cookieFile = AcquireCookieFile();
        if (cookieFile != null)
        {
            args.Append($" --cookies \"{cookieFile}\"");
        }

        args.Append($" \"{channelUrl}\"");

        var process = new Process
        {
            StartInfo = new ProcessStartInfo(opts.ExecutablePath)
            {
                Arguments = args.ToString(),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
        };

        try
        {
            process.Start();

            var stderr = new System.Text.StringBuilder();
            var stderrTask = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync(CancellationToken.None)) != null)
                {
                    stderr.AppendLine(errLine);
                }
            }, CancellationToken.None);

            string? line;
            while ((line = await process.StandardOutput.ReadLineAsync(cancellationToken)) != null)
            {
                var entry = ParseChannelEntry(line);
                if (entry != null)
                {
                    entries.Add(entry);
                }
            }

            await Task.WhenAll(process.WaitForExitAsync(cancellationToken), stderrTask);

            if (entries.Count == 0 && process.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    stderr.ToString().Trim() is { Length: > 0 } err
                        ? err.Split('\n')[^1]
                        : $"yt-dlp exited with code {process.ExitCode}");
            }

            return entries;
        }
        finally
        {
            ReleaseCookieFile(cookieFile);
        }
    }

    private static ChannelEntry? ParseChannelEntry(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var videoId = root.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? string.Empty : string.Empty;
            if (string.IsNullOrEmpty(videoId))
            {
                return null;
            }

            var url = root.TryGetProperty("url", out var urlProp) ? urlProp.GetString() ?? string.Empty : string.Empty;
            if (!url.StartsWith("http"))
            {
                url = $"https://www.youtube.com/watch?v={videoId}";
            }

            var title = root.TryGetProperty("title", out var titleProp) ? titleProp.GetString() ?? string.Empty : string.Empty;
            var uploader = root.TryGetProperty("uploader", out var upProp) ? upProp.GetString() ?? string.Empty : string.Empty;
            if (string.IsNullOrEmpty(uploader) && root.TryGetProperty("channel", out var chProp))
            {
                uploader = chProp.GetString() ?? string.Empty;
            }

            var thumbnail = root.TryGetProperty("thumbnail", out var thumbProp) ? thumbProp.GetString() : null;

            return new ChannelEntry(videoId, url, title, uploader, thumbnail);
        }
        catch
        {
            return null;
        }
    }

    // Point bare channel URLs at the Videos tab so we enumerate uploads (newest-first) rather
    // than the channel home, which mixes in shorts, playlists and featured sections.
    private static string NormalizeChannelUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return url;
        }

        var isChannel = url.Contains("/@", StringComparison.OrdinalIgnoreCase)
            || url.Contains("/channel/", StringComparison.OrdinalIgnoreCase)
            || url.Contains("/c/", StringComparison.OrdinalIgnoreCase)
            || url.Contains("/user/", StringComparison.OrdinalIgnoreCase);

        if (!isChannel)
        {
            return url;
        }

        var trimmed = url.TrimEnd('/');
        foreach (var tab in new[] { "/videos", "/streams", "/shorts", "/playlists", "/featured", "/community" })
        {
            if (trimmed.EndsWith(tab, StringComparison.OrdinalIgnoreCase))
            {
                return trimmed;
            }
        }

        return trimmed + "/videos";
    }

    private async Task PersistSubscriptionAsync(YtDlpSubscription sub, CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var dbSub = await db.Subscriptions.FindAsync([sub.Id], cancellationToken);
        if (dbSub == null)
        {
            return;
        }

        dbSub.ChannelTitle = sub.ChannelTitle;
        dbSub.ThumbnailUrl = sub.ThumbnailUrl;
        dbSub.Enabled = sub.Enabled;
        dbSub.PollIntervalMinutes = sub.PollIntervalMinutes;
        dbSub.LastVideoId = sub.LastVideoId;
        dbSub.LastCheckedAt = sub.LastCheckedAt;
        dbSub.NewVideosFound = sub.NewVideosFound;
        dbSub.LastError = sub.LastError;
        dbSub.OutputDirectoryOverride = sub.OutputDirectoryOverride;
        dbSub.AudioFormatOverride = sub.AudioFormatOverride;
        dbSub.AudioQualityOverride = sub.AudioQualityOverride;
        dbSub.DefaultGenreOverride = sub.DefaultGenreOverride;
        dbSub.MinTrackDurationSecondsOverride = sub.MinTrackDurationSecondsOverride;
        dbSub.MaxTrackDurationSecondsOverride = sub.MaxTrackDurationSecondsOverride;
        dbSub.ConvertOnCompletionFormatOverride = sub.ConvertOnCompletionFormatOverride;
        dbSub.UploadedAfterOverride = sub.UploadedAfterOverride;
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task BroadcastSubscriptionsAsync() => hub.BroadcastSubscriptionsAsync(ListSubscriptions());

    private sealed record ChannelEntry(string VideoId, string Url, string Title, string Uploader, string? ThumbnailUrl);

    private Task BroadcastJobsAsync() => hub.BroadcastJobsAsync(jobs.Values.OrderByDescending(j => j.RequestedAt));

    public void Dispose()
    {
        try
        {
            cts.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        cts.Dispose();
        workerSlots?.Dispose();
        subscriptionCheckLock.Dispose();
    }
}
