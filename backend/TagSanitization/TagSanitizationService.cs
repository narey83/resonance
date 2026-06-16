// <copyright file="TagSanitizationService.cs" company="JP Dillingham">
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

namespace resonance.TagSanitization
{
    using System;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using resonance.MusicLibrary;
    using resonance.Shares;
    using Serilog;

    /// <summary>
    ///     Orchestrates a background tag sanitization scan across all shared audio
    ///     files, delegating per-file work to <see cref="TagConsolidator"/>.
    /// </summary>
    public class TagSanitizationService : ITagSanitizationService
    {
        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "wma", "aiff", "aif",
        };

        private const int MaxResultsRetained = 200;

        public TagSanitizationService(IShareService shareService, IMusicLibraryService musicLibrary = null)
        {
            ShareService = shareService;
            MusicLibrary = musicLibrary;
        }

        public TagSanitizationState ScanState => BuildState();

        private IShareService ShareService { get; }
        private IMusicLibraryService MusicLibrary { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Tags);

        private TagSanitizationState CurrentState { get; set; } =
            new(false, false, false, 0, 0, 0, 0, 0, 0, []);

        private List<FileConsolidationResult> RecentResults { get; } = [];
        private SemaphoreSlim SyncRoot { get; } = new(1, 1);
        private CancellationTokenSource Cts { get; set; }

        // ── Public API ────────────────────────────────────────────────────────
        public async Task StartScanAsync(TagSanitizationRequest request)
        {
            if (!await SyncRoot.WaitAsync(0))
            {
                Log.Warning("Tag sanitization scan rejected; scan already in progress.");
                throw new InvalidOperationException("A tag sanitization scan is already in progress.");
            }

            SetState(true, false, false, 0, 0, 0, 0, 0);
            RecentResults.Clear();

            Cts = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            var ct = Cts.Token;

            await Task.Yield();

            try
            {
                // Block library sync from running while we write files; DeregisterQueue in finally
                // triggers an immediate re-sync so the DB picks up the updated tags.
                if (!request.DryRun)
                {
                    MusicLibrary?.RegisterQueue("tag-sanitization");
                }

                var files = GetAudioFiles().ToList();
                var total = files.Count;
                var processed = 0;
                var sanitized = 0;
                var skipped = 0;
                var failed = 0;

                SetState(true, false, false, total, 0, 0, 0, 0);

                var workers = Math.Max(1, request.Workers);
                var channel = Channel.CreateUnbounded<(string Original, string Masked)>();

                foreach (var f in files)
                {
                    await channel.Writer.WriteAsync(f, ct);
                }

                channel.Writer.Complete();

                var tasks = Enumerable.Range(0, workers).Select(_ => Task.Run(async () =>
                {
                    await foreach (var (original, masked) in channel.Reader.ReadAllAsync(ct))
                    {
                        if (ct.IsCancellationRequested)
                        {
                            break;
                        }

                        try
                        {
                            var result = request.DryRun
                                ? TagConsolidator.Analyse(original, masked)
                                : TagConsolidator.Consolidate(original, masked);

                            if (result.Changes.Length > 0 && result.Changes[0].StartsWith("Error:"))
                            {
                                Log.Debug("Tag sanitization failed for '{File}': {Error}", result.Filename, result.Changes[0]);
                                Interlocked.Increment(ref failed);
                                lock (RecentResults)
                                {
                                    if (RecentResults.Count < MaxResultsRetained)
                                    {
                                        RecentResults.Add(result);
                                    }
                                }
                            }
                            else if (result.Changed)
                            {
                                Log.Debug("Tag sanitization ({Mode}) '{File}': {Changes}",
                                    request.DryRun ? "dry-run" : "applied",
                                    result.Filename,
                                    string.Join("; ", result.Changes));
                                Interlocked.Increment(ref sanitized);
                                lock (RecentResults)
                                {
                                    if (RecentResults.Count < MaxResultsRetained)
                                    {
                                        RecentResults.Add(result);
                                    }
                                }
                            }
                            else
                            {
                                Interlocked.Increment(ref skipped);
                            }

                            Interlocked.Increment(ref processed);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            Log.Debug("Tag sanitization failed for '{File}': {Error}", original, ex.Message);
                            Interlocked.Increment(ref failed);
                            Interlocked.Increment(ref processed);
                        }

                        var done = processed;
                        SetState(true, false, false, total, done, sanitized, skipped, failed, (double)done / total);
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
                SetState(false, !cancelled, cancelled, total, processed, sanitized, skipped, failed,
                    cancelled ? CurrentState.Progress : 1.0);
                Log.Information(
                    "Tag sanitization scan complete ({Mode}). Sanitized: {S}, Skipped: {K}, Failed: {F}",
                    request.DryRun ? "dry-run" : "real",
                    sanitized, skipped, failed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Log.Error(ex, "Tag sanitization scan failed unexpectedly");
                SetState(false, false, false,
                    CurrentState.Total, CurrentState.Processed,
                    CurrentState.Sanitized, CurrentState.Skipped, CurrentState.Failed);
            }
            catch (OperationCanceledException)
            {
                SetState(false, false, true,
                    CurrentState.Total, CurrentState.Processed,
                    CurrentState.Sanitized, CurrentState.Skipped, CurrentState.Failed);
            }
            finally
            {
                if (CurrentState.Scanning)
                {
                    SetState(false, false, ct.IsCancellationRequested,
                        CurrentState.Total, CurrentState.Processed,
                        CurrentState.Sanitized, CurrentState.Skipped, CurrentState.Failed);
                }

                if (!request.DryRun)
                {
                    // Unblock library sync and trigger an immediate re-index of updated tags.
                    MusicLibrary?.DeregisterQueue("tag-sanitization");

                    // Re-scan shares so the Soulseek index reflects the rewritten ID3v2.3 tags.
                    if (CurrentState.Sanitized > 0)
                    {
                        ShareService.RequestScan();
                    }
                }

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

        // ── Helpers ───────────────────────────────────────────────────────────
        private IEnumerable<(string Original, string Masked)> GetAudioFiles()
        {
            var tagged = ShareService.GetTaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => (f.OriginalFilename, f.MaskedFilename));

            var untagged = ShareService.GetUntaggedFiles()
                .Where(f => AudioExtensions.Contains(f.Extension))
                .Select(f => (f.OriginalFilename, f.MaskedFilename));

            return tagged.Concat(untagged)
                .DistinctBy(f => f.MaskedFilename)
                .Where(f => System.IO.File.Exists(f.OriginalFilename));
        }

        private void SetState(bool scanning, bool completed, bool cancelled,
            int total, int processed, int sanitized, int skipped, int failed, double progress = 0)
        {
            CurrentState = new(scanning, completed, cancelled,
                total, processed, sanitized, skipped, failed, progress, []);
        }

        private TagSanitizationState BuildState()
        {
            lock (RecentResults)
            {
                return CurrentState with { Results = RecentResults.ToList() };
            }
        }
    }
}
