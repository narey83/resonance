// <copyright file="AnalysisService.cs" company="John Narey">
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

namespace resonance.Analysis
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using resonance.Common;
    using resonance.Common.Ffmpeg;
    using resonance.MusicLibrary;
    using resonance.MusicLibrary.API;
    using resonance.Shares;
    using Serilog;

    /// <summary>
    ///     The single scan orchestrator for every audio metric. One queue, one worker pool, one
    ///     progress state — a track is decoded once and every requested metric is taken from that
    ///     one decode.
    /// </summary>
    public class AnalysisService : IAnalysisService, IHostedService
    {
        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        // How recently a stream request must have landed to count as "still listening". Player
        // buffering means a paused/idle stream can go quiet for a while between range requests,
        // so this is generous rather than a tight heartbeat interval.
        private static readonly TimeSpan PlaybackIdleWindow = TimeSpan.FromSeconds(45);

        // Upper bound on how long the auto BPM check waits for playback to go quiet before
        // running anyway — a busy library shouldn't let a bad tag sit uncorrected indefinitely
        // just because someone's been listening all evening.
        private static readonly TimeSpan MaxPlaybackWait = TimeSpan.FromMinutes(10);

        // How often a running scan is allowed to broadcast a waveform/loudness update. Bpm/Key
        // ride the tag-write's own (debounced) sync broadcast for free; Waveform/Loudness never
        // touch a tag, so without a broadcast of their own an open Library row could sit on a
        // stale "not analysed" waveform indefinitely after a scan quietly filled it in. Throttled
        // rather than sent per track — a full-library scan can touch tens of thousands of rows.
        private static readonly TimeSpan WaveformBroadcastThrottle = TimeSpan.FromSeconds(1);

        // One decode per file at a time, shared across every caller — the scan queue and the
        // on-demand single-track methods (GetWaveformAsync, GetLoudnessAsync) used to have no
        // idea about each other, so playing a track while a scan was already touching it could
        // start two ffmpeg/Essentia passes over the same file at once.
        // ponytail: grows one entry per distinct path ever analysed and nothing is ever evicted —
        // a SemaphoreSlim is a few dozen bytes, so even a 50k-track library tops out around a few
        // MB. Evict here if a profile ever says otherwise.
        private readonly ConcurrentDictionary<string, SemaphoreSlim> pathLocks = new();

        // Ticks (DateTime.UtcNow.Ticks), not a DateTime — a plain field can't be updated
        // atomically from the stream endpoint's request threads while a background analysis
        // task reads it, so this goes through Interlocked instead of a lock.
        private long lastPlaybackActivityTicks;
        private long lastWaveformBroadcastTicks;

        public AnalysisService(
            IShareService shareService,
            IOptionsMonitor<resonance.Options> optionsMonitor,
            IFfmpegService ffmpeg,
            AnalysisStore store,
            IMusicLibraryService musicLibrary = null,
            IHubContext<LibraryActivityHub> hub = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            Ffmpeg = ffmpeg;
            Store = store;
            MusicLibrary = musicLibrary;
            Hub = hub;
        }

        public AnalysisScanState ScanState => CurrentState;

        private IShareService ShareService { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private IFfmpegService Ffmpeg { get; }
        private AnalysisStore Store { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private IHubContext<LibraryActivityHub> Hub { get; }
        private AudioAnalyzer Analyzer { get; } = new AudioAnalyzer();
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

        private AnalysisScanState CurrentState { get; set; } = new(false, false, false, 0, 0, 0, 0, 0);
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }
        private Task ScanTask { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken)
        {
            if (MusicLibrary != null)
            {
                MusicLibrary.NewTracksIndexed += OnNewTracksIndexed;
            }

            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            if (Cts != null && !Cts.IsCancellationRequested)
            {
                Log.Information("Cancelling analysis scan for graceful shutdown...");
                Cts.Cancel();
            }

            if (ScanTask != null)
            {
                try
                {
                    await ScanTask.WaitAsync(cancellationToken);
                }
                catch
                { /* scan cancelled or shutdown timed out — either is acceptable */
                }
            }
        }

        // ── Public API ────────────────────────────────────────────────────────

        /// <summary>
        ///     Returns analysis info for the named tracks only.
        /// </summary>
        /// <remarks>
        ///     Analysing a chosen track used to go through <see cref="GetAllTracks"/> and filter, so
        ///     the decode of one file waited on the tags of ~48,000 being read and sorted first —
        ///     minutes of nothing happening after the click.
        /// </remarks>
        /// <param name="maskedFilenames">The masked filenames to describe.</param>
        /// <returns>The analysis info for those of them that are in the share.</returns>
        public IEnumerable<TrackAnalysisInfo> GetTracks(IEnumerable<string> maskedFilenames)
        {
            var status = Store.GetStatusMap();

            return ShareService.FindFiles(maskedFilenames)
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f =>
                {
                    var (hasWaveform, lufs) = status.TryGetValue(MusicPath.ToRelative(f.OriginalFilename), out var s)
                        ? s
                        : (false, (double?)null);

                    return new TrackAnalysisInfo(
                        f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                        f.Tags == null || f.Tags.Bpm == 0 ? null : f.Tags.Bpm,
                        f.Tags?.Key,
                        hasWaveform,
                        lufs,
                        f.Tags?.Artist, f.Tags?.Title, f.Tags?.Album);
                })
                .DistinctBy(t => t.MaskedFilename)
                .ToList();
        }

        public IEnumerable<TrackAnalysisInfo> GetAllTracks()
        {
            var status = Store.GetStatusMap();

            (bool HasWaveform, double? Lufs) Cached(string original) =>
                status.TryGetValue(MusicPath.ToRelative(original), out var s) ? s : (false, null);

            var tagged = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f =>
                {
                    var (hasWaveform, lufs) = Cached(f.OriginalFilename);
                    return new TrackAnalysisInfo(
                        f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                        f.Tags.Bpm == 0 ? null : f.Tags.Bpm,
                        f.Tags.Key,
                        hasWaveform,
                        lufs,
                        f.Tags.Artist, f.Tags.Title, f.Tags.Album);
                });

            var untagged = ShareService.GetUntaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f =>
                {
                    var (hasWaveform, lufs) = Cached(f.OriginalFilename);
                    return new TrackAnalysisInfo(
                        f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                        null, null, hasWaveform, lufs, null, null, null);
                });

            return tagged
                .Concat(untagged)
                .DistinctBy(t => t.MaskedFilename)
                .OrderBy(t => t.Artist ?? t.Directory)
                .ThenBy(t => t.Title ?? t.Filename)
                .ToList();
        }

        public async Task StartScanAsync(AnalysisScanRequest request)
        {
            if (!await SyncRoot.WaitAsync(0))
            {
                Log.Warning("Analysis scan rejected; scan already in progress.");
                throw new InvalidOperationException("An analysis scan is already in progress.");
            }

            // Mark as scanning immediately so GET /scan reports it as soon as the POST response
            // lands, rather than only once the background task has spun up.
            SetState(true, false, false, 0, 0, 0, 0, metrics: request.Metrics.ToString());

            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            ScanTask = Task.Run(() => RunScanAsync(request, Cts.Token), Cts.Token);
        }

        public bool CancelScan()
        {
            if (Cts == null || Cts.IsCancellationRequested)
            {
                return false;
            }

            Cts.Cancel();
            return true;
        }

        public async Task<WaveformData> GetWaveformAsync(string path, CancellationToken ct, bool cachedOnly = false)
        {
            var cached = Store.GetWaveform(path);
            if (cached != null || cachedOnly)
            {
                return cached;
            }

            var gate = LockFor(path);
            await gate.WaitAsync(ct);
            try
            {
                // Someone else (the scan queue, or another player/row) may have finished
                // decoding this exact file while this call was waiting for the gate.
                cached = Store.GetWaveform(path);
                if (cached != null)
                {
                    return cached;
                }

                // A single-track miss also measures loudness, since the decode is already paid for
                // and the player asks for both.
                var result = await AnalyseOneAsync(
                    path, AnalysisMetrics.Waveform | AnalysisMetrics.Loudness, ct);
                if (result?.Waveform == null)
                {
                    return null;
                }

                SaveAndNotify(path, result);
                return result.Waveform;
            }
            finally
            {
                gate.Release();
            }
        }

        public async Task<LoudnessData> GetLoudnessAsync(string path, CancellationToken ct)
        {
            var cached = Store.GetLoudness(path);
            if (cached != null)
            {
                return cached;
            }

            var gate = LockFor(path);
            await gate.WaitAsync(ct);
            try
            {
                cached = Store.GetLoudness(path);
                if (cached != null)
                {
                    return cached;
                }

                var result = await AnalyseOneAsync(path, AnalysisMetrics.Loudness, ct);
                if (result?.Loudness == null)
                {
                    return null;
                }

                SaveAndNotify(path, result);
                return result.Loudness;
            }
            finally
            {
                gate.Release();
            }
        }

        public void SetBpm(string maskedFilename, uint bpm) => Apply(maskedFilename, bpm, null);

        public void SetKey(string maskedFilename, string key) => Apply(maskedFilename, null, key);

        /// <summary>
        ///     Writes any detected BPM and key to the file's tags in a single pass.
        /// </summary>
        /// <remarks>
        ///     One write, not one per metric: WriteFileTags rewrites the whole tag block through
        ///     TagLib, so writing BPM and key separately rewrote every scanned file twice.
        /// </remarks>
        public void Apply(string maskedFilename, uint? bpm, string key)
        {
            var hasBpm = bpm.HasValue && bpm.Value != 0;
            var hasKey = !string.IsNullOrEmpty(key);
            if (!hasBpm && !hasKey)
            {
                return;
            }

            var updated = ShareService.GetTags(maskedFilename) ?? new FileTags(null, null, null, null, 0, 0, null);
            if (hasBpm)
            {
                updated = updated with { Bpm = bpm.Value };
            }

            if (hasKey)
            {
                updated = updated with { Key = key };
            }

            ShareService.WriteFileTags(maskedFilename, updated);
        }

        public void ClearBpm(string maskedFilename) => UpdateTags(maskedFilename, t => t with { Bpm = 0 });

        public void ClearKey(string maskedFilename) => UpdateTags(maskedFilename, t => t with { Key = null });

        public void RecordPlaybackActivity() => Interlocked.Exchange(ref lastPlaybackActivityTicks, DateTime.UtcNow.Ticks);

        /// <summary>
        ///     Resolves a library path to the masked filename the tag-editing endpoints key on.
        /// </summary>
        /// <remarks>
        ///     The analysis page lists rows from the paged library query, which knows paths and not
        ///     masked names. Rather than resolve a name for every row on the page up front, it asks
        ///     for one at the moment somebody edits that row's key or BPM.
        /// </remarks>
        /// <param name="path">An absolute or root-relative library path.</param>
        /// <returns>The masked filename, or null if the path is not in the share.</returns>
        public string ResolveMaskedFilename(string path) =>
            string.IsNullOrWhiteSpace(path)
                ? null
                : ShareService.FindMaskedFilenames([MusicPath.ToRelative(path)]).FirstOrDefault();

        // Waveform/loudness results never touch a file's tags — unlike Bpm/Key, there's no
        // WriteFileTags → TriggerSync → LIBRARY_UPDATED chain to ride along on, so a row showing
        // one of these would otherwise sit stale until something else happened to refresh the
        // list. Broadcasting here, right where the value lands in the DB, covers both on-demand
        // single-track callers (GetWaveformAsync, GetLoudnessAsync).
        private void SaveAndNotify(string path, AnalysisResult result)
        {
            Store.Save(path, result);
            _ = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
        }

        // ── Scan loop ─────────────────────────────────────────────────────────
        private void UpdateTags(string maskedFilename, Func<FileTags, FileTags> update)
        {
            var existing = ShareService.GetTags(maskedFilename);
            if (existing == null)
            {
                return;
            }

            ShareService.WriteFileTags(maskedFilename, update(existing));
        }

        private async Task<AnalysisResult> AnalyseOneAsync(
            string originalFilename, AnalysisMetrics metrics, CancellationToken ct)
        {
            var ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
            return await Analyzer.AnalyseAsync(originalFilename, ffmpegPath, metrics, Options.CurrentValue.Analysis, ct);
        }

        private SemaphoreSlim LockFor(string path) => pathLocks.GetOrAdd(path, _ => new SemaphoreSlim(1, 1));

        private bool IsPlaybackActive() =>
            DateTime.UtcNow.Ticks - Interlocked.Read(ref lastPlaybackActivityTicks) < PlaybackIdleWindow.Ticks;

        /// <summary>
        ///     Polls until no client has streamed audio for <see cref="PlaybackIdleWindow"/>, so
        ///     the auto BPM check's decode+Essentia pass never competes with someone actively
        ///     listening. Gives up and proceeds anyway after <see cref="MaxPlaybackWait"/> so a
        ///     bad tag can't be starved of correction by continuous listening.
        /// </summary>
        private async Task WaitForPlaybackIdleAsync()
        {
            if (!IsPlaybackActive())
            {
                return;
            }

            Log.Information("Auto analysis: playback is active — waiting for it to go idle before analysing new tracks.");

            var deadline = DateTime.UtcNow + MaxPlaybackWait;
            while (IsPlaybackActive() && DateTime.UtcNow < deadline)
            {
                await Task.Delay(TimeSpan.FromSeconds(10));
            }

            if (IsPlaybackActive())
            {
                Log.Information(
                    "Auto analysis: gave up waiting for playback to go idle after {Minutes:F0} minutes — proceeding anyway.",
                    MaxPlaybackWait.TotalMinutes);
            }
            else
            {
                Log.Information("Auto analysis: playback went idle — proceeding.");
            }
        }

        /// <summary>
        ///     True if a track's BPM tag looks like real data rather than a half-/double-time
        ///     mistag some DJ-pool release shipped with (e.g. "42" for a 168bpm track).
        /// </summary>
        /// <remarks>
        ///     A hand-typed tag never goes through <see cref="AudioAnalyzer.FoldOctave"/>, so
        ///     unlike a computed detection it can sit outside the configured tempo window forever
        ///     — <see cref="MissingMetrics"/> otherwise treats any nonzero tag as "already
        ///     analysed" and never revisits it. Folding the tag value against that same window is
        ///     just reusing the octave-error check the detector already relies on.
        /// </remarks>
        private bool HasReliableBpm(TrackAnalysisInfo track)
        {
            if (!track.HasBpm)
            {
                return false;
            }

            var analysis = Options.CurrentValue.Analysis;
            return AudioAnalyzer.FoldOctave(track.Bpm.Value, analysis.MinBpm, analysis.MaxBpm) == track.Bpm.Value;
        }

        /// <summary>
        ///     Runs the full analysis pass (BPM, key, waveform, loudness) on tracks a library sync
        ///     just added — the same single-decode pipeline a manual scan uses — so a fresh
        ///     download doesn't sit incomplete, or wrong (an implausible BPM tag, per
        ///     <see cref="HasReliableBpm"/>), until someone runs a scan by hand.
        /// </summary>
        /// <remarks>
        ///     <see cref="AnalysisScanRequest.AllowBpmFabrication"/> is false here: a track with no
        ///     BPM tag at all is left alone (a blank BPM is often correct — ambient, spoken word —
        ///     not something to fabricate a value for). Key/waveform/loudness have no such
        ///     ambiguity, so they're always filled in for a new track.
        /// </remarks>
        private void OnNewTracksIndexed(IReadOnlyList<string> paths)
        {
            // Offloaded: this runs synchronously on the library sync's own thread, and resolving
            // masked filenames / starting a scan must not delay that sync from completing.
            _ = Task.Run(async () =>
            {
                try
                {
                    var masked = ShareService
                        .FindMaskedFilenames(paths.Select(MusicPath.ToRelative).Distinct(StringComparer.OrdinalIgnoreCase))
                        .Distinct()
                        .ToArray();

                    if (masked.Length == 0)
                    {
                        return;
                    }

                    await WaitForPlaybackIdleAsync();
                    await StartScanAsync(new AnalysisScanRequest(
                        Metrics: AnalysisMetrics.All, SkipAnalysed: true, OnlyFilenames: masked, AllowBpmFabrication: false));
                }
                catch (InvalidOperationException)
                {
                    // A manual/other scan was already running. Rare enough not to warrant queuing
                    // or retrying — the next scan someone runs will still catch these via the
                    // normal SkipAnalysed=true plausibility check.
                    Log.Debug("Skipped auto analysis for {Count} new track(s) — a scan was already running.", paths.Count);
                }
                catch (Exception ex)
                {
                    Log.Warning("Auto analysis for new tracks failed: {Error}", ex.Message);
                }
            });
        }

        /// <summary>
        ///     The masked filenames a scan request selects, with any <see cref="AnalysisScanRequest.OnlyPaths"/>
        ///     resolved and folded in. Null means "the whole library"; empty means "nothing", which is
        ///     also what an OnlyPaths selection that resolved to no shared file has to mean.
        /// </summary>
        private string[] Selection(AnalysisScanRequest request)
        {
            if (request.OnlyPaths == null)
            {
                return request.OnlyFilenames;
            }

            var resolved = ShareService
                .FindMaskedFilenames(request.OnlyPaths.Select(MusicPath.ToRelative).Distinct(StringComparer.OrdinalIgnoreCase))
                .ToArray();

            if (resolved.Length < request.OnlyPaths.Length)
            {
                Log.Debug(
                    "Analysis selection: {Resolved} of {Requested} path(s) are in the share.",
                    resolved.Length, request.OnlyPaths.Length);
            }

            return (request.OnlyFilenames ?? []).Concat(resolved).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }

        /// <summary>
        ///     Narrows the requested metrics to those this track is actually missing, so a rescan
        ///     of a mostly-analysed library only pays for the gaps.
        /// </summary>
        private AnalysisMetrics MissingMetrics(TrackAnalysisInfo track, AnalysisMetrics requested, bool allowBpmFabrication)
        {
            var missing = AnalysisMetrics.None;

            if (requested.HasFlag(AnalysisMetrics.Bpm) && !HasReliableBpm(track) && (allowBpmFabrication || track.HasBpm))
            {
                missing |= AnalysisMetrics.Bpm;
            }

            if (requested.HasFlag(AnalysisMetrics.Key) && !track.HasKey)
            {
                missing |= AnalysisMetrics.Key;
            }

            if (requested.HasFlag(AnalysisMetrics.Waveform) && !track.HasWaveform)
            {
                missing |= AnalysisMetrics.Waveform;
            }

            if (requested.HasFlag(AnalysisMetrics.Loudness) && !track.HasLoudness)
            {
                missing |= AnalysisMetrics.Loudness;
            }

            return missing;
        }

        private async Task RunScanAsync(AnalysisScanRequest request, CancellationToken ct)
        {
            MusicLibrary?.RegisterQueue("analysis");
            try
            {
                // null  → scan all files
                // []    → scan nothing (explicit empty selection)
                // [...] → restrict to the named files
                //
                // OnlyPaths is the same selection expressed as library paths; resolving it here
                // rather than on the request thread keeps the POST returning immediately.
                var selection = Selection(request);
                var only = selection == null
                    ? null
                    : new HashSet<string>(selection, StringComparer.OrdinalIgnoreCase);

                // Fetch the selection directly rather than listing the share and discarding it.
                var tracks = (only == null ? GetAllTracks() : GetTracks(only)).ToList();

                if (request.ResetAll)
                {
                    Log.Information("Resetting existing analysis for {Count} track(s)...", tracks.Count);

                    if (request.Metrics.HasFlag(AnalysisMetrics.Waveform) || request.Metrics.HasFlag(AnalysisMetrics.Loudness))
                    {
                        // Reset must respect the selection: a reset of 10 chosen tracks must not
                        // discard the cached waveforms of the other 46,000.
                        if (only == null)
                        {
                            Store.Clear();
                        }
                        else
                        {
                            Store.Remove(tracks.Select(t => t.OriginalFilename));
                        }
                    }

                    foreach (var t in tracks)
                    {
                        if (request.Metrics.HasFlag(AnalysisMetrics.Bpm) && t.HasBpm)
                        {
                            ClearBpm(t.MaskedFilename);
                        }

                        if (request.Metrics.HasFlag(AnalysisMetrics.Key) && t.HasKey)
                        {
                            ClearKey(t.MaskedFilename);
                        }
                    }

                    // Re-read so the queue sees the cleared state rather than the pre-reset one.
                    tracks = (only == null ? GetAllTracks() : GetTracks(only)).ToList();
                }

                // Each track carries the subset of metrics it still needs; a track needing none
                // is dropped from the queue entirely rather than decoded and discarded.
                var queue = tracks
                    .Select(t => (Track: t, Metrics: request.SkipAnalysed && !request.ResetAll
                        ? MissingMetrics(t, request.Metrics, request.AllowBpmFabrication)
                        : request.Metrics))
                    .Where(x => x.Metrics != AnalysisMetrics.None)
                    .ToList();

                var total = queue.Count;
                var analysed = 0;
                var skipped = 0;
                var failed = 0;
                var inFlight = 0;

                // One worker per core: each runs a single-threaded ffmpeg then a single-threaded
                // Essentia, so the pool size is the core count rather than anything configurable.
                // .NET reports the cgroup CPU limit here, so a constrained container gets its share
                // rather than the host's total. Logged as Cores, not Workers — there is no worker
                // setting any more, and naming it that made the log read like there still is one.
                var cores = Environment.ProcessorCount;

                SetState(true, false, false, total, 0, 0, 0, metrics: request.Metrics.ToString());
                Log.Information(
                    "Analysis scan started. Metrics: {Metrics}, Cores: {Cores}, Tracks: {Total}, ResetAll: {ResetAll}",
                    request.Metrics, cores, total, request.ResetAll);

                if (total == 0)
                {
                    SetState(false, true, false, 0, 0, 0, 0, 1.0);
                    return;
                }

                string ffmpegPath;
                try
                {
                    ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
                }
                catch (Exception ex)
                {
                    Log.Warning("Could not locate ffmpeg — analysis scan aborted: {Error}", ex.Message);
                    SetState(false, false, false, 0, 0, 0, 0);
                    return;
                }

                var options = Options.CurrentValue.Analysis;

                // Bounded so the queue does not materialise every pending track's state at once
                // on a library of tens of thousands of files.
                var channel = Channel.CreateBounded<(TrackAnalysisInfo Track, AnalysisMetrics Metrics)>(
                    new BoundedChannelOptions(cores * 2) { FullMode = BoundedChannelFullMode.Wait });

                // Which tracks are being decoded right now, so a client can show "analysing…"
                // against the specific rows in progress rather than just a count. Keyed by
                // absolute path, matching what the library list hands clients — a masked filename
                // would need resolving per row before a page could tell which of its rows these are.
                // Local to this run, not an instance field — RunScanAsync only ever has one
                // caller at a time (SyncRoot), so there's nothing to reset between runs.
                var inFlightFiles = new System.Collections.Concurrent.ConcurrentDictionary<string, byte>();

                var tasks = Enumerable.Range(0, cores).Select(_ => Task.Run(async () =>
                {
                    await foreach (var (track, metrics) in channel.Reader.ReadAllAsync(ct))
                    {
                        // The share repository hands back paths in their stored form, which is
                        // relative to the music root; ffmpeg needs the real one.
                        var path = MusicPath.ToAbsolute(track.OriginalFilename);

                        Interlocked.Increment(ref inFlight);
                        inFlightFiles.TryAdd(path, 0);
                        SetState(true, false, false, total, analysed, skipped, failed,
                            (double)(analysed + skipped + failed) / total, inFlight, request.Metrics.ToString(), inFlightFiles.Keys.ToList());
                        try
                        {
                            // Shared with the on-demand single-track methods below — without this,
                            // playing a track a scan is already decoding started a second, fully
                            // redundant ffmpeg/Essentia pass over the same file.
                            var gate = LockFor(path);
                            await gate.WaitAsync(ct);
                            AnalysisResult result;
                            try
                            {
                                result = await Analyzer.AnalyseAsync(path, ffmpegPath, metrics, options, ct);
                            }
                            finally
                            {
                                gate.Release();
                            }

                            if (result == null)
                            {
                                // A cancelled scan aborts every in-flight decode at once; that is
                                // the operator stopping it, not a library full of broken files.
                                ct.ThrowIfCancellationRequested();
                                Log.Warning("Analysis produced nothing for '{File}' — could not decode it.", path);
                                Interlocked.Increment(ref failed);
                                continue;
                            }

                            Apply(track.MaskedFilename, result.Bpm, result.Key);

                            if (result.Waveform != null || result.Loudness != null)
                            {
                                // Not SaveAndNotify on every track — a full scan can touch thousands
                                // of them, and broadcasting once per track would flood every
                                // connected client with a refetch. Throttled to at most once a
                                // second instead (see WaveformBroadcastThrottle), so an open Library
                                // row still catches up in real time without that flood.
                                Store.Save(path, result);

                                var now = DateTime.UtcNow.Ticks;
                                var last = Interlocked.Read(ref lastWaveformBroadcastTicks);
                                if (now - last > WaveformBroadcastThrottle.Ticks &&
                                    Interlocked.CompareExchange(ref lastWaveformBroadcastTicks, now, last) == last)
                                {
                                    // Not `_ =`: this runs inside the per-core Task.Run(async () => ...)
                                    // lambda below, whose own Enumerable.Range parameter is named `_`.
                                    var broadcastTask = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
                                }
                            }

                            var produced = result.Bpm.HasValue || result.Key != null
                                || result.Waveform != null || result.Loudness != null;
                            if (produced)
                            {
                                Interlocked.Increment(ref analysed);
                            }
                            else
                            {
                                Interlocked.Increment(ref skipped);
                            }
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Warning("Analysis failed for '{File}': {Error}", track.Filename, ex.Message);
                            Interlocked.Increment(ref failed);
                        }
                        finally
                        {
                            Interlocked.Decrement(ref inFlight);
                            inFlightFiles.TryRemove(path, out var removedFromInFlight);
                        }

                        var done = analysed + skipped + failed;
                        SetState(true, false, false, total, analysed, skipped, failed,
                            (double)done / total, inFlight, request.Metrics.ToString(), inFlightFiles.Keys.ToList());

                        if (done % Math.Max(1, total / 10) == 0)
                        {
                            Log.Information("Analysis progress: {Done}/{Total} ({Pct}%) — analysed={A} skipped={S} failed={F}",
                                done, total, (int)(100.0 * done / total), analysed, skipped, failed);
                        }
                    }
                }, ct)).ToArray();

                try
                {
                    foreach (var item in queue)
                    {
                        if (ct.IsCancellationRequested)
                        {
                            break;
                        }

                        await channel.Writer.WriteAsync(item, ct);
                    }
                }
                finally
                {
                    channel.Writer.Complete();
                }

                try
                {
                    await Task.WhenAll(tasks);
                }
                catch (OperationCanceledException)
                { /* expected on cancel */
                }

                var cancelled = ct.IsCancellationRequested;
                SetState(false, !cancelled, cancelled, total, analysed, skipped, failed,
                    cancelled ? CurrentState.Progress : 1.0);
                Log.Information("Analysis scan complete. Analysed: {A}, Skipped: {S}, Failed: {F}",
                    analysed, skipped, failed);

                // Guarantees a change made right before the scan ended isn't left sitting inside
                // the throttle window above with nothing left running to eventually flush it.
                if (analysed > 0)
                {
                    _ = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
                }
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Analysis scan failed unexpectedly");
                SetState(false, false, false, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            finally
            {
                // safety net: scanning must never be left true
                if (CurrentState.Scanning)
                {
                    SetState(false, false, ct.IsCancellationRequested, CurrentState.Total,
                        CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
                }

                MusicLibrary?.DeregisterQueue("analysis");
                SyncRoot.Release();
            }
        }

        private void SetState(
            bool scanning, bool completed, bool cancelled, int total, int analysed, int skipped, int failed,
            double progress = 0, int inFlight = 0, string metrics = null, IReadOnlyList<string> inFlightPaths = null)
        {
            CurrentState = new AnalysisScanState(
                scanning, completed, cancelled, total, analysed, skipped, failed, progress, inFlight,
                metrics ?? CurrentState?.Metrics, inFlightPaths ?? Array.Empty<string>());
        }
    }
}
