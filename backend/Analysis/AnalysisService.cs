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
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using resonance.Common;
    using resonance.Common.Ffmpeg;
    using resonance.MusicLibrary;
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

        public AnalysisService(
            IShareService shareService,
            IOptionsMonitor<resonance.Options> optionsMonitor,
            IFfmpegService ffmpeg,
            AnalysisStore store,
            IMusicLibraryService musicLibrary = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            Ffmpeg = ffmpeg;
            Store = store;
            MusicLibrary = musicLibrary;
        }

        public AnalysisScanState ScanState => CurrentState;

        private IShareService ShareService { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private IFfmpegService Ffmpeg { get; }
        private AnalysisStore Store { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private AudioAnalyzer Analyzer { get; } = new AudioAnalyzer();
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

        private AnalysisScanState CurrentState { get; set; } = new(false, false, false, 0, 0, 0, 0, 0);
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }
        private Task ScanTask { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

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

            // A single-track miss also measures loudness, since the decode is already paid for
            // and the player asks for both.
            var result = await AnalyseOneAsync(
                path, AnalysisMetrics.Waveform | AnalysisMetrics.Loudness, ct);
            if (result?.Waveform == null)
            {
                return null;
            }

            Store.Save(path, result);
            return result.Waveform;
        }

        public async Task<LoudnessData> GetLoudnessAsync(string path, CancellationToken ct)
        {
            var cached = Store.GetLoudness(path);
            if (cached != null)
            {
                return cached;
            }

            var result = await AnalyseOneAsync(path, AnalysisMetrics.Loudness, ct);
            if (result?.Loudness == null)
            {
                return null;
            }

            Store.Save(path, result);
            return result.Loudness;
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

        /// <summary>
        ///     Narrows the requested metrics to those this track is actually missing, so a rescan
        ///     of a mostly-analysed library only pays for the gaps.
        /// </summary>
        private AnalysisMetrics MissingMetrics(TrackAnalysisInfo track, AnalysisMetrics requested)
        {
            var missing = AnalysisMetrics.None;

            if (requested.HasFlag(AnalysisMetrics.Bpm) && !track.HasBpm)
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
                var only = request.OnlyFilenames == null
                    ? null
                    : new HashSet<string>(request.OnlyFilenames, StringComparer.OrdinalIgnoreCase);

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
                // rather than the host's total.
                var workers = Environment.ProcessorCount;

                SetState(true, false, false, total, 0, 0, 0, metrics: request.Metrics.ToString());
                Log.Information(
                    "Analysis scan started. Metrics: {Metrics}, Workers: {Workers}, Tracks: {Total}, ResetAll: {ResetAll}",
                    request.Metrics, workers, total, request.ResetAll);

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
                    new BoundedChannelOptions(workers * 2) { FullMode = BoundedChannelFullMode.Wait });

                var tasks = Enumerable.Range(0, workers).Select(_ => Task.Run(async () =>
                {
                    await foreach (var (track, metrics) in channel.Reader.ReadAllAsync(ct))
                    {
                        Interlocked.Increment(ref inFlight);
                        try
                        {
                            // The share repository hands back paths in their stored form, which is
                            // relative to the music root; ffmpeg needs the real one.
                            var path = MusicPath.ToAbsolute(track.OriginalFilename);

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

                            Apply(track.MaskedFilename, result.Bpm, result.Key);

                            if (result.Waveform != null || result.Loudness != null)
                            {
                                Store.Save(path, result);
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
                        }

                        var done = analysed + skipped + failed;
                        SetState(true, false, false, total, analysed, skipped, failed,
                            (double)done / total, inFlight, request.Metrics.ToString());

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
            double progress = 0, int inFlight = 0, string metrics = null)
        {
            CurrentState = new AnalysisScanState(
                scanning, completed, cancelled, total, analysed, skipped, failed, progress, inFlight,
                metrics ?? CurrentState?.Metrics);
        }
    }
}
