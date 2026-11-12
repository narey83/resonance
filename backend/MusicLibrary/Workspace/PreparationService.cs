// <copyright file="PreparationService.cs" company="John Narey">
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

namespace resonance.MusicLibrary.Workspace;

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using resonance.Analysis;
using resonance.Analysis.Candidates;
using resonance.Common;
using Serilog;

public class PreparationService(WorkspaceStore store, MusicRepository repository, IMusicLibraryService library,
    IAnalysisService analysis, CandidateAnalysisOptions enhanced) : BackgroundService
{
    private readonly object gate = new();
    private readonly PlaybackPreparationGate playbackGate = new();
    private int reconcileRequested = 1;
    private bool recoveryNeeded;
    public long LastCheckedAt { get; private set; }
    public string DependencyError => analysis.ScanState.DependencyUnavailable ? analysis.ScanState.Error : null;
    public PreparationSettings Settings => store.PreparationSettings ?? new(enhanced.Enabled ? "enhanced" : "basic");
    public string Mode => Settings.Mode;
    public string WaitingReason => DependencyError ?? (store.Paused ? "Paused after active tracks"
        : Mode != "basic" && !enhanced.Enabled ? "Enhanced analysis worker is not configured"
        : FilesBeingUpdated ? "Waiting for metadata updates to finish"
        : analysis.PlaybackActive ? "Waiting for playback to go idle"
        : analysis.ScanState.Scanning ? "Analysis is running" : null);
    internal int BatchSize { get; init; } = Math.Max(1, Environment.ProcessorCount);
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private bool FilesBeingUpdated => library?.IsQueueActive("metadata") == true || library?.IsQueueActive("tag-sanitization") == true;
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Analysis);

    public void SetMode(string mode, string[] features = null, bool writeAutoCues = false, string cueUsername = null)
    {
        if (mode is not ("basic" or "enhanced" or "custom"))
        {
            throw new ArgumentException("Choose Basic, Full enhanced or Custom enhanced analysis.", nameof(mode));
        }

        if (mode != "basic" && !enhanced.Enabled)
        {
            throw new InvalidOperationException("The Enhanced analysis worker is not configured.");
        }

        var previous = store.PreparationSettings;
        features ??= previous?.Features;
        if (mode == "custom")
        {
            CandidateFeatureSelection.Validate(features);
            if (features == null)
            {
                throw new ArgumentException("Choose enhanced measurements for automatic analysis.", nameof(features));
            }
        }

        if (writeAutoCues && string.IsNullOrWhiteSpace(cueUsername))
        {
            throw new ArgumentException("An authenticated user is required to save automatic cues.", nameof(cueUsername));
        }

        if (writeAutoCues && mode == "custom" && !features.Contains("cues", StringComparer.Ordinal))
        {
            features = [.. features, "cues"];
        }

        store.PreparationSettings = new(mode, features, writeAutoCues, writeAutoCues ? cueUsername : null);
        Interlocked.Exchange(ref reconcileRequested, 1);
        Log.Information("Automatic preparation mode set to {Mode}; Features: {Features}; WriteAutoCues: {WriteAutoCues}",
            mode, features == null ? "full" : string.Join(",", features), writeAutoCues);
    }

    public void Retry(string path)
    {
        var track = Track(path) ?? throw new ArgumentException("This track is no longer in the library.");
        path = MusicPath.ToRelative(track.Path);
        lock (gate)
        {
            if (store.Find(path)?.State == "running")
            {
                throw new InvalidOperationException("This track is already being analysed.");
            }

            store.Put(new(path, track.FileSize, track.FileModified, "queued", 0, Now, "Queued; existing analysis is preserved", Now));
        }
    }

    public void Reconcile(CancellationToken ct = default)
    {
        var timer = Stopwatch.StartNew();
        var settings = Settings;
        var checkedTracks = 0;
        var updatedItems = 0;
        string afterPath = null;
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            var tracks = repository.GetPreparationPage(afterPath);
            if (tracks.Count == 0)
            {
                break;
            }

            lock (gate)
            {
                var known = store.FindMany(tracks.Select(track => MusicPath.ToRelative(track.Path)));
                var changes = new List<PreparationItem>();
                foreach (var track in tracks)
                {
                    var path = MusicPath.ToRelative(track.Path);
                    known.TryGetValue(path, out var existing);
                    if (existing?.State == "running")
                    {
                        continue;
                    }

                    var completed = PreparationPolicy.CompletedState(track, settings);
                    var changed = existing == null || existing.FileSize != track.FileSize || existing.FileModified != track.FileModified;
                    if (completed != null)
                    {
                        if (changed || existing.State != completed)
                        {
                            changes.Add(new(path, track.FileSize, track.FileModified, completed, 0, 0, "Analysis available", Now));
                        }
                    }
                    else if (changed || existing.State is "complete" or "basic" or "selected")
                    {
                        changes.Add(new(path, track.FileSize, track.FileModified, "queued", 0, Now, "Waiting for analysis", Now));
                    }
                }

                if (changes.Count > 0)
                {
                    store.PutMany(changes);
                    updatedItems += changes.Count;
                }
            }

            checkedTracks += tracks.Count;
            afterPath = MusicPath.ToRelative(tracks[^1].Path);
        }

        ct.ThrowIfCancellationRequested();
        store.RemoveDeleted();
        LastCheckedAt = Now;
        Log.Information("Automatic preparation checked {Tracks} tracks in {ElapsedMs:F0} ms; updated {Items} queue entries", checkedTracks, timer.Elapsed.TotalMilliseconds, updatedItems);
    }

    internal async Task ProcessNext(CancellationToken ct)
    {
        var settings = Settings;
        if (store.Paused || (settings.Mode != "basic" && !enhanced.Enabled) || FilesBeingUpdated || analysis.ScanState.Scanning || playbackGate.ShouldWait(analysis.PlaybackActive, Now))
        {
            return;
        }

        if (recoveryNeeded)
        {
            store.RecoverInterrupted();
            recoveryNeeded = false;
        }

        var items = store.DueBatch(Now, Math.Max(1, BatchSize));
        if (items.Count == 0)
        {
            return;
        }

        try
        {
            await PrepareBatch(items, settings, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            recoveryNeeded = true;
            foreach (var item in items)
            {
                var current = store.Find(item.Path);
                if (current?.State == "running")
                {
                    store.Put(PreparationPolicy.Failed(current, Now, "Analysis was interrupted. Existing results are preserved."));
                }
            }

            recoveryNeeded = false;
            Log.Warning(exception, "Automatic preparation batch of {Tracks} tracks was interrupted", items.Count);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        library.NewTracksIndexed += RequestReconcile;
        try
        {
            // Let library/schema startup and the saved-analysis backfill finish first.
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            recoveryNeeded = true;
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (recoveryNeeded)
                    {
                        store.RecoverInterrupted();
                        recoveryNeeded = false;
                    }

                    if (Interlocked.Exchange(ref reconcileRequested, 0) == 1 || Now - LastCheckedAt > 60_000)
                    {
                        Reconcile(stoppingToken);
                    }

                    await ProcessNext(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception)
                {
                    Log.Warning(exception, "Automatic preparation will retry its queue check");
                }

                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
        }
        finally
        {
            library.NewTracksIndexed -= RequestReconcile;
        }
    }

    private MusicTrack Track(string path) => repository.Query(null, null, null, null, null, null, false, false, false, false, false,
        1, 0, dj: new(Paths: [MusicPath.ToAbsolute(path)])).Tracks.FirstOrDefault();

    private void RequestReconcile(IReadOnlyList<string> changedPaths) => Interlocked.Exchange(ref reconcileRequested, 1);

    private async Task PrepareBatch(IReadOnlyList<PreparationItem> items, PreparationSettings settings, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var runEnhanced = settings.Mode != "basic";
        var candidates = items.Select(item => (Item: item, Track: Track(item.Path))).ToArray();
        if (candidates.Any(candidate => candidate.Track == null))
        {
            store.RemoveDeleted();
        }

        var batch = new List<(PreparationItem Item, MusicTrack Track)>();
        lock (gate)
        {
            if (store.Paused || (runEnhanced && !enhanced.Enabled))
            {
                return;
            }

            foreach (var candidate in candidates)
            {
                // A retry, deletion or reconciliation may have changed this row meanwhile.
                if (candidate.Track == null || store.Find(candidate.Item.Path) != candidate.Item)
                {
                    continue;
                }

                var completed = PreparationPolicy.CompletedState(candidate.Track, settings);
                if (completed != null)
                {
                    store.Put(candidate.Item with { State = completed, Detail = "Analysis available", UpdatedAt = Now });
                }
                else
                {
                    batch.Add(candidate);
                }
            }

            if (batch.Count > 0)
            {
                store.PutMany(batch.Select(candidate => candidate.Item with
                {
                    State = "running",
                    Attempts = candidate.Item.Attempts + 1,
                    Detail = "Analysing audio",
                    UpdatedAt = Now,
                }));
            }
        }

        if (batch.Count == 0)
        {
            return;
        }

        try
        {
            Log.Information("Automatic preparation starting {Tracks} tracks in {Mode} mode; Features: {Features}; WriteAutoCues: {WriteAutoCues}",
                batch.Count, settings.Mode, settings.Features == null ? "full" : string.Join(",", settings.Features), settings.WriteAutoCues);
            await analysis.StartScanAsync(new(OnlyPaths: batch.Select(candidate => candidate.Track.Path).ToArray(), SkipAnalysed: true,
                Enhanced: runEnhanced, EnhancedFeatures: settings.Mode == "custom" ? settings.Features : null,
                WriteAutoCues: settings.Mode == "custom" && settings.WriteAutoCues,
                CueUsername: settings.Mode == "custom" && settings.WriteAutoCues ? settings.CueUsername : null));
        }
        catch (InvalidOperationException)
        {
            // Another scan won the race. No attempt was made, so preserve its retry budget.
            store.PutMany(batch.Select(candidate => candidate.Item));
            return;
        }

        while (analysis.ScanState.Scanning)
        {
            await Task.Delay(500, ct);
        }

        if (analysis.ScanState.DependencyUnavailable || analysis.ScanState.Cancelled)
        {
            store.Paused = true;
        }

        foreach (var candidate in batch)
        {
            var item = store.Find(candidate.Item.Path);
            if (item?.State == "running")
            {
                Finish(item, settings);
            }
        }
    }

    private void Finish(PreparationItem item, PreparationSettings settings)
    {
        var track = Track(item.Path);
        if (track == null)
        {
            store.RemoveDeleted();
            return;
        }

        item = item with { FileSize = track.FileSize, FileModified = track.FileModified };
        var completed = PreparationPolicy.CompletedState(track, settings);
        if (completed != null)
        {
            store.Put(item with { State = completed, NextAttemptAt = 0, Detail = "Analysis available", UpdatedAt = Now });
        }
        else if (analysis.ScanState.DependencyUnavailable)
        {
            store.Put(item with
            {
                State = "failed",
                Attempts = Math.Max(0, item.Attempts - 1),
                NextAttemptAt = 0,
                Detail = analysis.ScanState.Error,
                UpdatedAt = Now,
            });
        }
        else if (analysis.ScanState.Cancelled)
        {
            store.Paused = true;
            store.Put(item with { State = "queued", Attempts = Math.Max(0, item.Attempts - 1), Detail = "Paused when analysis was stopped", UpdatedAt = Now });
        }
        else
        {
            store.Put(PreparationPolicy.Failed(
                item,
                Now,
                PreparationPolicy.BasicComplete(track) ? "Enhanced analysis did not finish. Existing results are preserved." : "Some audio measurements are unavailable. Existing results are preserved."));
        }
    }
}
