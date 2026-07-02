// <copyright file="ShareScanner.cs" company="JP Dillingham">
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

using System.IO;

namespace resonance.Shares
{
    using System;
    using System.Collections.Generic;
    using System.Data;
    using System.Diagnostics;
    using System.Linq;
    using System.Text.RegularExpressions;
    using System.Threading;
    using System.Threading.Channels;
    using System.Threading.Tasks;
    using resonance.Files;
    using Serilog;

    /// <summary>
    ///     Shared file cache.
    /// </summary>
    public interface IShareScanner
    {
        /// <summary>
        ///     Gets the cache state monitor.
        /// </summary>
        IStateMonitor<SharedFileCacheState> StateMonitor { get; }

        /// <summary>
        ///     Scans the configured shares and fills the cache.
        /// </summary>
        /// <param name="shares">The list of shares from which to fill the cache.</param>
        /// <param name="options">The current options snapshot.</param>
        /// <param name="repository">The repository to update.</param>
        /// <param name="targetDirectories">If provided, only scan these local directories (targeted scan). If null, scan all shares.</param>
        /// <param name="virtualDirectories">Optional virtual directories (masked→original) to materialise into the cache with the scan timestamp so they survive the post-scan prune.</param>
        /// <returns>The operation context.</returns>
        Task ScanAsync(IEnumerable<Share> shares, Options.SharesOptions options, IShareRepository repository, IEnumerable<string> targetDirectories = null, IEnumerable<VirtualShareDirectory> virtualDirectories = null);

        /// <summary>
        ///     Materialises a single virtual directory into the cache: builds Soulseek file entries from the
        ///     real files behind each masked name and upserts them under <paramref name="timestamp"/>. Used both
        ///     during a scan and for immediate, targeted updates outside a scan.
        /// </summary>
        /// <param name="directory">The virtual directory to materialise.</param>
        /// <param name="timestamp">The scan timestamp to stamp the entries with.</param>
        /// <param name="repository">The repository to update.</param>
        void MaterializeVirtualDirectory(VirtualShareDirectory directory, long timestamp, IShareRepository repository);

        /// <summary>
        ///     Cancels the currently running fill operation, if one is running.
        /// </summary>
        /// <returns>A value indicating whether a fill operation was cancelled.</returns>
        bool TryCancelScan();
    }

    /// <summary>
    ///     Shared file cache.
    /// </summary>
    public class ShareScanner : IShareScanner
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="ShareScanner"/> class.
        /// </summary>
        /// <param name="workerCount"></param>
        /// <param name="fileService"></param>
        /// <param name="soulseekFileFactory"></param>
        public ShareScanner(
            int workerCount,
            FileService fileService,
            ISoulseekFileFactory soulseekFileFactory = null)
        {
            WorkerCount = workerCount;
            Files = fileService;
            SoulseekFileFactory = soulseekFileFactory ?? new SoulseekFileFactory();

            Flags = Program.Flags;
        }

        /// <summary>
        ///     Gets the cache state monitor.
        /// </summary>
        public IStateMonitor<SharedFileCacheState> StateMonitor => State;

        private FileService Files { get; }
        private int WorkerCount { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Shares.Scan);
        private IReadOnlyList<Share> Shares { get; set; }
        private ISoulseekFileFactory SoulseekFileFactory { get; }
        private IManagedState<SharedFileCacheState> State { get; } = new ManagedState<SharedFileCacheState>();
        private SemaphoreSlim SyncRoot { get; } = new SemaphoreSlim(1);
        private CancellationTokenSource CancellationTokenSource { get; set; }
        private Options.FlagsOptions Flags { get; set; }

