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
using resonance.Common;
using resonance.Common.Audio;
using Resonance.Integrations.YtDlp.API.Hubs;
using Resonance.Integrations.YtDlp.Data;
using Resonance.Integrations.YtDlp.Types;
using resonance.MusicLibrary;
using Serilog;

public sealed class YtDlpService : IYtDlpService, IDisposable
{
    private const int EventBufferMax = 500;

    // Per-track auto-retry rounds, in memory (resets on restart, which also grants a fresh budget).
    private const int MaxAutoRetryRounds = 10;

    // Below this fraction of yt-dlp's own reported video duration, a "completed" download is
    // treated as truncated rather than trusted. Guards against a process interrupted mid-download
    // (e.g. a dotnet watch restart) leaving a partial file that yt-dlp's own resume check later
    // reports as "already downloaded" and this service would otherwise adopt as done.
    private const double TruncatedDownloadRatio = 0.5;

    private static readonly ILogger Log = Serilog.Log.ForContext("SourceContext", resonance.Logs.Integrations.YtDlp);

    // Coalesce post-publish library/share rescans: touched folders accumulate and are scanned at
    // most once per interval, so a run of jobs finishing together doesn't fire a scan apiece.
    private static readonly TimeSpan RescanMinInterval = TimeSpan.FromMinutes(5);

    // Formats the tag writer (and AudioConverter) know how to handle — checked in order when a
    // track's recorded extension no longer matches what's on disk.
    private static readonly string[] KnownAudioExtensions = [".mp3", ".opus", ".m4a", ".flac", ".ogg", ".wav"];

    // yt-dlp leftovers that share a track's stem and should be removed from staging once moved.
    private static readonly string[] SidecarExtensions =
        [".webp", ".jpg", ".jpeg", ".png", ".part", ".ytdl", ".temp", ".info.json", ".description"];

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

    private readonly ConcurrentDictionary<Guid, int> autoRetryCounts = new();

    private readonly SemaphoreSlim publishLock = new(1, 1);

    private readonly object rescanGate = new();
    private readonly HashSet<string> pendingRescanDirs = new(StringComparer.Ordinal);
    private DateTime lastRescanAt = DateTime.MinValue;
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

