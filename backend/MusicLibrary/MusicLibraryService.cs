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
    using System.Threading.Tasks;
    using Microsoft.AspNetCore.SignalR;
    using resonance.Events;
    using resonance.KeyAnalysis;
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
    ///     A manual sync can be triggered via <see cref="TriggerSync"/>.
    /// </summary>
    public class MusicLibraryService : IMusicLibraryService
    {
        private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            "mp3", "flac", "aac", "ogg", "oga", "wav", "wma", "m4a", "m4b", "m4p",
            "ape", "aiff", "aif", "opus", "wv", "mpc", "mpp", "dsf", "aa", "aax",
        };

        private static readonly TimeSpan SyncInterval = TimeSpan.FromMinutes(15);
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(45);

        public MusicLibraryService(OptionsAtStartup options, MusicRepository repository, EventBus eventBus, IHubContext<LibraryActivityHub> hub, ILibraryActivityService activity)
        {
            Options = options;
            Repository = repository;
            Events = eventBus;
            Hub = hub;
            Activity = activity;
        }

        public MusicLibrarySyncState SyncState => CurrentState;

        private OptionsAtStartup Options { get; }
        private MusicRepository Repository { get; }
        private EventBus Events { get; }
        private IHubContext<LibraryActivityHub> Hub { get; }
        private ILibraryActivityService Activity { get; }

        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Music.Library);

        private MusicLibrarySyncState CurrentState { get; set; } =
            new(false, false, null, 0, 0, 0, 0, 0, 0, 0);

        private static readonly TimeSpan DebounceDelay = TimeSpan.FromSeconds(30);

        private CancellationTokenSource LoopCts { get; set; }
        private SemaphoreSlim SyncNow { get; } = new(0, 1);
        private CancellationTokenSource DebounceCts { get; set; }
        private readonly object debounceLock = new();
        private readonly HashSet<string> activeQueues = new(StringComparer.OrdinalIgnoreCase);
        private readonly object queueLock = new();

        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> syncExcluded =
            new(StringComparer.OrdinalIgnoreCase);

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

            LoopCts?.Cancel();
        }

        // ── Public API ────────────────────────────────────────────────────────
        public MusicLibraryQueryResult QueryTracks(string search, string artist, string album, string genre, int? year, string folder, bool missingKey, bool missingBpm, bool missingTitle, bool missingArtist, bool missingArtwork, int limit, int offset, string sort = null, bool descending = false)
            => Repository.Query(search, artist, album, genre, year, folder, missingKey, missingBpm, missingTitle, missingArtist, missingArtwork, limit, offset, sort, descending);

        public System.Collections.Generic.IReadOnlyList<MusicGenre> GetGenres() => Repository.GetGenres();
        public System.Collections.Generic.IReadOnlyList<MusicYear> GetYears() => Repository.GetYears();
        public System.Collections.Generic.IReadOnlyList<MusicFolder> GetFolders() => Repository.GetFolders();
        public MusicTrack GetTrack(string path) => Repository.GetByPath(path);

        public (int Total, double TotalDuration) GetStats() => Repository.GetStats();

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

        public void TriggerSync()
        {
            lock (debounceLock)
            {
                DebounceCts?.Cancel();
                DebounceCts = new CancellationTokenSource();
                var token = DebounceCts.Token;
                _ = Task.Delay(DebounceDelay, token).ContinueWith(_ =>
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

        public void TriggerImmediateSync()
        {
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

        // ── Sync ──────────────────────────────────────────────────────────────
        private async Task RunSyncAsync(CancellationToken ct)
        {
            lock (queueLock)
            {
                if (activeQueues.Count > 0)
                {
                    Log.Debug("Music library sync deferred — active queues: {Queues}", string.Join(", ", activeQueues));
                    return;
                }
            }

            if (CurrentState.Running)
            {
                return;
            }

            Log.Information("Music library sync starting");
            CurrentState = CurrentState with { Running = true, Completed = false, Progress = 0 };

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
                    ct.ThrowIfCancellationRequested();
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
                var done = 0;

                // ── 3. Process files: add new, update changed, skip unchanged ─
                foreach (var (path, fi) in fsFiles)
                {
                    ct.ThrowIfCancellationRequested();

                    try
                    {
                        var size = fi.Length;
                        var mod = fi.LastWriteTimeUtc.Ticks;

                        if (!dbPrints.TryGetValue(path, out var fp))
                        {
                            Repository.Upsert(ReadTrack(path, size, mod));
                            Interlocked.Increment(ref added);
                        }
                        else if (fp.Size != size || fp.Modified != mod)
                        {
                            Repository.Upsert(ReadTrack(path, size, mod));
                            Interlocked.Increment(ref updated);
                        }
                        else
                        {
                            Interlocked.Increment(ref unchanged);
                        }
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        Log.Debug("Music library sync: cannot read {File}: {Err}", path, ex.Message);
                        Interlocked.Increment(ref failed);
                    }

                    done++;
                    if (done % 100 == 0 || done == total)
                    {
                        CurrentState = CurrentState with { Progress = total > 0 ? (double)done / total : 1.0 };
                    }
                }

                // ── 4. Remove stale entries ───────────────────────────────────
                var stale = dbPrints.Keys.Except(fsFiles.Keys, StringComparer.Ordinal).ToList();
                if (stale.Count > 0)
                {
                    Repository.DeletePaths(stale);
                }

                removed = stale.Count;

                var (totalTracks, _) = Repository.GetStats();

                Log.Information(
                    "Music library sync complete — {Total} tracks · added={A} updated={U} removed={R} unchanged={N} failed={F}",
                    totalTracks, added, updated, removed, unchanged, failed);

                CurrentState = new MusicLibrarySyncState(
                    false, true, DateTimeOffset.UtcNow.Ticks,
                    totalTracks, added, updated, removed, unchanged, failed, 1.0);

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
                CurrentState = CurrentState with { Running = false };
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Music library sync failed unexpectedly");
                CurrentState = CurrentState with { Running = false };
            }

            await Task.Yield(); // yield back to caller
        }

        // ── Helpers ───────────────────────────────────────────────────────────
        private IEnumerable<string> GetScanDirectories()
            => Options.Shares.Directories
                .Select(d => new Share(d.TrimEnd('/', '\\')).LocalPath)
                .Where(Directory.Exists)
                .Distinct(StringComparer.OrdinalIgnoreCase);

        /// <inheritdoc/>
        public bool IsLibraryPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return false;
            }

            string fullPath;
            try
            {
                // Resolve "..", symlinks-as-text, etc. so a traversal can't escape a share root.
                fullPath = Path.GetFullPath(path);
            }
            catch
            {
                return false;
            }

            foreach (var dir in GetScanDirectories())
            {
                var root = Path.GetFullPath(dir)
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    + Path.DirectorySeparatorChar;
                if (fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

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

        private static IEnumerable<FileInfo> EnumerateAudio(string root)
            => new DirectoryInfo(root)
                .EnumerateFiles("*", SearchOption.AllDirectories)
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
                TagTypes: DetectTagTypes(tf));
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
    }
}
