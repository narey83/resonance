// <copyright file="KeyAnalysisService.cs" company="JP Dillingham">
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

namespace resonance.KeyAnalysis
{
    using System;
    using System.Collections.Generic;
    using System.IO;
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
    ///     Manages detection and storage of musical keys for shared audio files.
    /// </summary>
    public class KeyAnalysisService : IKeyAnalysisService, IHostedService
    {
        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        public KeyAnalysisService(IShareService shareService, IOptionsMonitor<resonance.Options> optionsMonitor, IFfmpegService ffmpeg, IMusicLibraryService musicLibrary = null)
        {
            ShareService = shareService;
            Options = optionsMonitor;
            Ffmpeg = ffmpeg;
            MusicLibrary = musicLibrary;
        }

        public KeyScanState ScanState => CurrentState;

        private IShareService ShareService { get; }
        private IOptionsMonitor<resonance.Options> Options { get; }
        private IFfmpegService Ffmpeg { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Key);

        private KeyScanState CurrentState { get; set; } = new(false, false, false, 0, 0, 0, 0, 0);
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }
        private Task ScanTask { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken)
        {
            // Pre-build the CQ sparse kernel in the background so the first scan starts immediately.
            Task.Run(KeyDetector.WarmUp, cancellationToken);
            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            if (Cts != null && !Cts.IsCancellationRequested)
            {
                Log.Information("Cancelling key analysis scan for graceful shutdown...");
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
        public IEnumerable<TrackKeyInfo> GetAllTracksWithKeyStatus()
        {
            var tagged = ShareService.GetTaggedFiles()
                .Select(f => new TrackKeyInfo(
                    f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                    f.Tags.Key, !string.IsNullOrEmpty(f.Tags.Key),
                    f.Tags.Artist, f.Tags.Title, f.Tags.Album));

            var untagged = ShareService.GetUntaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => new TrackKeyInfo(
                    f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                    null, false, null, null, null));

            // also include tagged files that are audio but have no key
            var taggedNoKey = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension) && string.IsNullOrEmpty(f.Tags.Key))
                .Select(f => new TrackKeyInfo(
                    f.MaskedFilename, f.OriginalFilename, f.Directory, f.Filename, f.Extension,
                    null, false, f.Tags.Artist, f.Tags.Title, f.Tags.Album));

