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
    public string WaitingReason => store.Paused ? "Paused after the current track"
        : FilesBeingUpdated ? "Waiting for metadata updates to finish"
        : analysis.PlaybackActive ? "Waiting for playback to go idle"
        : analysis.ScanState.Scanning ? "Analysis is running" : null;
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private bool FilesBeingUpdated => library?.IsQueueActive("metadata") == true || library?.IsQueueActive("tag-sanitization") == true;

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

    public void Reconcile()
    {
        for (var offset = 0; ; offset += 200)
        {
            var page = repository.Query(null, null, null, null, null, null, false, false, false, false, false, 200, offset, sort: "title");
            lock (gate)
            {
                var known = store.FindMany(page.Tracks.Select(track => MusicPath.ToRelative(track.Path)));
                var changes = new List<PreparationItem>();
                foreach (var track in page.Tracks)
                {
                    var path = MusicPath.ToRelative(track.Path);
                    known.TryGetValue(path, out var existing);
                    if (existing?.State == "running")
                    {
                        continue;
                    }

                    var completed = PreparationPolicy.CompletedState(track, enhanced.Enabled);
                    var changed = existing == null || existing.FileSize != track.FileSize || existing.FileModified != track.FileModified;
                    if (completed != null)
                    {
                        if (changed || existing.State != completed)
                        {
                            changes.Add(new(path, track.FileSize, track.FileModified, completed, 0, 0, "Analysis available", Now));
                        }
                    }
                    else if (changed || existing.State is "complete" or "basic")
                    {
                        changes.Add(new(path, track.FileSize, track.FileModified, "queued", 0, Now, "Waiting for analysis", Now));
                    }
                }

                if (changes.Count > 0)
                {
                    store.PutMany(changes);
                }
            }

            if (offset + page.Tracks.Count >= page.Total || page.Tracks.Count == 0)
            {
                break;
            }
        }

        store.RemoveDeleted();
        LastCheckedAt = Now;
    }

    internal async Task ProcessNext(CancellationToken ct)
    {
        if (store.Paused || FilesBeingUpdated || analysis.ScanState.Scanning || playbackGate.ShouldWait(analysis.PlaybackActive, Now))
        {
            return;
        }

        if (recoveryNeeded)
        {
            store.RecoverInterrupted();
            recoveryNeeded = false;
        }

        var item = store.Due(Now);
        if (item == null)
        {
            return;
        }

        try
        {
            await Prepare(item, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            recoveryNeeded = true;
            var current = store.Find(item.Path);
            if (current?.State == "running")
            {
                store.Put(PreparationPolicy.Failed(current, Now, "Analysis was interrupted. Existing results are preserved."));
            }

            recoveryNeeded = false;
            Log.Warning(exception, "Preparation for {Path} was interrupted", item.Path);
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
                        Reconcile();
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

    private async Task Prepare(PreparationItem item, CancellationToken ct)
    {
        var track = Track(item.Path);
        if (track == null)
        {
            store.RemoveDeleted();
            return;
        }

        var completed = PreparationPolicy.CompletedState(track, enhanced.Enabled);
        if (completed != null)
        {
            store.Put(item with { State = completed, Detail = "Analysis available", UpdatedAt = Now });
            return;
        }

        lock (gate)
        {
            // A retry, pause or reconciliation may have changed the selected row meanwhile.
            var current = store.Find(item.Path);
            if (store.Paused || current != item)
            {
                return;
            }

            store.Put(item with { State = "running", Attempts = item.Attempts + 1, Detail = "Analysing audio", UpdatedAt = Now });
        }

        try
        {
            await analysis.StartScanAsync(new(OnlyPaths: [track.Path], SkipAnalysed: true));
        }
        catch (InvalidOperationException)
        {
            // Another scan won the race. No attempt was made, so preserve its retry budget.
            store.Put(item);
            return;
        }

        item = store.Find(item.Path);
        while (analysis.ScanState.Scanning)
        {
            await Task.Delay(500, ct);
        }

        track = Track(item.Path);
        if (track == null)
        {
            store.RemoveDeleted();
            return;
        }

        item = item with { FileSize = track.FileSize, FileModified = track.FileModified };
        completed = PreparationPolicy.CompletedState(track, enhanced.Enabled);
        if (completed != null)
        {
            store.Put(item with { State = completed, NextAttemptAt = 0, Detail = "Analysis available", UpdatedAt = Now });
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