        /// <summary>
        ///     Scans the configured shares and fills the cache.
        /// </summary>
        /// <param name="shares">The list of shares from which to fill the cache.</param>
        /// <param name="options">The current options snapshot.</param>
        /// <param name="repository">The repository to update.</param>
        /// <param name="targetDirectories">An optional list of directories to limit the scan to.</param>
        /// <returns>The operation context.</returns>
        public async Task ScanAsync(IEnumerable<Share> shares, Options.SharesOptions options, IShareRepository repository, IEnumerable<string> targetDirectories = null, IEnumerable<VirtualShareDirectory> virtualDirectories = null)
        {
            // obtain the semaphore, or fail if it can't be obtained immediately, indicating that a scan is running.
            if (!await SyncRoot.WaitAsync(millisecondsTimeout: 0))
            {
                Log.Warning("Shared file scan rejected; scan is already in progress.");
                throw new ShareScanInProgressException("Shared files are already being scanned.");
            }

            CancellationTokenSource = CancellationTokenSource.CreateLinkedTokenSource(Program.MasterCancellationTokenSource.Token);
            var cancellationToken = CancellationTokenSource.Token;

            // send control back to the calling context. if we don't do this, the caller will block until
            // directories have been enumerated.
            await Task.Yield();

            CancellationTokenSource reporterCts = null;
            Task reporter = null;

            try
            {
                State.SetValue(state => state with
                {
                    Filling = true,
                    Filled = false,
                    Cancelled = false,
                    FillProgress = 0,
                    Directories = 0,
                    ScannedDirectories = 0,
                    Files = 0,
                    ExcludedDirectories = 0,
                });

                // it's possible that the database was tampered with between the time it was checked at startup and now
                // validate the tables, and if there's an issue, drop and recreate everything.
                if (!repository.TryValidate())
                {
                    Log.Warning("Shared file cache missing or invalid. Re-creating prior to scan.");
                    repository.Create(discardExisting: true);
                    Log.Information("Shared file cache re-created and ready for scan.");
                }

                var regexOptions = RegexOptions.Compiled;

                if (!Flags.CaseSensitiveRegEx)
                {
                    regexOptions |= RegexOptions.IgnoreCase;
                }

                var filters = options.Filters
                    .Select(filter => new Regex(filter, regexOptions))
                    .ToList();

                var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                repository.InsertScan(timestamp, options);

                var sw = new Stopwatch();
                var swSnapshot = 0L;
                sw.Start();

                // note: this should be the only place where we are assigning Shares, so that this is 1) synchronized by SyncRoot
                // and 2) stable throughout the scan.  if this ever changes we'll have to snapshot the value and use it instead
                Shares = shares.ToList();

                if (!Shares.Any())
                {
                    Log.Warning("Aborting shared file scan; no shares configured.");
                }

                // progress counters; updated by the enumeration and the workers, and published on a fixed
                // cadence by the reporter loop so the UI sees steady growth regardless of directory sizes
                var enumeratedDirectories = 0;
                var totalDirectories = 0;
                var current = 0;
                var found = 0;
                var reused = 0;
                var filtered = 0;

                reporterCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                var reporterToken = reporterCts.Token;

                reporter = Task.Run(async () =>
                {
                    try
                    {
                        while (true)
                        {
                            await Task.Delay(500, reporterToken);

                            var total = Volatile.Read(ref totalDirectories);

                            State.SetValue(state => state with
                            {
                                Directories = total > 0 ? total : Volatile.Read(ref enumeratedDirectories),
                                ScannedDirectories = Volatile.Read(ref current),
                                FillProgress = total > 0 ? Volatile.Read(ref current) / (double)total : 0,
                                Files = Volatile.Read(ref found),
                            });
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        // expected when the scan completes or is cancelled
                    }
                });

                // enumerate subdirectories recursively, streaming into the discovery counter so the
                // reporter can show progress while large trees are walked
                List<string> EnumerateSubdirectories(string root)
                {
                    var list = new List<string>();

                    try
                    {
                        foreach (var directory in System.IO.Directory.EnumerateDirectories(root, "*", new EnumerationOptions()
                        {
                            AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
                            IgnoreInaccessible = true,
                            RecurseSubdirectories = true,
                        }))
                        {
                            list.Add(directory);
                            Interlocked.Increment(ref enumeratedDirectories);
                        }
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Failed to scan share {Directory}: {Message}", root, ex.Message);
                    }

                    return list;
                }

                var isTargeted = targetDirectories != null;

                HashSet<string> unmaskedDirectories;

                if (isTargeted)
                {
                    // targeted scan: only enumerate the provided directories and their subdirectories
                    var targets = targetDirectories
                        .Where(td => Shares.Any(s => !s.IsExcluded && td.StartsWith(s.LocalPath)))
                        .ToList();

                    if (!targets.Any())
                    {
                        Log.Warning("Aborting targeted share scan; none of the requested directories are under a configured share.");
                        repository.UpdateScan(timestamp, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                        State.SetValue(state => state with { Filling = false, Faulted = false, Filled = true, FillProgress = 1 });
                        return;
                    }

                    Log.Information("Starting targeted shared file scan for {Count} director(ies)", targets.Count);
                    swSnapshot = sw.ElapsedMilliseconds;

                    unmaskedDirectories = targets
                        .SelectMany(td => EnumerateSubdirectories(td)
                            .Where(d => !filters.Any(f => f.IsMatch(d)))
                            .Append(td))
                        .Where(d => System.IO.Directory.Exists(d))
                        .Where(d => !filters.Any(f => f.IsMatch(d)))
                        .ToHashSet();

                    State.SetValue(state => state with { Directories = unmaskedDirectories.Count, ExcludedDirectories = 0 });
                    Log.Information("Found {Directories} directories to scan in {Elapsed}ms. Starting file scan.", unmaskedDirectories.Count, sw.ElapsedMilliseconds - swSnapshot);
                }
                else
                {
                    // full scan: enumerate all configured shares
                    foreach (var share in Shares)
                    {
                        Log.Debug(share.ToJson());
                    }

                    Shares.Where(s => !s.IsExcluded).ToList()
                        .ForEach(s => Log.Information("Sharing {Local} as {Remote}", s.LocalPath, s.RemotePath));

                    Shares.Where(s => s.IsExcluded).ToList()
                        .ForEach(s => Log.Information("Excluding {Local}", s.LocalPath));

                    Log.Information("Starting shared file scan");
                    swSnapshot = sw.ElapsedMilliseconds;

                    unmaskedDirectories = Shares
                        .SelectMany(share => EnumerateSubdirectories(share.LocalPath)
                            .Where(directory => !filters.Any(filter => filter.IsMatch(directory))))
                        .Concat(Shares.Select(share => share.LocalPath)) // include the shares themselves (enumeration returns only subdirectories)
                        .Where(share => System.IO.Directory.Exists(share)) // discard any directories that don't exist.  we already warned about them.
                        .ToHashSet(); // remove duplicates (in case shares overlap)

                    var excludedDirectories = unmaskedDirectories
                        .Where(share => Shares.Where(share => share.IsExcluded).Any(exclusion => share.StartsWith(exclusion.LocalPath)));

                    unmaskedDirectories = unmaskedDirectories.Except(excludedDirectories).ToHashSet();

                    State.SetValue(state => state with { Directories = unmaskedDirectories.Count, ExcludedDirectories = excludedDirectories.Count() });
                    Log.Information("Found {Directories} shared directories (and {Excluded} were excluded) in {Elapsed}ms.  Starting file scan.", unmaskedDirectories.Count, excludedDirectories.Count(), sw.ElapsedMilliseconds - swSnapshot);
                }

                Volatile.Write(ref totalDirectories, unmaskedDirectories.Count);
                swSnapshot = sw.ElapsedMilliseconds;

                // set up a channel to fan out for directory scanning
                var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(1000)
                {
                    AllowSynchronousContinuations = false,
                    FullMode = BoundedChannelFullMode.Wait,
                    SingleReader = false,
                    SingleWriter = true,
                });

                // create workers to perform the fan out
                var workers = new List<ChannelReader<string>>();

                foreach (var id in Enumerable.Range(0, WorkerCount))
                {
                    workers.Add(new ChannelReader<string>(
                        channel: channel,
                        cancellationToken: cancellationToken,
                        handler: (directory) =>
                        {
                            Log.Debug("Starting scan of {Directory} ({Current}/{Total})", directory, current + 1, unmaskedDirectories.Count);

                            var share = Shares.First(share => directory.StartsWith(share.LocalPath));
                            var maskedDirectory = directory.ReplaceFirst(share.LocalPath, share.RemotePath).NormalizePathForSoulseek();

                            var upserts = new List<ShareFileUpsert>();
                            var touched = new List<string>();

                            try
                            {
                                // enumerate files in this directory only (no subdirectories) exclude hidden and system files and anything
                                // that can't be accessed due to security restrictions
                                var newFiles = System.IO.Directory.GetFiles(directory, "*", new EnumerationOptions()
                                {
                                    AttributesToSkip = FileAttributes.Hidden | FileAttributes.System,
                                    IgnoreInaccessible = true,
                                    RecurseSubdirectories = false,
                                });

                                // fetch what the cache already holds for this directory; files whose size and mtime are
                                // unchanged are reused without re-reading their tags, which is the bulk of the cost of a scan
                                var cachedFiles = repository.ListDirectoryFiles(maskedDirectory);

                                foreach (var originalFilename in newFiles)
                                {
                                    if (filters.Any(filter => filter.IsMatch(originalFilename)))
                                    {
                                        Interlocked.Increment(ref filtered);
                                        continue;
                                    }

                                    var maskedFilename = originalFilename.ReplaceFirst(share.LocalPath, share.RemotePath).NormalizePathForSoulseek();
                                    var info = Files.ResolveFileInfo(originalFilename);

                                    if (cachedFiles.TryGetValue(maskedFilename, out var cachedFile)
                                        && cachedFile.OriginalFilename == originalFilename
                                        && cachedFile.Size == info.Length
                                        && cachedFile.TouchedAt == info.LastWriteTimeUtc)
                                    {
                                        touched.Add(maskedFilename);
                                        Interlocked.Increment(ref reused);
                                    }
                                    else
                                    {
                                        var (file, tags) = SoulseekFileFactory.Create(originalFilename, maskedFilename, size: info.Length);
                                        upserts.Add(new ShareFileUpsert(maskedFilename, originalFilename, info.LastWriteTimeUtc, file, tags));
                                    }

                                    Interlocked.Increment(ref found);
                                }
                            }
                            catch (Exception ex)
                            {
                                Log.Debug("Failed to scan files in directory {Directory}: {Exception}", directory, ex);
                                Log.Warning("Failed to scan files in directory {Directory}: {Message}", directory, ex.Message);
                            }

                            // persist whatever was gathered (possibly nothing) in a single transaction, recording
                            // the directory itself so it survives the post-scan prune
                            repository.UpsertDirectoryContents(maskedDirectory, timestamp, upserts, touched);

                            Interlocked.Increment(ref current);

                            Log.Debug("Finished scanning {Directory}: {Added} files added or updated and {Reused} reused", directory, upserts.Count, touched.Count);
                        }));
                }

                Log.Debug("Starting workers...");
                workers.ForEach(w => w.Start());
                Log.Debug("All workers started");

                try
                {
                    try
                    {
                        Log.Debug("Filling DirectoryChannel...");
                        foreach (var directory in unmaskedDirectories)
                        {
                            await channel.Writer.WriteAsync(directory, cancellationToken);
                        }

                        Log.Debug("DirectoryChannel filled");
                    }
                    catch (OperationCanceledException)
                    {
                        Log.Warning("Shared file scan cancellation requested");
                        Log.Debug("DirectoryChannel fill aborted");
                    }
                    finally
                    {
                        channel.Writer.Complete();
                    }

                    Log.Debug("Waiting for workers to finish working...");
                    await Task.WhenAll(workers.Select(w => w.Completed));
                    Log.Debug("All workers finished");

                    Log.Information("Scan found {Files} files ({Reused} reused from cache, {Filtered} filtered) in {Elapsed}ms", found, reused, filtered, sw.ElapsedMilliseconds - swSnapshot);
                    swSnapshot = sw.ElapsedMilliseconds;

                    // Materialise virtual directories (e.g. shared mixtapes) with the scan timestamp, before the
                    // prune, so they persist without any files existing on disk at the masked paths.
                    if (virtualDirectories != null)
                    {
                        var virtualCount = 0;
                        foreach (var virtualDirectory in virtualDirectories)
                        {
                            MaterializeVirtualDirectory(virtualDirectory, timestamp, repository);
                            virtualCount++;
                        }

                        if (virtualCount > 0)
                        {
                            Log.Information("Materialised {Count} virtual director(ies) into the share cache", virtualCount);
                        }
                    }

                    if (!isTargeted)
                    {
                        // targeted scans only add/update files; full scans prune stale records
                        var deletedFiles = repository.PruneFiles(olderThanTimestamp: timestamp);
                        var deletedDirectories = repository.PruneDirectories(olderThanTimestamp: timestamp);

                        Log.Information("Removed or renamed {Files} files and {Directories} directories in {Elapsed}ms", deletedFiles, deletedDirectories, sw.ElapsedMilliseconds - swSnapshot);
                    }

                    Log.Information("Rebuilding filename index...");
                    repository.RebuildFilenameIndex();
                    Log.Information("Filename index rebuild complete");

                    Log.Debug("Vacuuming...");
                    repository.Vacuum();
                    Log.Debug("Vacuumed successfully");
                }
                catch (OperationCanceledException)
                {
                    // important! don't try to delete stale files in this case; unscanned records will have a stale timestamp
                    Log.Warning("Shared file scan cancelled successfully");

                    State.SetValue(state => state with { Cancelled = true });
                }

                // stop the reporter before applying final state, so a late tick can't overwrite it
                reporterCts.Cancel();
                await reporter;

                repository.UpdateScan(timestamp, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

                var directoryCount = repository.CountDirectories();
                var fileCount = repository.CountFiles();

                State.SetValue(state => state with
                {
                    Filling = false,
                    Faulted = false,
                    Filled = true,
                    FillProgress = 1,
                    Directories = directoryCount,
                    ScannedDirectories = directoryCount,
                    Files = fileCount,
                });

                Log.Debug($"Shared file cache created or updated in {sw.ElapsedMilliseconds}ms.  Directories: {directoryCount}, Files: {fileCount}");
            }
            catch (Exception ex)
            {
                reporterCts?.Cancel();
                State.SetValue(state => state with { Filling = false, Faulted = true, Filled = false, FillProgress = 0 });
                Log.Warning(ex, "Encountered error during scan of shared files: {Message}", ex.Message);
                throw;
            }
            finally
            {
                reporterCts?.Cancel();
                reporterCts?.Dispose();
                CancellationTokenSource = null;
                SyncRoot.Release();
            }
        }

        /// <inheritdoc/>
        public void MaterializeVirtualDirectory(VirtualShareDirectory directory, long timestamp, IShareRepository repository)
        {
            if (directory is null || directory.Files is null)
            {
                return;
            }

            var upserts = new List<ShareFileUpsert>();

            foreach (var virtualFile in directory.Files)
            {
                FileInfo info;
                try
                {
                    info = Files.ResolveFileInfo(virtualFile.OriginalFilename);
                }
                catch (Exception ex)
                {
                    Log.Warning("Skipping virtual share entry {Masked}: {Message}", virtualFile.MaskedFilename, ex.Message);
                    continue;
                }

                if (info is null || !info.Exists)
                {
                    Log.Warning("Skipping virtual share entry {Masked}; source file not found: {Original}", virtualFile.MaskedFilename, virtualFile.OriginalFilename);
                    continue;
                }

                var (file, tags) = SoulseekFileFactory.Create(virtualFile.OriginalFilename, virtualFile.MaskedFilename, size: info.Length);
                upserts.Add(new ShareFileUpsert(virtualFile.MaskedFilename, virtualFile.OriginalFilename, info.LastWriteTimeUtc, file, tags));
            }

            repository.UpsertDirectoryContents(directory.MaskedDirectory, timestamp, upserts, touchedFilenames: Array.Empty<string>());
        }

        /// <summary>
        ///     Cancels the currently running fill operation, if one is running.
        /// </summary>
        /// <returns>A value indicating whether a fill operation was cancelled.</returns>
        public bool TryCancelScan()
        {
            if (CancellationTokenSource != null)
            {
                CancellationTokenSource.Cancel();
                return true;
            }

            return false;
        }
    }
}