            return tagged
                .Where(t => AudioExtensions.Contains(t.Extension))
                .Concat(untagged)
                .Concat(taggedNoKey)
                .DistinctBy(t => t.MaskedFilename)
                .OrderBy(t => t.Artist ?? t.Directory)
                .ThenBy(t => t.Title ?? t.Filename)
                .ToList();
        }

        public async Task StartScanAsync(KeyScanRequest request)
        {
            if (!await SyncRoot.WaitAsync(0))
            {
                Log.Warning("Key analysis scan rejected; scan already in progress.");
                throw new InvalidOperationException("A key analysis scan is already in progress.");
            }

            // Mark as scanning immediately so GET /scan returns scanning=true as soon as the
            // POST response lands — before the background task begins.
            SetState(true, false, false, 0, 0, 0, 0);

            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            var ct = Cts.Token;

            // Schedule as a tracked Task.Run so StopAsync can await graceful completion on shutdown.
            ScanTask = Task.Run(() => RunScanAsync(request, ct), ct);
        }

        private async Task RunScanAsync(KeyScanRequest request, CancellationToken ct)
        {
            MusicLibrary?.RegisterQueue("key");
            try
            {
                var tracks = GetAllTracksWithKeyStatus().ToList();

                // null  → scan all files
                // []    → scan nothing (explicit empty selection)
                // [...] → restrict to the named files
                if (request.OnlyFilenames != null)
                {
                    var set = new HashSet<string>(request.OnlyFilenames, StringComparer.OrdinalIgnoreCase);
                    tracks = tracks.Where(t => set.Contains(t.MaskedFilename)).ToList();
                }

                IEnumerable<TrackKeyInfo> toAnalyse = tracks;
                if (request.ResetAll)
                {
                    toAnalyse = tracks;
                }
                else if (request.SkipTagged)
                {
                    toAnalyse = tracks.Where(t => !t.HasKey);
                }

                var list = toAnalyse.ToList();
                var total = list.Count;
                var analysed = 0;
                var skipped = 0;
                var failed = 0;

                // Set real total before the (potentially slow) clear phase so the
                // frontend progress bar appears immediately rather than showing 0.
                SetState(true, false, false, total, 0, 0, 0);
                Log.Information("Key analysis scan started. Algorithm: {Algorithm}, Workers: {Workers}, Tracks: {Total}, ResetAll: {ResetAll}",
                    request.Algorithm ?? "audio", request.Workers, total, request.ResetAll);

                if (request.ResetAll)
                {
                    // clear existing keys so they are re-detected
                    foreach (var t in tracks.Where(t => t.HasKey))
                    {
                        ClearKey(t.MaskedFilename);
                    }
                }

                var options = Options.CurrentValue.KeyAnalysis;

                // Resolve (and if needed download) ffmpeg before spinning up workers so
                // the first track doesn't pay the download cost while others wait on the channel.
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
                var channel = Channel.CreateUnbounded<TrackKeyInfo>();

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
                            string detectedKey = null;

                            if (request.Algorithm == "tagOnly")
                            {
                                detectedKey = KeyDetector.ReadKeyFromTags(track.OriginalFilename);
                            }
                            else
                            {
                                // try existing tag first; fall back to audio analysis
                                detectedKey = KeyDetector.ReadKeyFromTags(track.OriginalFilename);
                                if (string.IsNullOrEmpty(detectedKey) && ffmpegPath != null)
                                {
                                    detectedKey = await KeyDetector.DetectKeyFromAudioAsync(track.OriginalFilename, ffmpegPath, ct);
                                }
                            }

                            if (!string.IsNullOrEmpty(detectedKey))
                            {
                                SetKey(track.MaskedFilename, detectedKey);
                                Interlocked.Increment(ref analysed);
                            }
                            else
                            {
                                Interlocked.Increment(ref skipped);
                            }
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Warning("Key analysis failed for '{File}': {Error}", track.Filename, ex.Message);
                            Interlocked.Increment(ref failed);
                        }
                        finally
                        {
                            Interlocked.Decrement(ref inFlight);
                        }

                        var done = analysed + skipped + failed;
                        SetState(true, false, false, total, analysed, skipped, failed, (double)done / total, inFlight);

                        // log at every 10% milestone
                        if (total > 0 && done % Math.Max(1, total / 10) == 0)
                        {
                            Log.Information("Key analysis progress: {Done}/{Total} ({Pct}%) — analysed={A} skipped={S} failed={F}",
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
                Log.Information("Key analysis scan complete. Analysed: {A}, Skipped: {S}, Failed: {F}", analysed, skipped, failed);

                if (analysed > 0)
                {
                    Log.Information("Key analysis complete — {N} new key(s) will be persisted on library sync.", analysed);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Log.Error(ex, "Key analysis scan failed unexpectedly");
                SetState(false, false, false, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
            }
            finally
            {
                // safety net: ensure scanning is never left as true
                if (CurrentState.Scanning)
                {
                    SetState(false, false, ct.IsCancellationRequested, CurrentState.Total, CurrentState.Analysed, CurrentState.Skipped, CurrentState.Failed);
                }

                MusicLibrary?.DeregisterQueue("key");
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

        public void SetKey(string maskedFilename, string key)
        {
            var existing = ShareService.GetAllTags().TryGetValue(maskedFilename, out var t) ? t : null;
            var updated = existing != null
                ? existing with { Key = key }
                : new FileTags(null, null, null, null, 0, 0, key);
            ShareService.WriteFileTags(maskedFilename, updated);
        }

        public void ClearKey(string maskedFilename)
        {
            var existing = ShareService.GetAllTags().TryGetValue(maskedFilename, out var t) ? t : null;
            if (existing == null)
            {
                return;
            }

            ShareService.WriteFileTags(maskedFilename, existing with { Key = null });
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private void SetState(bool scanning, bool completed, bool cancelled, int total, int analysed, int skipped, int failed, double progress = 0, int inFlight = 0)
        {
            CurrentState = new KeyScanState(scanning, completed, cancelled, total, analysed, skipped, failed, progress, inFlight);
        }
    }
}