        // SubscriptionId was added after first release; EnsureCreated won't alter an existing table.
        await db.Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Jobs\" ADD COLUMN IF NOT EXISTS \"SubscriptionId\" uuid", cancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Tracks\" ADD COLUMN IF NOT EXISTS \"ReportedDurationSeconds\" integer", cancellationToken);
        await db.Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Events\" ADD COLUMN IF NOT EXISTS \"TrackTitle\" text", cancellationToken);

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

        // Rehydrate the Events pane from the durable log so it survives restarts and buffer
        // eviction. Load the most recent window (the buffer cap) oldest-first so the queue keeps
        // chronological order (newest last).
        var recentEvents = await db.Events
            .OrderByDescending(e => e.Id)
            .Take(EventBufferMax)
            .ToListAsync(cancellationToken);
        recentEvents.Reverse();
        foreach (var e in recentEvents)
        {
            eventBuffer.Enqueue(new YtDlpEvent(e.Timestamp, e.JobId, e.JobTitle, e.Level, e.Message, e.TrackTitle));
        }

        // Load channel subscriptions into the hot cache and start the poll loop
        var allSubs = await db.Subscriptions.OrderByDescending(s => s.CreatedAt).ToListAsync(cancellationToken);
        foreach (var sub in allSubs)
        {
            subscriptions[sub.Id] = sub;
        }

        _ = Task.Run(() => RunSubscriptionPollLoopAsync(cts.Token), CancellationToken.None);
        _ = Task.Run(() => RunAutoRetryLoopAsync(cts.Token), CancellationToken.None);
        _ = Task.Run(() => RunRescanFlushLoopAsync(cts.Token), CancellationToken.None);
        _ = Task.Run(() => RunAutoUpdateLoopAsync(cts.Token), CancellationToken.None);
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

    public async Task ClearEventsAsync()
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.Events.ExecuteDeleteAsync();

        eventBuffer.Clear();
        await hub.BroadcastEventSnapshotAsync(GetRecentEvents());
    }

    public async Task ClearJobEventsAsync(Guid jobId)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        await db.Events.Where(e => e.JobId == jobId).ExecuteDeleteAsync();

        // ConcurrentQueue has no remove-by-predicate — drain and re-enqueue the survivors in order.
        var kept = eventBuffer.Where(e => e.JobId != jobId).ToArray();
        eventBuffer.Clear();
        foreach (var e in kept)
        {
            eventBuffer.Enqueue(e);
        }

        await hub.BroadcastEventSnapshotAsync(GetRecentEvents());
    }

    // ponytail: subscriptionId trails cancellationToken so the controller call site needs no change; only the poller sets it.
    public async Task<YtDlpJob> SubmitAsync(string url, string? outputDirectory = null, string? audioFormat = null, int? audioQuality = null, string? defaultGenre = null, int? minTrackDurationSeconds = null, int? maxTrackDurationSeconds = null, string? convertOnCompletionFormat = null, string? uploadedAfter = null, CancellationToken cancellationToken = default, Guid? subscriptionId = null)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;
        var outDir = !string.IsNullOrWhiteSpace(outputDirectory) ? outputDirectory
            : !string.IsNullOrWhiteSpace(opts.OutputDirectory) ? opts.OutputDirectory
            : options.CurrentValue.Directories.Downloads;

        var minimumFreeMegabytes = options.CurrentValue.Disk.MinimumFreeMegabytes;

        if (DiskSpace.IsBelowLimit(outDir, minimumFreeMegabytes))
        {
            throw new resonance.InsufficientDiskSpaceException($"Job rejected: free disk space is below the configured minimum of {minimumFreeMegabytes} MB");
        }

        var job = new YtDlpJob
        {
            Url = url,
            SubscriptionId = subscriptionId,
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

        // job came from the in-memory cache, not this DbContext — mutating it alone never
        // persists. Load and update the tracked row too, or the state reverts to whatever's
        // in the database on the next restart, orphaning the just-requeued tracks (their job
        // no longer looks Active, so StartAsync never resumes them).
        var dbJob = await db.Jobs.FindAsync(jobId);
        if (dbJob != null)
        {
            dbJob.FailedTracks = job.FailedTracks;
            dbJob.State = YtDlpJobState.Active;
        }

        await db.SaveChangesAsync();
        await BroadcastJobsAsync();
        await EmitEventAsync(jobId, "info", $"Retrying {failed.Count} failed track(s): {job.Title ?? job.Url}", job);

        foreach (var track in failed)
        {
            _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
        }
    }

    // Sweeps every job with at least one failed track, not just non-permanent ones like the
    // background auto-retry sweep — this is an explicit user action, so it's allowed to retry
    // things like age-restriction failures that only needed a cookie to be uploaded.
    public async Task<int> RetryAllFailedTracksAsync()
    {
        var jobIds = jobs.Values.Where(j => j.FailedTracks > 0).Select(j => j.Id).ToList();
        foreach (var jobId in jobIds)
        {
            await RetryFailedTracksAsync(jobId);
        }

        return jobIds.Count;
    }

    public Task RetryTagWritingAsync(Guid trackId) => RewriteTagsAsync(trackId, overrides: null);

    public Task SetTrackTagsAsync(Guid trackId, string artist, string title, string? album)
        => RewriteTagsAsync(trackId, (artist, title, album));

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

        AppendExtractorArgs(args, opts);
        AppendPluginDirs(args, opts);

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

    public async Task<YtDlpSearchResult?> ResolveUrlAsync(string url, CancellationToken cancellationToken = default)
    {
        var opts = options.CurrentValue.Integrations.YtDlp;

        // The url is interpolated into the argument string, so reject anything that could
        // escape the quotes and smuggle extra yt-dlp options (e.g. --exec)
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || url.Any(c => c == '"' || char.IsWhiteSpace(c)))
        {
            throw new ArgumentException("Not a valid http(s) URL.");
        }

        // --playlist-items 1 keeps channel/playlist resolution to a single cheap entry;
        // --ignore-no-formats-error dumps video metadata even when format selection fails
        var args = new System.Text.StringBuilder("--flat-playlist --dump-single-json --playlist-items 1 --ignore-no-formats-error");
        if (jsRuntimeArg != null)
        {
            args.Append($" {jsRuntimeArg}");
        }

        AppendExtractorArgs(args, opts);
        AppendPluginDirs(args, opts);

        var cookieFile = AcquireCookieFile();
        if (cookieFile != null)
        {
            args.Append($" --cookies \"{cookieFile}\"");
        }

        args.Append($" \"{url}\"");

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

            var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            var stdout = await stdoutTask;

            if (string.IsNullOrWhiteSpace(stdout))
            {
                Log.Warning("YtDlp: resolve of {Url} failed (exit {ExitCode}): {Stderr}", url, process.ExitCode, (await stderrTask).Trim());
                return null;
            }

            return ParseResolvedUrl(stdout);
        }
        finally
        {
            ReleaseCookieFile(cookieFile);
        }
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
        publishLock.Dispose();
    }

    private static string? FindTrackFileUnderKnownExtensions(string filePath)
    {
        var stem = Path.ChangeExtension(filePath, null);
        foreach (var ext in KnownAudioExtensions)
        {
            var candidate = stem + ext;
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
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

    private static YtDlpSearchResult? ParseResolvedUrl(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? string.Empty : string.Empty;
            var title = root.TryGetProperty("title", out var t) ? t.GetString() ?? string.Empty : string.Empty;
            var uploader = root.TryGetProperty("uploader", out var up) ? up.GetString() ?? string.Empty : string.Empty;
            var pageUrl = root.TryGetProperty("webpage_url", out var wu) ? wu.GetString() ?? string.Empty : string.Empty;

            if (pageUrl.Length == 0 || title.Length == 0)
            {
                return null;
            }

            // Channels and playlists both dump as _type "playlist"; only real playlist
            // URLs contain "/playlist". Videos dump as "video" (or omit _type entirely).
            var isListing = root.TryGetProperty("_type", out var typeEl) && typeEl.GetString() == "playlist";
            var resultType = !isListing ? "video"
                : pageUrl.Contains("/playlist", StringComparison.OrdinalIgnoreCase) ? "playlist"
                : "channel";

            var thumbnail = root.TryGetProperty("thumbnail", out var th) ? th.GetString() : null;

            // Channel/playlist dumps have no top-level "thumbnail", only a "thumbnails" array (smallest first)
            if (thumbnail is null
                && root.TryGetProperty("thumbnails", out var thumbs)
                && thumbs.ValueKind == JsonValueKind.Array
                && thumbs.GetArrayLength() > 0
                && thumbs[thumbs.GetArrayLength() - 1].TryGetProperty("url", out var thumbUrl))
            {
                thumbnail = thumbUrl.GetString();
            }

            var duration = root.TryGetProperty("duration", out var dur) && dur.ValueKind == JsonValueKind.Number
                ? (int?)(int)dur.GetDouble()
                : null;

            // A video dump also carries its uploader's follower count; only meaningful for channels
            var subscriberCount = resultType == "channel"
                && root.TryGetProperty("channel_follower_count", out var followers)
                && followers.ValueKind == JsonValueKind.Number
                ? (long?)followers.GetInt64()
                : null;

            if (resultType == "channel" && string.IsNullOrEmpty(uploader))
            {
                uploader = root.TryGetProperty("uploader_id", out var handle) ? handle.GetString() ?? string.Empty : string.Empty;
            }

            return new YtDlpSearchResult(id, pageUrl, title, uploader, thumbnail, duration, resultType, subscriberCount);
        }
        catch
        {
            return null;
        }
    }

    // ponytail: substring heuristic covers youtube watch/youtu.be; extend the check if other hosts matter.
    private static bool IsSingleVideoUrl(string url) =>
        (url.Contains("watch?v=", StringComparison.OrdinalIgnoreCase) || url.Contains("youtu.be/", StringComparison.OrdinalIgnoreCase))
        && !url.Contains("list=", StringComparison.OrdinalIgnoreCase);

    // Deletes any leftover files in staging that share the moved track's stem.
    private static void RemoveStagingSidecars(string movedStagingPath)
    {
        try
        {
            var dir = Path.GetDirectoryName(movedStagingPath);
            if (dir == null)
            {
                return;
            }

            var stem = Path.GetFileNameWithoutExtension(movedStagingPath);
            foreach (var ext in SidecarExtensions)
            {
                var sidecar = Path.Combine(dir, stem + ext);
                if (File.Exists(sidecar))
                {
                    File.Delete(sidecar);
                }
            }
        }
        catch
        {
        }
    }

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
            AutoUpdate = opts.AutoUpdate,
            UpdateIntervalDays = opts.UpdateIntervalDays,
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

    // Operator-controlled config value (not user input), so it's trusted the same as
    // ExecutablePath/BandwidthLimit elsewhere in this file — interpolated as-is.
    private static string ExtractorArgsFlag(resonance.Options.IntegrationsOptions.YtDlpOptions opts) =>
        string.IsNullOrWhiteSpace(opts.ExtractorArgs) ? string.Empty : $" --extractor-args \"{opts.ExtractorArgs}\"";

    private static void AppendExtractorArgs(System.Text.StringBuilder args, resonance.Options.IntegrationsOptions.YtDlpOptions opts) =>
        args.Append(ExtractorArgsFlag(opts));

    // yt-dlp only auto-discovers plugins under its OS config dir or PYTHONPATH, neither of
    // which applies to our standalone binary — so point it at the folder next to the binary
    // itself. --plugin-dirs takes the *parent* of a "yt-dlp-plugins" folder, matching how
    // yt-dlp's own default search dirs work. Currently ships the bgutil PO-token provider
    // (backend/tools/yt-dlp-plugins), which talks to the bgutil-provider sidecar container
    // (docker/docker-compose.yml). No-ops if the executable is a bare PATH name or the
    // plugins folder isn't present next to it.
    private static string PluginDirsFlag(resonance.Options.IntegrationsOptions.YtDlpOptions opts)
    {
        var dir = Path.GetDirectoryName(opts.ExecutablePath);
        if (string.IsNullOrEmpty(dir) || !Directory.Exists(Path.Combine(dir, "yt-dlp-plugins")))
        {
            return string.Empty;
        }

        return $" --plugin-dirs \"{dir}\"";
    }

    // The bundled plugin's own default (http://127.0.0.1:4416) only resolves under host
    // networking, where backend and the sidecar shared a loopback. docker/docker-compose.yml
    // now runs both on a bridge network instead, so point it at the sidecar by container name.
    // yt-dlp allows repeating --extractor-args for different extractors, so this is additive to
    // ExtractorArgsFlag's user-configurable value, never a conflict with it.
    private static string PoTokenProviderFlag(resonance.Options.IntegrationsOptions.YtDlpOptions opts) =>
        string.IsNullOrEmpty(PluginDirsFlag(opts))
            ? string.Empty
            : " --extractor-args \"youtubepot-bgutilhttp:base_url=http://resonance-bgutil-pot-provider:4416\"";

    private static void AppendPluginDirs(System.Text.StringBuilder args, resonance.Options.IntegrationsOptions.YtDlpOptions opts)
    {
        args.Append(PluginDirsFlag(opts));
        args.Append(PoTokenProviderFlag(opts));
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

            // Resolve the channel/uploader name for the subscription title. Flat-playlist of a
            // channel usually omits the per-entry uploader/channel but exposes the playlist-level
            // ones (e.g. "HATE"), so fall back through those.
            string EntryStr(string key) => root.TryGetProperty(key, out var p) ? p.GetString() ?? string.Empty : string.Empty;
            var uploader = new[] { EntryStr("uploader"), EntryStr("channel"), EntryStr("playlist_uploader"), EntryStr("playlist_channel") }
                .FirstOrDefault(s => !string.IsNullOrEmpty(s)) ?? string.Empty;

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

    // Failures that won't be fixed by retrying — don't waste sweeps on them.
    private static bool IsPermanentFailure(string? error)
    {
        if (string.IsNullOrWhiteSpace(error))
        {
            return false;
        }

        var e = error.ToLowerInvariant();
        return e.Contains("age-restricted")
            || e.Contains("age restricted")
            || e.Contains("private video")
            || e.Contains("video unavailable")
            || e.Contains("this video is unavailable")
            || e.Contains("has been removed")
            || e.Contains("members-only")
            || e.Contains("members only")
            || e.Contains("sign in to confirm")
            || e.Contains("copyright")
            || e.Contains("account associated with this video has been terminated")
            || e.Contains("removed by the uploader")
            || e.Contains("no longer available");
    }

    private async Task RewriteTagsAsync(Guid trackId, (string Artist, string Title, string? Album)? overrides)
    {
        await using var db = await dbFactory.CreateDbContextAsync();
        var track = await db.Tracks.FindAsync(trackId);

        if (track is null || track.State != YtDlpTrackState.Completed || track.FilePath is null)
        {
            return;
        }

        if (!File.Exists(track.FilePath))
        {
            // The stored path can go stale if the file was re-encoded to a different container
            // after completion (e.g. a convert-on-completion run, or a manual conversion) without
            // this row's FilePath being updated. Before giving up, look for a sibling file with
            // the same name under any format we know how to tag.
            var resolved = FindTrackFileUnderKnownExtensions(track.FilePath);
            if (resolved != null)
            {
                track.FilePath = resolved;
            }
            else
            {
                track.TagWritingError = "File no longer exists on disk.";
                await db.SaveChangesAsync();
                await BroadcastJobsAsync();
                return;
            }
        }

        var opts = options.CurrentValue.Integrations.YtDlp;
        var metadata = YtDlpMetadataParser.Parse(track.Title, track.Uploader, track.PlaylistIndex, track.UploadDate, opts.DefaultGenre);
        if (overrides is { } o)
        {
            metadata = metadata with { Artist = o.Artist, Title = o.Title, Album = o.Album ?? metadata.Album };
        }

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

    // ── Job execution ────────────────────────────────────────────────────────
    private async Task RunJobAsync(YtDlpJob job, CancellationToken cancellationToken)
    {
        var opts = ApplyJobOverrides(options.CurrentValue.Integrations.YtDlp, job);

        try
        {
            Log.Information("YtDlp: enumerating {Url}", job.Url);
            await EmitEventAsync(job.Id, "info", $"Enumerating: {job.Url}", job);

            // Flat enumeration lists a playlist/channel cheaply but omits per-video title. For a
            // single video that title is exactly what we want to show, so extract it fully (one video).
            var flat = IsSingleVideoUrl(job.Url) ? string.Empty : "--flat-playlist ";

            var process = new Process
            {
                StartInfo = new ProcessStartInfo(opts.ExecutablePath)
                {
                    Arguments = $"{flat}--dump-json{(jsRuntimeArg != null ? " " + jsRuntimeArg : string.Empty)}{ExtractorArgsFlag(opts)}{PluginDirsFlag(opts)}{PoTokenProviderFlag(opts)} \"{job.Url}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                },
            };

            process.Start();

            // Read stderr concurrently — if unread, the pipe buffer fills and the process deadlocks
            var stderrLines = new List<string>();
            var stderrTask = Task.Run(async () =>
            {
                string? errLine;
                while ((errLine = await process.StandardError.ReadLineAsync(CancellationToken.None)) != null)
                {
                    if (!string.IsNullOrWhiteSpace(errLine))
                    {
                        stderrLines.Add(errLine);
                        await hub.BroadcastJobLogAsync(job.Id, errLine, isError: false);
                        await EmitEventAsync(job.Id, "raw", errLine, job);
                    }
                }
            }, CancellationToken.None);

            var tracksFound = 0;
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
                    tracksFound++;
                    await EmitEventAsync(job.Id, "info", $"Found: {track.Title}", job, track.Title);
                    _ = Task.Run(() => RunWorkerAsync(track, cancellationToken), CancellationToken.None);
                }
            }

            await Task.WhenAll(process.WaitForExitAsync(cancellationToken), stderrTask);

            if (job.State == YtDlpJobState.Cancelled || !jobs.ContainsKey(job.Id))
            {
                return;
            }

            await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

            // `tracksFound` counts only queued (downloadable) tracks. A job whose every entry was
            // filtered out at enumeration (duration/duplicate skips) still enumerated successfully
            // and simply has nothing to download — distinguish that from a genuinely empty result
            // by looking at whether any track rows were inserted at all.
            var insertedTracks = await db.Tracks.CountAsync(t => t.JobId == job.Id, cancellationToken);

            // yt-dlp can exit 0 while still failing to produce anything (e.g. an expired/invalid
            // cookie causing YouTube to hard-block the request) — treat "no entries" as a failure
            // instead of leaving the job stuck in Active forever with nothing to do.
            if (insertedTracks == 0)
            {
                var reason = process.ExitCode != 0
                    ? $"yt-dlp exited with code {process.ExitCode} and found no tracks"
                    : "yt-dlp found no tracks";
                var detail = stderrLines.Count > 0 ? $"{reason}: {stderrLines[^1]}" : reason;

                Log.Error("YtDlp: enumeration produced no tracks for {Url} ({Detail})", job.Url, detail);

                job.State = YtDlpJobState.Failed;
                job.CompletedAt = DateTime.UtcNow;

                await using var failedDb = await dbFactory.CreateDbContextAsync(CancellationToken.None);
                var failedDbJob = await failedDb.Jobs.FindAsync(job.Id);
                if (failedDbJob != null)
                {
                    failedDbJob.State = job.State;
                    failedDbJob.CompletedAt = job.CompletedAt;
                    await failedDb.SaveChangesAsync();
                }

                await BroadcastJobsAsync();
                await EmitEventAsync(job.Id, "error", detail, job);
                return;
            }

            var dbJob = await db.Jobs.FindAsync([job.Id], cancellationToken);
            if (dbJob != null)
            {
                dbJob.State = YtDlpJobState.Active;
                await db.SaveChangesAsync(cancellationToken);
            }

            job.State = YtDlpJobState.Active;
            await BroadcastJobsAsync();

            // Every enumerated entry was filtered at enumeration (all out of the duration range or
            // already downloaded), so there is nothing to download. Rather than leave a phantom
            // job in the list — which would otherwise hang in Active or settle as an empty
            // Completed/Failed row — just drop it. This is the common shape for a per-video
            // subscription auto-download of a too-short/too-long (extended-mix) upload.
            if (tracksFound == 0)
            {
                await EmitEventAsync(job.Id, "info", $"Dropped — every track was skipped, nothing to download: {job.Title ?? job.Url}", job);
                await RemoveJobAsync(job.Id);
                return;
            }
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

            // Name to use for the JOB title. Flat-playlist enumeration of a channel usually omits
            // the per-entry uploader but exposes the playlist-level channel/uploader, so fall back
            // to those (e.g. "HATE") instead of leaving the job showing its raw URL.
            string JsonStr(string key) => root.TryGetProperty(key, out var p) ? p.GetString() ?? string.Empty : string.Empty;
            var channelName = !string.IsNullOrEmpty(uploader)
                ? uploader
                : new[] { JsonStr("playlist_uploader"), JsonStr("playlist_channel"), JsonStr("channel") }
                    .FirstOrDefault(s => !string.IsNullOrEmpty(s)) ?? string.Empty;

            // A standalone video (not part of a playlist) reports playlist_index as JSON null
            // rather than omitting it, and TryGetInt32 throws (not just returns false) on a
            // non-Number element — so the ValueKind check is required, not just belt-and-braces.
            var duration = root.TryGetProperty("duration", out var durProp) && durProp.ValueKind == JsonValueKind.Number && durProp.TryGetInt32(out var dur) ? (int?)dur : null;
            var playlistIndex = root.TryGetProperty("playlist_index", out var idxProp) && idxProp.ValueKind == JsonValueKind.Number && idxProp.TryGetInt32(out var idx) ? (int?)idx : null;

            // If the URL is just a video ID, build the full URL
            if (!url.StartsWith("http") && videoId.Length > 0)
            {
                url = $"https://www.youtube.com/watch?v={videoId}";
            }

            // Populate job title/uploader if not set. A single-video job shows the video title;
            // a playlist/channel job shows the channel name.
            var jobTitle = IsSingleVideoUrl(job.Url) && !string.IsNullOrEmpty(title) ? title : channelName;
            if (string.IsNullOrEmpty(job.Title) && !string.IsNullOrEmpty(jobTitle))
            {
                job.Title = jobTitle;
                job.Uploader = channelName;
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
                await EmitEventAsync(job.Id, "info", $"Skipped ({skipReason}): {title}", job, title);
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
                ReportedDurationSeconds = duration,
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

                // Persist the resolved title so it survives restarts (otherwise the job reloads
                // with an empty title and the UI falls back to showing the raw URL).
                if (string.IsNullOrEmpty(dbJob.Title) && !string.IsNullOrEmpty(job.Title))
                {
                    dbJob.Title = job.Title;
                    dbJob.Uploader = job.Uploader;
                    dbJob.ThumbnailUrl = job.ThumbnailUrl;
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
        await EmitEventAsync(track.JobId, "info", downloadMessage, job, track.Title);

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
        var stderrLines = new List<string>();

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
                        stderrLines.Add(errLine);

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
                var reason = "yt-dlp exited with code " + process.ExitCode;
                var detail = stderrError ?? (stderrLines.Count > 0 ? $"{reason}: {stderrLines[^1]}" : reason);
                await HandleFailureAsync(track, detail, opts, db, job);
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
            await EmitEventAsync(track.JobId, "error", $"Tags not written for \"{track.Title}\": file not found", job, track.Title);
        }
        else
        {
            tagError = YtDlpTagWriter.Write(filePath, metadata, track.Url, out fileDuration);

            if (tagError == null && fileDuration.HasValue && track.ReportedDurationSeconds is { } expectedDuration
                && expectedDuration > 0 && fileDuration.Value < expectedDuration * TruncatedDownloadRatio)
            {
                var reason = $"downloaded file is only {FormatDuration(fileDuration.Value)}, expected ~{FormatDuration(expectedDuration)} — likely an interrupted download";
                Log.Warning(
                    "YtDlp: {Title} downloaded truncated ({Actual}s of {Expected}s expected) — discarding and retrying",
                    track.Title, fileDuration.Value, expectedDuration);

                try
                {
                    File.Delete(filePath);
                }
                catch (Exception ex)
                {
                    Log.Warning("YtDlp: failed to delete truncated file {File}: {Error}", filePath, ex.Message);
                }

                // Sidecars (thumbnail, .part, etc) share the same stem and must go too, otherwise
                // a retry's yt-dlp invocation can still find and re-adopt the stale partial output.
                RemoveStagingSidecars(filePath);

                await HandleFailureAsync(track, reason, opts, db, job);
                return;
            }

            if (tagError != null)
            {
                Log.Warning("YtDlp: tag writing failed for {File}: {Error}", filePath, tagError);
                await EmitEventAsync(track.JobId, "error", $"Tag problem for \"{track.Title}\": {tagError}", job, track.Title);
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

                await EmitEventAsync(track.JobId, "info", $"ID3: {string.Join(" · ", parts)}", job, track.Title);
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

        // Whether this track was already carrying a tag error from a prior attempt, captured
        // before we overwrite it below so the job counter can be adjusted by transition.
        var wasTagFailed = dbTrack?.TagWritingError != null;

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

            // Tag-error tally follows the track's current state across retries: count a newly
            // flagged track, and uncount one whose retry finally tagged cleanly. Only reacting to
            // transitions keeps the counter accurate — a plain increment would double-count a
            // track that fails tagging on more than one attempt and never recover on success.
            var nowTagFailed = tagError != null;
            if (nowTagFailed && !wasTagFailed)
            {
                job.TagFailedTracks++;
            }
            else if (!nowTagFailed && wasTagFailed)
            {
                job.TagFailedTracks = Math.Max(0, job.TagFailedTracks - 1);
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
            await EmitEventAsync(track.JobId, "warning", $"Tag error: {track.Title} — {tagError}", job, track.Title);
        }
        else
        {
            await EmitEventAsync(track.JobId, "success", $"Completed: {track.Title}", job, track.Title);
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

        await EmitEventAsync(track.JobId, "info", $"Skipped ({reason}): {track.Title}", job, track.Title);
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

        if (!IsPermanentFailure(error) && track.AttemptCount < opts.MaxRetryAttempts)
        {
            Log.Warning("YtDlp: attempt {Attempt}/{Max} failed for {Title}, retrying", track.AttemptCount, opts.MaxRetryAttempts, track.Title);
            await EmitEventAsync(track.JobId, "warning", $"Retry ({track.AttemptCount}/{opts.MaxRetryAttempts}): {track.Title} — {error}", job, track.Title);
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

            await EmitEventAsync(track.JobId, "error", $"Failed: {track.Title} — {error}", job, track.Title);
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

        // Recomputed from the actual rows rather than trusting the running increment/decrement
        // counter, which can drift out of sync after restarts or concurrency conflicts on retry.
        var tagFailedCount = await db.Tracks.CountAsync(t => t.JobId == job.Id && t.TagWritingError != null, cancellationToken);

        // A stopped job stays Cancelled; everything else finalizes as Completed
        var finalState = job.State == YtDlpJobState.Cancelled ? YtDlpJobState.Cancelled : YtDlpJobState.Completed;
        job.State = finalState;
        job.CompletedAt ??= DateTime.UtcNow;
        job.FailedTracks = failedCount;
        job.TagFailedTracks = tagFailedCount;

        var dbJob = await db.Jobs.FindAsync([job.Id], cancellationToken);
        if (dbJob != null)
        {
            dbJob.State = finalState;
            dbJob.CompletedAt = job.CompletedAt;
            dbJob.FailedTracks = failedCount;
            dbJob.TagFailedTracks = tagFailedCount;
        }

        // Publishing happens here and nowhere else: a job's tracks stay in (excluded) staging
        // until the whole job has finished, so the share and library never expose a half-finished
        // album. Everything staged moves out in one go, then the staging directory is cleared.
        var stagingDir = GetStagingDirectory(job.Id);
        var touched = new HashSet<string>(StringComparer.Ordinal);
        if (Directory.Exists(stagingDir))
        {
            await publishLock.WaitAsync(cancellationToken);
            try
            {
                var staged = await db.Tracks
                    .Where(t => t.JobId == job.Id && t.FilePath != null && t.FilePath.StartsWith(stagingDir))
                    .ToListAsync(cancellationToken);

                var convertFormat = (job.ConvertOnCompletionFormatOverride
                    ?? options.CurrentValue.Integrations.YtDlp.ConvertOnCompletionFormat)?.Trim();
                if (AudioConverter.IsConvertibleTarget(convertFormat))
                {
                    var pendingConv = staged.Count(t => AudioConverter.NeedsConversion(t.FilePath, convertFormat!));
                    if (pendingConv > 0)
                    {
                        await EmitEventAsync(job.Id, "info", $"Converting {pendingConv} track(s) to {convertFormat} before publishing…", job);
                    }
                }

                await MoveStagedTracksAsync(job, db, staged, convertFormat, touched, cancellationToken);
            }
            finally
            {
                publishLock.Release();
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

        await RescanOutputAsync(touched);

        var verb = job.State == YtDlpJobState.Cancelled ? "Stopped" : "Done";
        await EmitEventAsync(job.Id, "success",
            $"{verb}: {job.Title ?? job.Url} ({job.CompletedTracks} completed, {job.FailedTracks} failed, {job.SkippedTracks} skipped)",
            job);
    }

    // Retries the folder rescans a throttled (or busy) publish left pending, so a job that
    // finishes just after another one still lands in the share and library.
    private async Task RunRescanFlushLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                await FlushPendingRescanAsync();
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log.Error(ex, "YtDlp: rescan-flush loop terminated unexpectedly");
        }
    }

    // Optionally converts, verifies artwork, then moves each staged track to the output directory,
    // updating its FilePath and removing the track's staging leftovers. Caller holds publishLock.
    // Returns the number of tracks actually moved.
    private async Task<int> MoveStagedTracksAsync(YtDlpJob job, YtDlpDbContext db, System.Collections.Generic.List<YtDlpTrack> tracks, string? convertFormat, ISet<string> touchedDirs, CancellationToken cancellationToken)
    {
        if (tracks.Count == 0)
        {
            return 0;
        }

        var stagingDir = GetStagingDirectory(job.Id);

        if (AudioConverter.IsConvertibleTarget(convertFormat))
        {
            foreach (var t in tracks)
            {
                await ConvertStagedTrackAsync(t, convertFormat!, job, cancellationToken);
            }
        }

        var moved = 0;
        foreach (var t in tracks)
        {
            var source = t.FilePath;
            if (string.IsNullOrEmpty(source) || !File.Exists(source))
            {
                continue;
            }

            try
            {
                // Light artwork safety net before publishing — embeds a leftover thumbnail if the
                // file somehow has no cover. Heavier tag writing already ran at download time.
                YtDlpTagWriter.EnsureArtwork(source);

                var relative = Path.GetRelativePath(stagingDir, source);
                var dest = Path.Combine(job.OutputDirectory, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                File.Move(source, dest, overwrite: true);
                t.FilePath = dest;
                moved++;

                var destDir = Path.GetDirectoryName(dest);
                if (destDir != null)
                {
                    touchedDirs.Add(destDir);
                }

                RemoveStagingSidecars(source);
            }
            catch (Exception ex)
            {
                Log.Warning("YtDlp: failed to move staged file {Path}: {Error}", source, ex.Message);
            }
        }

        return moved;
    }

    // Queues freshly-published folders for a rescan. The actual library/share scan is coalesced
    // and rate-limited (see FlushPendingRescanAsync) so a run of jobs finishing together can't fire
    // a scan apiece — which would otherwise hammer the shares cache and stall searches.
    private Task RescanOutputAsync(IReadOnlyCollection<string> directories)
    {
        if (directories.Count > 0)
        {
            lock (rescanGate)
            {
                foreach (var d in directories)
                {
                    pendingRescanDirs.Add(d);
                }
            }
        }

        return FlushPendingRescanAsync();
    }

    // Runs a TARGETED rescan of the accumulated folders, but only if at least RescanMinInterval has
    // passed since the last one. Scanning just the touched folders (not the whole music root) keeps
    // the SQLite write lock window short; the interval gate keeps it infrequent.
    private async Task FlushPendingRescanAsync()
    {
        string[] toScan;
        lock (rescanGate)
        {
            if (pendingRescanDirs.Count == 0 || DateTime.UtcNow - lastRescanAt < RescanMinInterval)
            {
                return;
            }

            lastRescanAt = DateTime.UtcNow;
            toScan = pendingRescanDirs.ToArray();
            pendingRescanDirs.Clear();
        }

        library.TriggerSync();

        try
        {
            await shares.ScanDirectoriesAsync(toScan);
        }
        catch (resonance.ShareScanInProgressException)
        {
            // A scan is already running — put the folders back so the flush loop retries them;
            // a running *targeted* scan of other folders would otherwise leave these unindexed.
            Requeue(toScan);
        }
        catch (Exception ex)
        {
            Log.Warning("YtDlp: targeted share rescan failed: {Error}", ex.Message);
            Requeue(toScan);
        }

        void Requeue(string[] dirs)
        {
            lock (rescanGate)
            {
                foreach (var d in dirs)
                {
                    pendingRescanDirs.Add(d);
                }
            }
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    private async Task EmitEventAsync(Guid? jobId, string level, string message, YtDlpJob? job = null, string? trackTitle = null)
    {
        var timestamp = DateTime.UtcNow;
        var title = job?.Title ?? job?.Url;
        var ev = new YtDlpEvent(timestamp, jobId, title, level, message, trackTitle);
        eventBuffer.Enqueue(ev);
        while (eventBuffer.Count > EventBufferMax)
        {
            eventBuffer.TryDequeue(out _);
        }

        // Persist everything except the high-volume raw yt-dlp stderr/progress lines (which would
        // bloat the table) — those live in the volatile buffer only. Persisted events survive
        // restarts and buffer eviction, and are removed only when the user clears the log.
        if (!string.Equals(level, "raw", StringComparison.Ordinal))
        {
            try
            {
                await using var db = await dbFactory.CreateDbContextAsync();
                db.Events.Add(new YtDlpEventRecord
                {
                    Timestamp = timestamp,
                    JobId = jobId,
                    JobTitle = title,
                    TrackTitle = trackTitle,
                    Level = level,
                    Message = message,
                });
                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                Log.Warning("YtDlp: failed to persist event: {Message}", ex.Message);
            }
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
            await EmitEventAsync(track.JobId, "info", $"Converted to {targetFormat}: {track.Title}", job, track.Title);
        }
        else
        {
            Log.Warning("YtDlp: conversion to {Format} failed for {Title}: {Error}", targetFormat, track.Title, result.Error);
            await EmitEventAsync(track.JobId, "warning", $"Conversion to {targetFormat} failed for \"{track.Title}\" — keeping original", job, track.Title);
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

        // YouTube serves webp thumbnails, which TagLib# fails to embed (silently, no APIC frame).
        // Convert to jpg via ffmpeg so the tag writer can reliably embed cover art.
        args.Append(" --convert-thumbnails jpg");
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

        AppendExtractorArgs(args, opts);
        AppendPluginDirs(args, opts);

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

            // skip the check entirely while below the safe free-space limit, before LastVideoId advances,
            // so blocked videos are picked up again once space frees up
            var subOutDir = !string.IsNullOrWhiteSpace(sub.OutputDirectoryOverride) ? sub.OutputDirectoryOverride
                : !string.IsNullOrWhiteSpace(opts.OutputDirectory) ? opts.OutputDirectory
                : options.CurrentValue.Directories.Downloads;

            if (DiskSpace.IsBelowLimit(subOutDir, options.CurrentValue.Disk.MinimumFreeMegabytes))
            {
                sub.LastError = $"Skipped: free disk space is below the configured minimum of {options.CurrentValue.Disk.MinimumFreeMegabytes} MB";
                sub.LastCheckedAt = DateTime.UtcNow;
                await PersistSubscriptionAsync(sub, CancellationToken.None);
                await BroadcastSubscriptionsAsync();
                return;
            }

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

                try
                {
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
                        cancellationToken,
                        sub.Id);
                }
                catch (resonance.InsufficientDiskSpaceException ex)
                {
                    // space dropped below the limit mid-loop; surface it and stop rather than killing the poll loop
                    sub.LastError = ex.Message;
                    break;
                }

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

        AppendExtractorArgs(args, opts);
        AppendPluginDirs(args, opts);

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

    // ── Auto-retry ────────────────────────────────────────────────────────────
    // Ticks on a fixed interval and re-queues failed downloads. Most failures in a bulk
    // channel pull are transient (dropped connections, throttling), so a periodic sweep
    // recovers them without manual intervention. Clearly-permanent failures are skipped,
    // and an in-memory per-track round cap keeps dead videos from retrying forever.
    private async Task RunAutoRetryLoopAsync(CancellationToken cancellationToken)
    {
        var intervalMinutes = Math.Clamp(options.CurrentValue.Integrations.YtDlp.AutoRetryIntervalMinutes, 5, 1440);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(intervalMinutes));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                var opts = options.CurrentValue.Integrations.YtDlp;
                if (!opts.Enabled || !opts.AutoRetryFailed)
                {
                    continue;
                }

                await AutoRetryFailedTracksAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log.Error(ex, "YtDlp: auto-retry loop terminated unexpectedly");
        }
    }

    private async Task AutoRetryFailedTracksAsync(CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        var failed = await db.Tracks
            .Where(t => t.State == YtDlpTrackState.Failed)
            .ToListAsync(cancellationToken);

        var retried = new List<YtDlpTrack>();
        var perJob = new Dictionary<Guid, int>();

        foreach (var track in failed)
        {
            // Skip tracks whose job is gone or stopped, permanent failures, and over-budget tracks.
            if (!jobs.TryGetValue(track.JobId, out var job) || job.State == YtDlpJobState.Cancelled)
            {
                continue;
            }

            if (IsPermanentFailure(track.Error))
            {
                continue;
            }

            var rounds = autoRetryCounts.GetValueOrDefault(track.Id, 0);
            if (rounds >= MaxAutoRetryRounds)
            {
                continue;
            }

            autoRetryCounts[track.Id] = rounds + 1;
            track.State = YtDlpTrackState.Queued;
            track.AttemptCount = 0;
            track.Error = null;
            retried.Add(track);
            perJob[track.JobId] = perJob.GetValueOrDefault(track.JobId, 0) + 1;
        }

        if (retried.Count == 0)
        {
            return;
        }

        foreach (var (jobId, count) in perJob)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.FailedTracks = Math.Max(0, job.FailedTracks - count);
                job.State = YtDlpJobState.Active;
            }

            var dbJob = await db.Jobs.FindAsync([jobId], cancellationToken);
            if (dbJob != null)
            {
                dbJob.FailedTracks = Math.Max(0, dbJob.FailedTracks - count);
                dbJob.State = YtDlpJobState.Active;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await BroadcastJobsAsync();
        await EmitEventAsync(null, "info", $"Auto-retrying {retried.Count} failed download(s)");

        foreach (var track in retried)
        {
            _ = Task.Run(() => RunWorkerAsync(track, cts.Token), CancellationToken.None);
        }
    }

    // Checks immediately on startup (so a binary that went stale while the service was down gets
    // fixed on restart) and then on the configured interval thereafter.
    private async Task RunAutoUpdateLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            var opts = options.CurrentValue.Integrations.YtDlp;
            if (opts.Enabled && opts.AutoUpdate)
            {
                try
                {
                    var (_, _, updateAvailable) = await CheckForUpdateAsync(cancellationToken);
                    if (updateAvailable)
                    {
                        var newVersion = await UpdateYtDlpAsync(cancellationToken);
                        Log.Information("YtDlp: auto-updated to {Version}", newVersion);
                        await EmitEventAsync(null, "info", $"yt-dlp auto-updated to {newVersion}");
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "YtDlp: background update check failed: {Message}", ex.Message);
                }
            }

            var intervalDays = Math.Clamp(options.CurrentValue.Integrations.YtDlp.UpdateIntervalDays, 1, 30);
            try
            {
                await Task.Delay(TimeSpan.FromDays(intervalDays), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private Task BroadcastSubscriptionsAsync() => hub.BroadcastSubscriptionsAsync(ListSubscriptions());

    private Task BroadcastJobsAsync() => hub.BroadcastJobsAsync(jobs.Values.OrderByDescending(j => j.RequestedAt));

    private sealed record ChannelEntry(string VideoId, string Url, string Title, string Uploader, string? ThumbnailUrl);
}
