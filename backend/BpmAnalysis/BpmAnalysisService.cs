// <copyright file="BpmAnalysisService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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

namespace resonance.BpmAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.Extensions.Hosting;
    using Microsoft.Extensions.Options;
    using resonance.Common.Ffmpeg;
    using resonance.MusicLibrary;
    using resonance.Shares;
    using Serilog;

    /// <summary>
    ///     Manages detection and storage of BPM values for shared audio files.
    /// </summary>
    public class BpmAnalysisService : IBpmAnalysisService, IHostedService
    {
        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        public BpmAnalysisService(IShareService shareService, IOptionsMonitor<resonance.Options> optionsMonitor, IFfmpegService ffmpeg, IMusicLibraryService musicLibrary = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            Ffmpeg = ffmpeg;
            MusicLibrary = musicLibrary;
        }

        public BpmScanState ScanState => CurrentState;

        private IShareService ShareService { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private IFfmpegService Ffmpeg { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.BPM);

        private BpmScanState CurrentState { get; set; } = new(false, false, false, 0, 0, 0, 0, 0);
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }
        private Task ScanTask { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            if (Cts != null && !Cts.IsCancellationRequested)
            {
                Log.Information("Cancelling BPM analysis scan for graceful shutdown...");
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
        public IEnumerable<TrackBpmInfo> GetAllTracksWithBpmStatus()
        {
            var tagged = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => new TrackBpmInfo(
                    f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                    f.Tags.Bpm == 0 ? null : f.Tags.Bpm,
                    f.Tags.Bpm != 0,
                    f.Tags.Artist, f.Tags.Title, f.Tags.Album));

            var untagged = ShareService.GetUntaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => new TrackBpmInfo(
                    f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                    null, false, null, null, null));

            return tagged
                .Concat(untagged)
                .DistinctBy(t => t.MaskedFilename)
                .OrderBy(t => t.Artist ?? t.Directory)
                .ThenBy(t => t.Title ?? t.Filename)
                .ToList();
        }

        public async Task StartScanAsync(BpmScanRequest request)
        {
            if (!await SyncRoot.WaitAsync(0))
            {
                Log.Warning("BPM analysis scan rejected; scan already in progress.");
                throw new InvalidOperationException("A BPM analysis scan is already in progress.");
            }

            SetState(true, false, false, 0, 0, 0, 0);

            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            var ct = Cts.Token;

            ScanTask = Task.Run(() => RunScanAsync(request, ct), ct);
        }

        private async Task RunScanAsync(BpmScanRequest request, CancellationToken ct)
        {
            MusicLibrary?.RegisterQueue("bpm");
            try
            {
                var tracks = GetAllTracksWithBpmStatus().ToList();

                if (request.OnlyFilenames != null)
                {
                    var set = new HashSet<string>(request.OnlyFilenames, StringComparer.OrdinalIgnoreCase);
                    tracks = tracks.Where(t => set.Contains(t.MaskedFilename)).ToList();
                }

                IEnumerable<TrackBpmInfo> toAnalyse = request.ResetAll || !request.SkipTagged
                    ? tracks
                    : tracks.Where(t => !t.HasBpm);

                var list = toAnalyse.ToList();
                var total = list.Count;
                var analysed = 0;
                var skipped = 0;
                var failed = 0;

                SetState(true, false, false, total, 0, 0, 0);
                Log.Information("BPM analysis scan started. Algorithm: {Algorithm}, Workers: {Workers}, Tracks: {Total}, ResetAll: {ResetAll}",
                    request.Algorithm ?? "audioAnalysis", request.Workers, total, request.ResetAll);

                if (request.ResetAll)
                {
                    foreach (var t in tracks.Where(t => t.HasBpm))
                    {
                        ClearBpm(t.MaskedFilename);
                    }
                }

                string ffmpegPath = null;
                if (request.Algorithm != "tagOnly")
                {
                    try
                    {
                        ffmpegPath = await Ffmpeg.GetFfmpegPathAsync(ct);
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Could not locate or download ffmpeg — audio analysis will be skipped: {Error}", ex.Message);
                    }
                }

                var workers = Math.Max(1, request.Workers);
                var channel = Channel.CreateUnbounded<TrackBpmInfo>();

                foreach (var t in list)
                {
                    await channel.Writer.WriteAsync(t, ct);
                }

                channel.Writer.Complete();

                var inFlight = 0;
                var tasks = Enumerable.Range(0, workers).Select(_ => Task.Run(async () =>
                {
                    await foreach (var track in channel.Reader.ReadAllAsync(ct))
                    {
                        if (ct.IsCancellationRequested)
                        {
                            break;
                        }

                        Interlocked.Increment(ref inFlight);
                        try
                        {
                            uint? detectedBpm = null;

                            if (request.Algorithm == "tagOnly")
                            {
                                detectedBpm = BpmDetector.ReadBpmFromTags(track.OriginalFilename);
                            }
                            else
                            {
                                detectedBpm = BpmDetector.ReadBpmFromTags(track.OriginalFilename);
                                if (detectedBpm == null && ffmpegPath != null)
                                {
                                    detectedBpm = await BpmDetector.DetectBpmFromAudioAsync(track.OriginalFilename, ffmpegPath, ct);
                                }
                            }

                            if (detectedBpm.HasValue)
                            {
                                SetBpm(track.MaskedFilename, detectedBpm.Value);
                                Interlocked.Increment(ref analysed);
                            }
                            else
                            {
                                Interlocked.Increment(ref skipped);
                            }
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Warning("BPM analysis failed for '{File}': {Error}", track.Filename, ex.Message);
                            Interlocked.Increment(ref failed);
                        }
                        finally
                        {
                            Interlocked.Decrement(ref inFlight);
                        }

                        var done = analysed + skipped + failed;
                        SetState(true, false, false, total, analysed, skipped, failed, (double)done / total, inFlight);

                        if (total > 0 && done % Math.Max(1, total / 10) == 0)
                        {
                            Log.Information("BPM analysis progress: {Done}/{Total} ({Pct}%) — analysed={A} skipped={S} failed={F}",
                                done, total, (int)(100.0 * done / total), analysed, skipped, failed);
                        }
                    }
                }, ct)).ToArray();

                try
                {
                    await Task.WhenAll(tasks);
                }
                catch (OperationCanceledException)
                { /* expected on cancel */
                }

                var cancelled = ct.IsCancellationRequested;
                SetState(false, !cancelled, cancelled, total, analysed, skipped, failed, cancelled ? CurrentState.Progress : 1.0);
                Log.Information("BPM analysis scan complete. Analysed: {A}, Skipped: {S}, Failed: {F}", analysed, skipped, failed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Log.Error(ex, "BPM analysis scan failed unexpectedly");
                SetState(false, false, false, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            finally
            {
                if (CurrentState.Scanning)
                {
                    SetState(false, false, ct.IsCancellationRequested, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
                }

                MusicLibrary?.DeregisterQueue("bpm");
                SyncRoot.Release();
            }
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

        public void SetBpm(string maskedFilename, uint bpm)
        {
            var existing = ShareService.GetAllTags().TryGetValue(maskedFilename, out var t) ? t : null;
            var updated = existing != null
                ? existing with { Bpm = bpm }
                : new FileTags(null, null, null, null, 0, 0, null, null, bpm);
            ShareService.WriteFileTags(maskedFilename, updated);
        }

        public void ClearBpm(string maskedFilename)
        {
            var existing = ShareService.GetAllTags().TryGetValue(maskedFilename, out var t) ? t : null;
            if (existing == null)
            {
                return;
            }

            ShareService.WriteFileTags(maskedFilename, existing with { Bpm = 0 });
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private void SetState(bool scanning, bool completed, bool cancelled, int total, int analysed, int skipped, int failed, double progress = 0, int inFlight = 0)
        {
            CurrentState = new BpmScanState(scanning, completed, cancelled, total, analysed, skipped, failed, progress, inFlight);
        }
    }
}
