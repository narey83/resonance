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
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.Extensions.DependencyInjection;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using resonance.Analysis.Candidates;
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

        // How often a running scan is allowed to broadcast a "something was analysed" update.
        // Every metric goes through this now: Bpm/Key used to just ride the tag-write's own
        // (debounced, up to 30s+) full-library sync broadcast, which left an open Library row
        // showing a stale key/BPM long after the analysis that filled it in had actually
        // finished. Throttled rather than sent per track — a full-library scan can touch tens of
        // thousands of rows.
        private static readonly TimeSpan AnalysisBroadcastThrottle = TimeSpan.FromSeconds(1);

        // Ticks (DateTime.UtcNow.Ticks), not a DateTime — a plain field can't be updated
        // atomically from the stream endpoint's request threads while a background analysis
        // task reads it, so this goes through Interlocked instead of a lock.
        private readonly object enhancedStateLock = new();
        private long lastPlaybackActivityTicks;
        private long lastAnalysisBroadcastTicks;

        public AnalysisService(
            IShareService shareService,
            IOptionsMonitor<resonance.Options> optionsMonitor,
            IFfmpegService ffmpeg,
            AnalysisStore store,
            IMusicLibraryService musicLibrary = null,
            IHubContext<LibraryActivityHub> hub = null,
            IServiceProvider services = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            Ffmpeg = ffmpeg;
            Store = store;
            MusicLibrary = musicLibrary;
            Hub = hub;
            Services = services;
        }

        public AnalysisScanState ScanState => CurrentState;
        public bool PlaybackActive => IsPlaybackActive();

        private IServiceProvider Services { get; }
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
            // PreparationService owns the durable automatic queue. Manual scans use this
            // same orchestrator; newly indexed tracks wait instead of being discarded on busy.
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
            var detected = Store.GetDetectedTags();
            uint? Bpm(string path, uint? tag) => tag.HasValue && tag.Value > 0 ? tag : detected.GetValueOrDefault(MusicPath.ToRelative(path)).Bpm;
            string Key(string path, string tag) => !string.IsNullOrEmpty(tag) ? tag : detected.GetValueOrDefault(MusicPath.ToRelative(path)).Key;

            return ShareService.FindFiles(maskedFilenames)
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f =>
                {
                    var (hasWaveform, lufs) = status.TryGetValue(MusicPath.ToRelative(f.OriginalFilename), out var s)
                        ? s
                        : (false, (double?)null);

                    return new TrackAnalysisInfo(
                        f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                        Bpm(f.OriginalFilename, f.Tags?.Bpm),
                        Key(f.OriginalFilename, f.Tags?.Key),
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
            var detected = Store.GetDetectedTags();
            uint? Bpm(string path, uint? tag) => tag.HasValue && tag.Value > 0 ? tag : detected.GetValueOrDefault(MusicPath.ToRelative(path)).Bpm;
            string Key(string path, string tag) => !string.IsNullOrEmpty(tag) ? tag : detected.GetValueOrDefault(MusicPath.ToRelative(path)).Key;

            (bool HasWaveform, double? Lufs) Cached(string original) =>
                status.TryGetValue(MusicPath.ToRelative(original), out var s) ? s : (false, null);

            var tagged = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f =>
                {
                    var (hasWaveform, lufs) = Cached(f.OriginalFilename);
                    return new TrackAnalysisInfo(
                        f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                        Bpm(f.OriginalFilename, f.Tags?.Bpm),
                        Key(f.OriginalFilename, f.Tags?.Key),
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
                        Bpm(f.OriginalFilename, null), Key(f.OriginalFilename, null), hasWaveform, lufs, null, null, null);
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
            CurrentState = CurrentState with { EnhancedTotal = 0, EnhancedCompleted = 0, EnhancedFailed = 0, EnhancedPath = null };
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

        public Task<WaveformData> GetWaveformAsync(string path, CancellationToken ct, bool cachedOnly = false) =>
            Task.FromResult(Store.GetWaveform(path));

        public BeatAnalysis GetBeatInfo(string path) => Store.GetBeatInfo(path);

        public Task<LoudnessData> GetLoudnessAsync(string path, CancellationToken ct) =>
            Task.FromResult(Store.GetLoudness(path));

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

        public void ClearBpm(string maskedFilename)
        {
            UpdateTags(maskedFilename, t => t with { Bpm = 0 });
            foreach (var file in ShareService.FindFiles([maskedFilename]).Take(1))
            {
                Store.ClearDetectedValue(file.OriginalFilename, bpm: true);
            }
        }

        public void ClearKey(string maskedFilename)
        {
            UpdateTags(maskedFilename, t => t with { Key = null });
            foreach (var file in ShareService.FindFiles([maskedFilename]).Take(1))
            {
                Store.ClearDetectedValue(file.OriginalFilename, bpm: false);
            }
        }

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

        /// <summary>Preserves measured results when optional tag writes are blocked by an active reader.</summary>
        /// <param name="track">The shared track that was analysed.</param>
        /// <param name="result">The metrics produced by the decoder.</param>
        /// <param name="writeToTags">Whether detected BPM and key should also be written into the file.</param>
        /// <returns>Whether the result contains any measured metrics.</returns>
        internal bool PersistAnalysisResult(TrackAnalysisInfo track, AnalysisResult result, bool writeToTags)
        {
            var tagsSkipped = false;
            if (writeToTags)
            {
                try
                {
                    Apply(track.MaskedFilename, result.Bpm, result.Key);
                }
                catch (System.IO.IOException ex) when (resonance.Common.FileSharingViolation.Is(ex))
                {
                    // Keep playback/uploads intact and retain a successful decode despite the optional write.
                    tagsSkipped = true;
                }
            }

            var produced = result.Bpm.HasValue || result.Key != null
                || result.Waveform != null || result.Loudness != null;
            if (produced)
            {
                // Save after a successful tag write so its new file size is used by the cache guard.
                Store.Save(track.OriginalFilename, result);
                if (tagsSkipped)
                {
                    Log.Information(
                        "Saved analysis for '{File}'; file tags remain unchanged because the file is in use",
                        track.Filename);
                }
            }

            return produced;
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

        private bool IsPlaybackActive() =>
            DateTime.UtcNow.Ticks - Interlocked.Read(ref lastPlaybackActivityTicks) < PlaybackIdleWindow.Ticks;

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
        private AnalysisMetrics MissingMetrics(TrackAnalysisInfo track, AnalysisMetrics requested)
        {
            var missing = AnalysisMetrics.None;

            if (requested.HasFlag(AnalysisMetrics.Bpm) && !HasReliableBpm(track))
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
            var queueRegistered = false;
            string dependencyError = null;
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
                var required = tracks.Aggregate(AnalysisMetrics.None, (metrics, track) => metrics |
                    (request.ResetAll || !request.SkipAnalysed ? request.Metrics : MissingMetrics(track, request.Metrics)));
                var options = Options.CurrentValue.Analysis;
                string ffmpegPath = null;
                if (required != AnalysisMetrics.None)
                {
                    // Check dependencies before resetting saved metrics or decoding any audio.
                    SetState(true, false, false, tracks.Count, 0, 0, 0, metrics: request.Metrics.ToString());
                    if ((required & (AnalysisMetrics.Bpm | AnalysisMetrics.Key)) != 0)
                    {
                        await Analyzer.CheckEssentiaAsync(options, ct);
                    }

                    try
                    {
                        ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        throw new AnalysisDependencyException("Basic analysis stopped: FFmpeg is unavailable. Install or configure the audio decoder.", exception);
                    }
                }

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
                        // A file mid-upload to a Soulseek peer can hold a lock that briefly denies
                        // this a write handle — on a full-library reset that's not a rare edge
                        // case, it's expected to happen at least once. One inaccessible file
                        // failing here must not abort the reset for the other tens of thousands.
                        try
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
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Warning("Could not clear tags for '{File}' during reset: {Error}", t.Filename, ex.Message);
                        }
                    }

                    // Re-read so the queue sees the cleared state rather than the pre-reset one.
                    tracks = (only == null ? GetAllTracks() : GetTracks(only)).ToList();
                }

                // Each track carries the subset of metrics it still needs; a track needing none
                // is dropped from the queue entirely rather than decoded and discarded.
                var queue = tracks
                    .Select(t => (Track: t, Metrics: request.SkipAnalysed && !request.ResetAll
                        ? MissingMetrics(t, request.Metrics)
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
                    if (request.Enhanced)
                    {
                        await RunEnhanced(tracks, ct, !request.SkipAnalysed || request.ResetAll);
                    }

                    SetState(false, true, false, 0, 0, 0, 0, 1.0);
                    return;
                }

                // Registering a queue suppresses library sync while files and tags are changing;
                // deregistering it deliberately triggers a catch-up sync. An empty missing-only
                // request changes nothing, so registering it would turn every already-analysed
                // track play into an unnecessary full-library scan.
                MusicLibrary?.RegisterQueue("analysis");
                queueRegistered = true;

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
                        ct.ThrowIfCancellationRequested();

                        // The share repository hands back paths in their stored form, which is
                        // relative to the music root; ffmpeg needs the real one.
                        var path = MusicPath.ToAbsolute(track.OriginalFilename);

                        Interlocked.Increment(ref inFlight);
                        inFlightFiles.TryAdd(path, 0);
                        SetState(true, false, false, total, analysed, skipped, failed,
                            (double)(analysed + skipped + failed) / total, inFlight, request.Metrics.ToString(), inFlightFiles.Keys.ToList());
                        try
                        {
                            Log.Information("Analysing '{File}'; missing metrics: {Metrics}", track.OriginalFilename, metrics);
                            var result = await Analyzer.AnalyseAsync(path, ffmpegPath, metrics, options, ct);

                            if (result == null)
                            {
                                // A cancelled scan aborts every in-flight decode at once; that is
                                // the operator stopping it, not a library full of broken files.
                                ct.ThrowIfCancellationRequested();
                                Log.Warning("Analysis produced nothing for '{File}' — could not decode it.", path);
                                Interlocked.Increment(ref failed);
                                continue;
                            }

                            var produced = PersistAnalysisResult(track, result, options.WriteToTags);
                            if (produced)
                            {
                                // Re-index this one file before announcing anything. The tag write
                                // above changed its size and mtime, so the indexed row now carries
                                // both the pre-analysis BPM/key and a stale fingerprint — and the
                                // list's loudness and waveform columns join analysis.track_analysis
                                // on file_size, so they read as missing too. A sync would put all of
                                // that right, but it is debounced and deferred for as long as an
                                // analysis queue is registered (which is the whole of this scan),
                                // leaving every client that refetches on the broadcast below reading
                                // the row back exactly as it was before the analysis ran.
                                MusicLibrary?.RefreshTrack(path);

                                // Do not broadcast on every track — a full scan can touch thousands
                                // of them, and one update per track would flood every
                                // connected client with a refetch. Throttled to at most once a
                                // second instead (see AnalysisBroadcastThrottle), so an open Library
                                // row catches up in real time for whichever metric this pass
                                // produced, rather than only Waveform/Loudness getting a fast path
                                // and Bpm/Key waiting on the tag write's own debounced full sync.
                                var now = DateTime.UtcNow.Ticks;
                                var last = Interlocked.Read(ref lastAnalysisBroadcastTicks);
                                if (now - last > AnalysisBroadcastThrottle.Ticks &&
                                    Interlocked.CompareExchange(ref lastAnalysisBroadcastTicks, now, last) == last)
                                {
                                    // Not `_ =`: this runs inside the per-core Task.Run(async () => ...)
                                    // lambda below, whose own Enumerable.Range parameter is named `_`.
                                    var broadcastTask = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
                                }
                            }

                            var missing = result.MissingMetrics(metrics);
                            if (missing != AnalysisMetrics.None)
                            {
                                Log.Warning("Analysis incomplete for '{File}'; missing requested metrics: {Metrics}", track.Filename, missing);
                                Interlocked.Increment(ref failed);
                            }
                            else if (produced)
                            {
                                Log.Information(
                                    "Analysis saved for '{File}': BPM={Bpm}, Key={Key}, Waveform={HasWaveform}, LUFS={Lufs}; measured {Metrics}",
                                    track.OriginalFilename, result.Bpm ?? track.Bpm, result.Key ?? track.Key,
                                    result.Waveform != null || track.HasWaveform, result.Loudness?.IntegratedLufs ?? track.Lufs, metrics);
                                Interlocked.Increment(ref analysed);
                            }
                            else
                            {
                                Interlocked.Increment(ref skipped);
                            }
                        }
                        catch (AnalysisDependencyException exception)
                        {
                            Interlocked.CompareExchange(ref dependencyError, exception.Message, null);
                            Interlocked.Increment(ref failed);
                            Cts.Cancel();
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
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                { /* Wait for every worker below before releasing the scan lock. */
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

                if (dependencyError != null)
                {
                    SetState(false, false, false, total, analysed, skipped, failed,
                        error: dependencyError, dependencyUnavailable: true);
                    return;
                }

                if (!ct.IsCancellationRequested && request.Enhanced)
                {
                    await RunEnhanced(tracks, ct, !request.SkipAnalysed || request.ResetAll);
                }

                var cancelled = ct.IsCancellationRequested;
                SetState(false, !cancelled, cancelled, total, analysed, skipped, failed,
                    cancelled ? CurrentState.Progress : 1.0,
                    error: failed > 0 ? $"Analysis finished with {failed} failed track(s). Required measurements were not completed; existing results were preserved. See the analysis log for details." : null);
                Log.Information("Analysis scan complete. Analysed: {A}, Skipped: {S}, Failed: {F}",
                    analysed, skipped, failed);

                // Guarantees a change made right before the scan ended isn't left sitting inside
                // the throttle window above with nothing left running to eventually flush it.
                if (analysed + failed > 0)
                {
                    _ = Hub?.BroadcastLibraryUpdatedAsync(0, 1, 0);
                }
            }
            catch (AnalysisDependencyException exception)
            {
                Log.Warning(exception, "Basic analysis stopped because a dependency is unavailable");
                SetState(false, false, false, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped,
                    Math.Max(1, CurrentState.Failed), error: exception.Message, dependencyUnavailable: true);
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Analysis scan failed unexpectedly");
                SetState(false, false, false, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
                CurrentState = CurrentState with { Error = "Analysis stopped unexpectedly. Existing results were preserved; see the analysis log for details." };
            }
            finally
            {
                // safety net: scanning must never be left true
                if (CurrentState.Scanning)
                {
                    SetState(false, false, ct.IsCancellationRequested, CurrentState.Total,
                        CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
                }

                if (queueRegistered)
                {
                    MusicLibrary?.DeregisterQueue("analysis");
                }

                SyncRoot.Release();
            }
        }

        private async Task RunEnhanced(IReadOnlyList<TrackAnalysisInfo> tracks, CancellationToken ct, bool force)
        {
            var enhanced = Services?.GetService<CandidateAnalysisService>();
            if (enhanced?.Enabled != true)
            {
                return;
            }

            lock (enhancedStateLock)
            {
                CurrentState = CurrentState with { Scanning = true, Completed = false, EnhancedTotal = tracks.Count, EnhancedCompleted = 0, EnhancedFailed = 0 };
            }

            await Parallel.ForEachAsync(
                tracks,
                new ParallelOptions { MaxDegreeOfParallelism = enhanced.Resources.ParallelJobs, CancellationToken = ct },
                async (track, token) =>
                {
                    lock (enhancedStateLock)
                    {
                        CurrentState = CurrentState with { EnhancedPath = track.OriginalFilename };
                    }

                    try
                    {
                        await enhanced.EnsureEnhanced(MusicPath.ToAbsolute(track.OriginalFilename), token, force);
                        lock (enhancedStateLock)
                        {
                            CurrentState = CurrentState with { EnhancedCompleted = CurrentState.EnhancedCompleted + 1 };
                        }
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        lock (enhancedStateLock)
                        {
                            CurrentState = CurrentState with { EnhancedFailed = CurrentState.EnhancedFailed + 1 };
                        }

                        Log.Warning("Enhanced analysis failed for {Path}: {Error}", track.OriginalFilename, exception.Message);
                    }
                });

            lock (enhancedStateLock)
            {
                CurrentState = CurrentState with { EnhancedPath = null };
            }

            _ = Hub?.BroadcastLibraryUpdatedAsync(0, tracks.Count, 0);
        }

        private void SetState(
            bool scanning, bool completed, bool cancelled, int total, int analysed, int skipped, int failed,
            double progress = 0, int inFlight = 0, string metrics = null, IReadOnlyList<string> inFlightPaths = null,
            string error = null, bool dependencyUnavailable = false)
        {
            CurrentState = new AnalysisScanState(
                scanning, completed, cancelled, total, analysed, skipped, failed, progress, inFlight,
                metrics ?? CurrentState?.Metrics, inFlightPaths ?? Array.Empty<string>())
            {
                EnhancedTotal = CurrentState.EnhancedTotal,
                EnhancedCompleted = CurrentState.EnhancedCompleted,
                EnhancedFailed = CurrentState.EnhancedFailed,
                EnhancedPath = CurrentState.EnhancedPath,
                Error = error,
                DependencyUnavailable = dependencyUnavailable,
            };
        }
    }
}
