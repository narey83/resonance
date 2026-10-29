// <copyright file="MusicLibraryService.cs" company="John Narey">
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

namespace resonance.MusicLibrary
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using resonance.Analysis;
    using resonance.Events;
    using resonance.MusicLibrary.Activity;
    using resonance.MusicLibrary.API;
    using resonance.Shares;
    using Serilog;

    /// <summary>
    ///     Maintains a persistent music library database that mirrors the on-disk
    ///     audio files from all configured share directories.
    ///
    ///     On startup (after a short delay) and every 15 minutes thereafter the
    ///     service:
    ///       • Walks all share directories and collects the current file list
    ///       • Compares each file's size + mtime fingerprint against the DB
    ///       • Reads tags only for new or changed files
    ///       • Removes DB entries for files that no longer exist
    ///
    ///     A manual sync can be triggered via <see cref="TriggerSync()"/>.
    /// </summary>
    public class MusicLibraryService : IMusicLibraryService
    {
        // Tag reads are I/O + CPU bound and independent per file, so a full scan reads them in parallel
        // (capped to avoid thrashing the storage) and writes results to the DB in batched transactions.
        private const int SyncWriteBatchSize = 500;

        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "aac", "ogg", "oga", "wav", "wma", "m4a", "m4b", "m4p",
            "ape", "aiff", "aif", "opus", "wv", "mpc", "mpp", "dsf", "aa", "aax",
        };

        private static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(15);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

        private static readonly int SyncReadParallelism = Math.Min(Environment.ProcessorCount, 8);

        // throttles the high-frequency progress broadcasts so a large scan doesn't flood clients with
        // SignalR messages; start/complete/exit transitions are always sent (throttle: false).
        private static readonly TimeSpan SyncBroadcastThrottle = TimeSpan.FromMilliseconds(500);

        private static readonly TimeSpan DebounceDelay = TimeSpan.FromSeconds(30);

        // Floor between two filesystem-watcher-driven scans. The 30s debounce assumes disk changes
        // arrive in occasional bursts, but a run of downloads lands files more or less continuously:
        // measured at 48 completed scans in one hour against a baseline of 4, i.e. a full re-read of
        // every indexed track roughly once a minute, each one broadcasting SYNC_STATE and
        // LIBRARY_UPDATED to every connected client. Explicit triggers (the rescan endpoint, a
        // rename, a convert) are unaffected — this only rate-limits the watcher, which is reacting to
        // changes no one asked to see immediately. The periodic SyncInterval pass still guarantees
        // freshness regardless.
        private static readonly TimeSpan MinWatcherSyncInterval = TimeSpan.FromMinutes(5);

        // A scan runs this often even with no detected change. FileSystemWatcher drops events under
        // load and emits nothing at all for some network mounts, so gating purely on detection risks
        // a library that silently stops reflecting the disk. This is the backstop for that.
        private static readonly TimeSpan FullScanSafetyNet = TimeSpan.FromHours(6);

        // Long-running queues (e.g. a metadata enrichment pass over the whole library) can hold
        // their registration for days; without a cap they'd starve the sync entirely and the
        // library would stop reflecting the filesystem. After this long, sync runs anyway — the
        // worst case is indexing a file mid-tag-write, which the next sync corrects.
        private static readonly TimeSpan MaxSyncDeferral = TimeSpan.FromMinutes(10);

        // SetState is called concurrently from the parallel read workers during a scan, so it must be
        // serialized; this guards CurrentState + the throttle bookkeeping.
        private readonly object syncStateLock = new();

        private readonly object debounceLock = new();
        private readonly HashSet<string> activeQueues = new(StringComparer.OrdinalIgnoreCase);
        private readonly object queueLock = new();

        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> syncExcluded =
            new(StringComparer.OrdinalIgnoreCase);

        // Filesystem watchers over the share roots — one per scan directory. They translate any on-disk
        // change (a completed download, a converter output, a tag rewrite, an external SMB edit, a
        // deletion) into a debounced TriggerSync so the library reflects reality within ~30s instead of
        // waiting up to a full SyncInterval for the periodic scan to notice.
        private readonly List<FileSystemWatcher> watchers = new();

        private DateTime lastSyncBroadcast = DateTime.MinValue;

        // When the last scan finished, so watcher-driven triggers can honour MinWatcherSyncInterval.
        private DateTime lastSyncCompletedUtc = DateTime.MinValue;

        // Set by the filesystem watchers when something under a scanned root actually changed, and
        // cleared when a scan starts. A scan reads the whole tree, so running one with this false
        // can only ever report "nothing changed" — which is exactly what was happening: six scans
        // of 48k tracks in forty minutes, every one of them added=0 updated=0 removed=0.
        private volatile bool pendingFsChange;

        // The path that set the flag, purely so the log can say what woke it.
        private string pendingFsChangePath;

        // Set by explicit requests — the rescan endpoint, a rename, a convert, un-excluding a
        // directory. Those know something changed that the watcher may not have seen, so they scan
        // regardless of the flag above.
        private volatile bool forceNextScan;

        // cancels only the in-flight scan (not the whole background loop); see CancelSync.
        private CancellationTokenSource currentRunCts;

        private DateTime? syncDeferredSinceUtc;

        public MusicLibraryService(OptionsAtStartup options, MusicRepository repository, EventBus eventBus, IHubContext<LibraryActivityHub> hub, ILibraryActivityService activity, ArtworkStore artwork = null)
        {
            Artwork = artwork;
            Options = options;
            Repository = repository;
            Events = eventBus;
            Hub = hub;
            Activity = activity;
        }

        public event Action<IReadOnlyList<string>> NewTracksIndexed;

        public MusicLibrarySyncState SyncState => CurrentState;

        private OptionsAtStartup Options { get; }
        private MusicRepository Repository { get; }
        private EventBus Events { get; }
        private IHubContext<LibraryActivityHub> Hub { get; }
        private ILibraryActivityService Activity { get; }
        private ArtworkStore Artwork { get; }

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Library);

        private MusicLibrarySyncState CurrentState { get; set; } =
            new(false, false, null, 0, 0, 0, 0, 0, 0, 0);

        private CancellationTokenSource LoopCts { get; set; }

        private SemaphoreSlim SyncNow { get; } = new(0, 1);

        private CancellationTokenSource DebounceCts { get; set; }

        // ── IHostedService ────────────────────────────────────────────────────
        public Task StartAsync(CancellationToken cancellationToken)
        {
            Repository.Initialize();
            Events.Subscribe<DownloadDirectoryCompleteEvent>(nameof(MusicLibraryService), _ =>
            {
                Log.Information("Download directory complete — triggering immediate music library sync");
                TriggerImmediateSync();
            });
            LoopCts = new CancellationTokenSource();
            _ = RunLoopAsync(LoopCts.Token);
            StartWatchers();
            return Task.CompletedTask;
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            // Run one final sync to persist any keys written since the last scheduled sync.
            // Skip if a sync is already running; it will complete the write naturally.
            if (!CurrentState.Running)
            {
                try
                {
                    Log.Information("Running final music library sync before shutdown...");
                    await RunSyncAsync(cancellationToken);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Final music library sync on shutdown did not complete");
                }
            }

            StopWatchers();
            LoopCts?.Cancel();
        }

        // ── Public API ────────────────────────────────────────────────────────
        public MusicLibraryQueryResult QueryTracks(string search, string artist, string album, string genre, int? year, string folder, bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork, int limit, int offset, string sort = null, bool descending = false, string startsWith = null, string key = null, string analysis = null, DjLibraryFilters dj = null)
            => Repository.Query(search, artist, album, genre, year, folder, missingKey, missingBpm, missingTitle, missingArtist, missingArtwork, limit, offset, sort, descending, startsWith, key, analysis, dj);

        public System.Collections.Generic.IReadOnlyList<MusicExportTrack> GetExportTracks(System.Collections.Generic.IReadOnlyList<string> paths = null) => Repository.GetExportTracks(paths);

        public System.Collections.Generic.IReadOnlyList<MusicGenre> GetGenres() => Repository.GetGenres();

        public System.Collections.Generic.IReadOnlyList<MusicKey> GetKeys() => Repository.GetKeys();

        public System.Collections.Generic.IReadOnlyList<MusicYear> GetYears() => Repository.GetYears();

        public System.Collections.Generic.IReadOnlyList<MusicFolder> GetFolders() => Repository.GetFolders();

        public MusicTrack GetTrack(string path) => Repository.GetByPath(path);

        /// <summary>
        ///     Re-reads one file's tags and fingerprint and writes them straight to the index,
        ///     without waiting for a sync.
        /// </summary>
        /// <remarks>
        ///     Analysis writes BPM and key into the file's tags, which also changes its size and
        ///     mtime. Until the index catches up the row keeps the old tags, and — because the
        ///     loudness/waveform columns join analysis.track_analysis on file_size — the metrics
        ///     that were just measured read as missing. A sync would fix both, but it is debounced
        ///     and, worse, deferred entirely while an analysis queue is registered, so the whole
        ///     scan can finish before any of its results become visible. One file, one tag read.
        /// </remarks>
        /// <param name="path">The absolute path of the file to re-index.</param>
        /// <returns>A value indicating whether the row was refreshed.</returns>
        public bool RefreshTrack(string path)
        {
            if (!IsLibraryPath(path))
            {
                return false;
            }

            try
            {
                var info = new FileInfo(path);
                if (!info.Exists)
                {
                    return false;
                }

                Repository.Upsert(ReadTrack(info.FullName, info.Length, info.LastWriteTimeUtc.Ticks));
                return true;
            }
            catch (Exception ex)
            {
                Log.Debug("Could not refresh library row for '{Path}': {Error}", path, ex.Message);
                return false;
            }
        }

        public (int Total, double TotalDuration) GetStats() => Repository.GetStats();

        public MusicAnalysisStats GetAnalysisStats() => Repository.GetAnalysisStats();

        public string GetLibraryVersion() => Repository.GetLibraryVersion();

        public System.Collections.Generic.IReadOnlyList<MusicAlbum> GetAlbums(string artistFilter = null)
            => Repository.GetAlbums(artistFilter);

        public System.Collections.Generic.IReadOnlyList<MusicArtist> GetArtists()
            => Repository.GetArtists();

        public System.Collections.Generic.IReadOnlyList<MusicAlbum> GetRecentlyAdded(int limit)
            => Repository.GetRecentlyAdded(limit);

        public System.Collections.Generic.IReadOnlyList<MusicTrack> GetKeyedTracks()
            => Repository.GetKeyedTracks();

        public void ForceResync()
        {
            Repository.ClearAll();
            Log.Information("Music library cleared for forced re-index");
            TriggerImmediateSync();
        }

        public void CancelSync()
        {
            // cancels only the in-flight scan (the linked per-run token), not the background loop;
            // tracks already written stay, and the next sync reconciles the rest.
            var cts = currentRunCts;
            if (cts is null || !CurrentState.Running)
            {
                Log.Debug("CancelSync requested but no scan is running");
                return;
            }

            Log.Information("Cancelling in-flight music library sync");
            try
            {
                cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // the run finished between the null check and Cancel(); nothing to do
            }
        }

        public void TriggerSync()
        {
            forceNextScan = true;
            DebounceSync(DebounceDelay);
        }

        public void TriggerImmediateSync()
        {
            forceNextScan = true;

            lock (debounceLock)
            {
                DebounceCts?.Cancel();
                DebounceCts = null;
                if (SyncNow.CurrentCount == 0)
                {
                    try
                    {
                        SyncNow.Release();
                    }
                    catch
                    { /* already signalled */
                    }
                }
            }
        }

        public void ExcludeFromSync(string directory)
        {
            if (!string.IsNullOrWhiteSpace(directory))
            {
                syncExcluded[directory] = true;
            }
        }

        public void IncludeInSync(string directory)
        {
            if (!string.IsNullOrWhiteSpace(directory))
            {
                syncExcluded.TryRemove(directory, out _);
            }

            TriggerSync();
        }

        public void RenameFolder(string path, string newLeafName)
        {
            if (!Directory.Exists(path))
            {
                throw new DirectoryNotFoundException($"Folder not found: {path}");
            }

            var parent = Path.GetDirectoryName(path)
                ?? throw new InvalidOperationException("Cannot rename a root directory");
            var newPath = Path.Combine(parent, newLeafName);

            if (Directory.Exists(newPath))
            {
                throw new InvalidOperationException($"A folder named '{newLeafName}' already exists.");
            }

            Directory.Move(path, newPath);
            Repository.RenameDirectory(path, newPath);
            Log.Information("Renamed folder '{Old}' to '{New}'", path, newPath);
            _ = Hub.BroadcastLibraryUpdatedAsync(0, 1, 0);
        }

        public void RenameTrack(string path, string newFilename)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Track not found", path);
            }

            var dir = Path.GetDirectoryName(path) ?? string.Empty;
            var newPath = Path.Combine(dir, newFilename);

            if (File.Exists(newPath))
            {
                throw new InvalidOperationException($"A file named '{newFilename}' already exists.");
            }

            File.Move(path, newPath);
            Repository.RenameTrackPath(path, newPath, newFilename);
            Log.Information("Renamed track '{Old}' to '{New}'", path, newPath);
            _ = Hub.BroadcastLibraryUpdatedAsync(0, 1, 0);
        }

        public void DeleteTrack(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Track not found", path);
            }

            File.Delete(path);
            Log.Information("Deleted track '{Path}' from disk", path);
            TriggerImmediateSync();
        }

        public void DeleteFolder(string path)
        {
            if (!Directory.Exists(path))
            {
                throw new DirectoryNotFoundException($"Folder not found: {path}");
            }

            Directory.Delete(path, recursive: true);
            Log.Information("Deleted folder '{Path}' from disk", path);
            TriggerImmediateSync();
        }

        public void RegisterQueue(string name)
        {
            lock (queueLock)
            {
                activeQueues.Add(name);
            }
        }

        public void DeregisterQueue(string name)
        {
            lock (queueLock)
            {
                activeQueues.Remove(name);
            }

            TriggerImmediateSync();
        }

        public bool IsQueueActive(string name)
        {
            lock (queueLock)
            {
                return activeQueues.Contains(name);
            }
        }

        /// <inheritdoc/>
        public bool IsLibraryPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            foreach (var dir in GetScanDirectories())
            {
                if (resonance.Common.LibraryPathSecurity.Contains(dir, path))
                {
                    return true;
                }
            }

            return false;
        }

        private static IEnumerable<FileInfo> EnumerateAudio(string root)
            => new DirectoryInfo(root)

                // IgnoreInaccessible so an unreadable subdir (e.g. a mount root's lost+found) is skipped
                // rather than aborting the whole walk — same as the share scanner.
                .EnumerateFiles("*", new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
                })
                .Where(f => AudioExtensions.Contains(f.Extension.TrimStart('.').ToLowerInvariant()));

        private static string DetectTagTypes(TagLib.File tf)
        {
            var parts = new System.Collections.Generic.List<string>();

            if (tf.GetTag(TagLib.TagTypes.Id3v1) != null)
            {
                parts.Add("ID3v1");
            }

            if (tf.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2Tag)
            {
                parts.Add($"ID3v2.{id3v2Tag.Version}");
            }

            if (tf.GetTag(TagLib.TagTypes.Xiph) != null)
            {
                parts.Add("Xiph");
            }

            if (tf.GetTag(TagLib.TagTypes.Ape) != null)
            {
                parts.Add("APEv2");
            }

            if (tf.GetTag(TagLib.TagTypes.Apple) != null)
            {
                parts.Add("iTunes");
            }

            if (tf.GetTag(TagLib.TagTypes.Asf) != null)
            {
                parts.Add("ASF");
            }

            return parts.Count > 0 ? string.Join(", ", parts) : null;
        }

        private static MusicTrack ReadTrack(string path, long size, long modified)
        {
            using var tf = TagLib.File.Create(path, TagLib.ReadStyle.Average);
            var tag = tf.Tag;

            string key = null;
            if (tf.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2)
            {
                key = KeyTagHelper.ReadKey(id3v2);
            }
            else if (tf.GetTag(TagLib.TagTypes.Xiph) is TagLib.Ogg.XiphComment xiph)
            {
                var fields = xiph.GetField("INITIALKEY");
                if (fields.Length > 0 && !string.IsNullOrEmpty(fields[0]))
                {
                    key = fields[0].Trim();
                }
            }

            return new MusicTrack(
                Path: path,
                Filename: Path.GetFileName(path),
                Directory: Path.GetDirectoryName(path) ?? string.Empty,
                Extension: Path.GetExtension(path).TrimStart('.').ToLowerInvariant(),
                FileSize: size,
                FileModified: modified,
                IndexedAt: DateTimeOffset.UtcNow.Ticks,
                Duration: tf.Properties?.Duration.TotalSeconds,
                Title: Trim(tag.Title),
                Artist: Trim(tag.JoinedPerformers),
                AlbumArtist: Trim(tag.JoinedAlbumArtists),
                Album: Trim(tag.Album),
                Year: tag.Year == 0 ? null : (int?)tag.Year,
                TrackNumber: tag.Track == 0 ? null : (int?)tag.Track,
                DiscNumber: tag.Disc == 0 ? null : (int?)tag.Disc,
                Genre: Trim(tag.Genres?.Length > 0 ? tag.Genres[0] : null),
                Bpm: tag.BeatsPerMinute == 0 ? null : (int?)tag.BeatsPerMinute,
                Key: key,
                Comment: Trim(tag.Comment),
                HasArtwork: HasServableArtwork(tag),
                TagTypes: DetectTagTypes(tf),
                BitRate: tf.Properties?.AudioBitrate is int br && br > 0 ? br : null,
                SampleRate: tf.Properties?.AudioSampleRate is int sr && sr > 0 ? sr : null,
                BitDepth: tf.Properties?.BitsPerSample is int bd && bd > 0 ? bd : null);
        }

        private static bool HasServableArtwork(TagLib.Tag tag)
        {
            var pic = tag.Pictures?.FirstOrDefault();
            if (pic == null || pic.Data.Count == 0)
            {
                return false;
            }

            var b = pic.Data.Data;
            if (b.Length < 4)
            {
                return false;
            }

            return (b[0] == 0xFF && b[1] == 0xD8)
                || (b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47)
                || (b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46)
                || (b.Length >= 12 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50);
        }

        private static string Trim(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        // ── Background loop ───────────────────────────────────────────────────
        private async Task RunLoopAsync(CancellationToken ct)
        {
            try
            {
                // Give the rest of the app time to finish starting
                await Task.Delay(StartupDelay, ct);

                while (!ct.IsCancellationRequested)
                {
                    await RunSyncAsync(ct);

                    // Wait up to SyncInterval, but wake immediately if TriggerSync() is called
                    using var intervalCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    intervalCts.CancelAfter(SyncInterval);
                    try
                    {
                        await SyncNow.WaitAsync(intervalCts.Token);
                    }
                    catch (OperationCanceledException)
                    { /* interval expired or shutdown */
                    }
                }
            }
            catch (OperationCanceledException)
            { /* normal shutdown */
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Music library background loop crashed");
            }
        }

        // Assigns the current sync state and pushes it to connected clients so the UI can show a live
        // "scanning…" banner. Progress updates pass throttle: true to avoid flooding clients; lifecycle
        // transitions (start/complete/exit) use the default so they're always delivered.
        private void SetState(MusicLibrarySyncState state, bool throttle = false)
        {
            lock (syncStateLock)
            {
                CurrentState = state;

                if (throttle && DateTime.UtcNow - lastSyncBroadcast < SyncBroadcastThrottle)
                {
                    return;
                }

                lastSyncBroadcast = DateTime.UtcNow;
                _ = Hub.BroadcastSyncStateAsync(state);
            }
        }

        // ── Sync ──────────────────────────────────────────────────────────────
        private async Task RunSyncAsync(CancellationToken ct)
        {
            lock (queueLock)
            {
                if (activeQueues.Count > 0)
                {
                    syncDeferredSinceUtc ??= DateTime.UtcNow;
                    var deferredFor = DateTime.UtcNow - syncDeferredSinceUtc.Value;

                    if (deferredFor < MaxSyncDeferral)
                    {
                        Log.Information("Music library sync deferred — active queues: {Queues}", string.Join(", ", activeQueues));
                        return;
                    }

                    Log.Information(
                        "Music library sync proceeding despite active queues ({Queues}) — deferred for {Minutes:F0} minutes",
                        string.Join(", ", activeQueues),
                        deferredFor.TotalMinutes);
                }

                syncDeferredSinceUtc = null;
            }

            if (CurrentState.Running)
            {
                return;
            }

            // Only scan when something was actually detected. The periodic pass and any redundant
            // debounce that slips through the watcher floor both land here and go no further unless
            // the disk really changed.
            var forced = forceNextScan;
            var detected = pendingFsChange;
            var sinceLastScan = DateTime.UtcNow - lastSyncCompletedUtc;

            if (!forced && !detected && lastSyncCompletedUtc != DateTime.MinValue && sinceLastScan < FullScanSafetyNet)
            {
                Log.Debug(
                    "Music library sync skipped — no filesystem changes detected ({Minutes:F0} minutes since the last scan)",
                    sinceLastScan.TotalMinutes);
                return;
            }

            var trigger = forced ? "requested" : detected ? $"detected \"{pendingFsChangePath}\"" : "periodic safety net";

            forceNextScan = false;
            pendingFsChange = false;
            pendingFsChangePath = null;

            Log.Information("Music library sync starting ({Trigger})", trigger);
            SetState(CurrentState with { Running = true, Completed = false, Progress = 0 });

            // a per-run token so CancelSync() can abort just this scan without stopping the background loop
            currentRunCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var runToken = currentRunCts.Token;

            var added = 0;
            var updated = 0;
            var removed = 0;
            var unchanged = 0;
            var failed = 0;

            try
            {
                // ── 1. Enumerate all audio files on the filesystem ────────────
                var fsFiles = new Dictionary<string, FileInfo>(StringComparer.Ordinal);
                foreach (var dir in GetScanDirectories())
                {
                    runToken.ThrowIfCancellationRequested();
                    try
                    {
                        foreach (var fi in EnumerateAudio(dir))
                        {
                            if (!IsExcludedFromSync(fi.FullName))
                            {
                                fsFiles.TryAdd(fi.FullName, fi);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Music library sync: cannot scan {Dir}: {Err}", dir, ex.Message);
                    }
                }

                // ── 2. Load existing fingerprints from DB ─────────────────────
                var dbPrints = Repository.GetAllFingerprints();
                var total = fsFiles.Count;

                // ── 3. Partition (cheap, in-memory): which files need a (re)read? ──
                // Tag reads are the expensive part, so we only do them for new/changed files; unchanged
                // files are counted here without touching the disk.
                var toRead = new List<(string Path, long Size, long Mod, bool IsNew)>();
                foreach (var (path, fi) in fsFiles)
                {
                    runToken.ThrowIfCancellationRequested();
                    var size = fi.Length;
                    var mod = fi.LastWriteTimeUtc.Ticks;

                    if (!dbPrints.TryGetValue(path, out var fp))
                    {
                        toRead.Add((path, size, mod, true));
                    }
                    else if (fp.Size != size || fp.Modified != mod)
                    {
                        toRead.Add((path, size, mod, false));
                    }
                    else
                    {
                        unchanged++;
                    }
                }

                // ── 3b. Read tags in parallel and write to the DB in batched transactions ─────
                // Readers (bounded parallelism) produce MusicTracks into a bounded channel; a single
                // consumer drains them into Repository.UpsertMany batches. Reads overlap with writes,
                // and the per-file commit storm becomes ~N/batch commits.
                var readTotal = toRead.Count;
                var doneReads = 0;
                var unchangedBase = unchanged; // fixed once partitioning is done

                // Every newly-added track's path — handed to NewTracksIndexed once the sync
                // commits, so the full analysis pass (BPM, key, waveform, loudness) runs
                // automatically on a fresh download instead of sitting incomplete/wrong until
                // someone runs a manual scan.
                var newlyAdded = new System.Collections.Concurrent.ConcurrentBag<string>();

                var channel = Channel.CreateBounded<MusicTrack>(
                    new BoundedChannelOptions(SyncWriteBatchSize * 4) { SingleReader = true, SingleWriter = false });

                // drain with CancellationToken.None so already-read tracks still get persisted on cancel;
                // the consumer stops when the channel is completed (in the finally below).
                var writer = Task.Run(async () =>
                {
                    var batch = new List<MusicTrack>(SyncWriteBatchSize);
                    await foreach (var track in channel.Reader.ReadAllAsync(CancellationToken.None))
                    {
                        batch.Add(track);
                        if (batch.Count >= SyncWriteBatchSize)
                        {
                            Repository.UpsertMany(batch, SyncWriteBatchSize);
                            batch.Clear();
                        }
                    }

                    if (batch.Count > 0)
                    {
                        Repository.UpsertMany(batch, SyncWriteBatchSize);
                    }
                });

                try
                {
                    await Parallel.ForEachAsync(
                        toRead,
                        new ParallelOptions { MaxDegreeOfParallelism = SyncReadParallelism, CancellationToken = runToken },
                        async (item, token) =>
                        {
                            try
                            {
                                var track = ReadTrack(item.Path, item.Size, item.Mod);
                                await channel.Writer.WriteAsync(track, token);

                                if (item.IsNew)
                                {
                                    Interlocked.Increment(ref added);
                                    newlyAdded.Add(track.Path);
                                }
                                else
                                {
                                    Interlocked.Increment(ref updated);
                                }
                            }
                            catch (Exception ex) when (ex is not OperationCanceledException)
                            {
                                Log.Debug("Music library sync: cannot read {File}: {Err}", item.Path, ex.Message);
                                Interlocked.Increment(ref failed);
                            }

                            var n = Interlocked.Increment(ref doneReads);
                            if (n % 100 == 0 || n == readTotal)
                            {
                                SetState(CurrentState with { Progress = total > 0 ? (double)(unchangedBase + n) / total : 1.0 }, throttle: true);
                            }
                        });
                }
                finally
                {
                    // stop the writer and wait for it to flush whatever was read (including on cancel)
                    channel.Writer.Complete();
                    await writer;
                }

                // ── 4. Remove stale entries ───────────────────────────────────
                var stale = dbPrints.Keys.Except(fsFiles.Keys, StringComparer.Ordinal).ToList();
                if (stale.Count > 0)
                {
                    Repository.DeletePaths(stale);

                    // Drop their cached covers too, or the artwork table grows without bound as
                    // tracks come and go and keeps rows no path will ever ask for again.
                    Artwork?.Evict(stale);
                }

                removed = stale.Count;

                var (totalTracks, _) = Repository.GetStats();

                Log.Information(
                    "Music library sync complete — {Total} tracks · added={A} updated={U} removed={R} unchanged={N} failed={F}",
                    totalTracks, added, updated, removed, unchanged, failed);

                if (!newlyAdded.IsEmpty)
                {
                    NewTracksIndexed?.Invoke(newlyAdded.ToList());
                }

                SetState(new MusicLibrarySyncState(
                    false, true, DateTimeOffset.UtcNow.Ticks,
                    totalTracks, added, updated, removed, unchanged, failed, 1.0));

                if (added + updated + removed > 0)
                {
                    _ = Hub.BroadcastLibraryUpdatedAsync(added, updated, removed,
                        stale.Count <= 500 ? stale.AsReadOnly() : null);
                }

                // Now that the library reflects the filesystem, repoint/prune loved tracks whose
                // files were renamed (extension changes) or removed.
                try
                {
                    await Activity.ReconcileLovedTracksAsync();
                }
                catch (Exception ex)
                {
                    Log.Warning("Loved track reconciliation failed: {Err}", ex.Message);
                }
            }
            catch (OperationCanceledException)
            {
                Log.Information("Music library sync cancelled");
                SetState(CurrentState with { Running = false });
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Music library sync failed unexpectedly");
                SetState(CurrentState with { Running = false });
            }
            finally
            {
                // Stamped on every exit path — completed, cancelled or failed. A scan that failed
                // still cost a full read of the tree, so the watcher floor must apply to it too,
                // otherwise a repeatedly-failing scan would loop at the debounce interval.
                lastSyncCompletedUtc = DateTime.UtcNow;
                currentRunCts?.Dispose();
                currentRunCts = null;
            }

            await Task.Yield(); // yield back to caller
        }

        // ── Filesystem watchers ───────────────────────────────────────────────
        private void StartWatchers()
        {
            foreach (var dir in GetScanDirectories())
            {
                try
                {
                    var watcher = new FileSystemWatcher(dir)
                    {
                        IncludeSubdirectories = true,

                        // FileName/DirectoryName cover create/delete/rename; LastWrite/Size cover
                        // in-place edits (tag & metadata rewrites). We deliberately omit LastAccess.
                        NotifyFilter = NotifyFilters.FileName
                            | NotifyFilters.DirectoryName
                            | NotifyFilters.LastWrite
                            | NotifyFilters.Size,

                        // A bulk download/delete can emit hundreds of events at once; a larger buffer
                        // makes an overflow (→ Error, handled below) far less likely.
                        InternalBufferSize = 64 * 1024,
                    };

                    watcher.Created += OnFsChange;
                    watcher.Deleted += OnFsChange;
                    watcher.Changed += OnFsChange;
                    watcher.Renamed += OnFsRenamed;
                    watcher.Error += OnFsError;
                    watcher.EnableRaisingEvents = true;

                    watchers.Add(watcher);
                    Log.Information("Watching library directory for changes: {Dir}", dir);
                }
                catch (Exception ex)
                {
                    // A watcher failing to attach (e.g. a filesystem without inotify support) must not
                    // break the service — the periodic scan still keeps the library in sync.
                    Log.Warning("Could not watch library directory {Dir}: {Err}", dir, ex.Message);
                }
            }
        }

        private void StopWatchers()
        {
            foreach (var watcher in watchers)
            {
                try
                {
                    watcher.EnableRaisingEvents = false;
                    watcher.Dispose();
                }
                catch
                { /* best-effort teardown on shutdown */
                }
            }

            watchers.Clear();
        }

        // Returns true if a filesystem path is worth reacting to: audio files, and structural changes
        // (directories, which have no extension). Non-audio files (.jpg covers, .part/.tmp download
        // scratch, .nfo) are ignored so an in-progress download doesn't churn the debounce needlessly.
        private bool ShouldReactTo(string path)
        {
            if (string.IsNullOrEmpty(path) || IsExcludedFromSync(path))
            {
                return false;
            }

            var ext = Path.GetExtension(path);
            if (string.IsNullOrEmpty(ext))
            {
                // No extension → almost certainly a directory create/delete/rename; react so newly
                // added or removed folders are picked up.
                return true;
            }

            return AudioExtensions.Contains(ext.TrimStart('.').ToLowerInvariant());
        }

        /// <summary>
        ///     Debounced trigger used by the filesystem watchers. Behaves like <see cref="TriggerSync()"/>
        ///     but never fires sooner than <see cref="MinWatcherSyncInterval"/> after the previous scan
        ///     finished, so a steady stream of arriving files can't rescan the whole library on repeat.
        /// </summary>
        private void NoteFsChange(string path)
        {
            pendingFsChangePath ??= path;
            pendingFsChange = true;
        }

        private void TriggerWatcherSync()
        {
            // Measure from now while a scan is in flight, not from the previous completion. Files
            // keep landing during a scan, and by the time one starts the previous completion is
            // already a full interval old — so those triggers saw a satisfied floor and queued
            // another scan one DebounceDelay later, trailing every scan with a near-duplicate.
            var reference = CurrentState.Running ? DateTime.UtcNow : lastSyncCompletedUtc;
            var remaining = MinWatcherSyncInterval - (DateTime.UtcNow - reference);
            DebounceSync(remaining > DebounceDelay ? remaining : DebounceDelay);
        }

        private void DebounceSync(TimeSpan delay)
        {
            lock (debounceLock)
            {
                DebounceCts?.Cancel();
                DebounceCts = new CancellationTokenSource();
                var token = DebounceCts.Token;
                _ = Task.Delay(delay, token).ContinueWith(_ =>
                {
                    if (!token.IsCancellationRequested && SyncNow.CurrentCount == 0)
                    {
                        try
                        {
                            SyncNow.Release();
                        }
                        catch
                        { /* already signalled */
                        }
                    }
                }, CancellationToken.None);
            }
        }

        private void OnFsChange(object sender, FileSystemEventArgs e)
        {
            if (ShouldReactTo(e.FullPath))
            {
                NoteFsChange(e.FullPath);
                TriggerWatcherSync();
            }
        }

        private void OnFsRenamed(object sender, RenamedEventArgs e)
        {
            // A temp-to-final rename (song.mp3.part → song.mp3, common for yt-dlp and other downloaders)
            // only becomes interesting via the new name, so check both ends.
            if (ShouldReactTo(e.FullPath) || ShouldReactTo(e.OldFullPath))
            {
                NoteFsChange(e.FullPath);
                TriggerWatcherSync();
            }
        }

        private void OnFsError(object sender, ErrorEventArgs e)
        {
            // Buffer overflow (or a transient inotify error) means we've lost events, so we can't trust
            // incremental change signals — fall back to a full immediate reconciliation. The watcher
            // recovers on its own once the buffer drains; we don't tear it down.
            Log.Warning("Library watcher error — forcing a full sync to catch missed changes: {Err}", e.GetException()?.Message);
            TriggerImmediateSync();
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private IEnumerable<string> GetScanDirectories()
            => Options.Shares.Directories
                .Select(d => new Share(d.TrimEnd('/', '\\')).LocalPath)
                .Where(Directory.Exists)
                .Distinct(StringComparer.OrdinalIgnoreCase);

        private bool IsExcludedFromSync(string filePath)
        {
            foreach (var dir in syncExcluded.Keys)
            {
                var prefix = dir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
                if (filePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
