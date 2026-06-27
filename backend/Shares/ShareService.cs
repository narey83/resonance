// <copyright file="ShareService.cs" company="JP Dillingham">
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

using Microsoft.Extensions.Options;

namespace resonance.Shares
{
    using System;
    using System.Collections.Concurrent;
    using System.Collections.Generic;
    using System.Linq;
    using System.Threading;
    using System.Threading.Tasks;
    using resonance.Common;
    using resonance.Files;
    using resonance.Relay;
    using Serilog;
    using Soulseek;

    /// <summary>
    ///     Provides control and interactions with configured shares and shared files.
    /// </summary>
    public class ShareService : IShareService
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="ShareService"/> class.
        /// </summary>
        /// <param name="fileService"></param>
        /// <param name="shareRepositoryFactory"></param>
        /// <param name="optionsMonitor"></param>
        /// <param name="musicLibrary"></param>
        /// <param name="scanner"></param>
        public ShareService(
            FileService fileService,
            IShareRepositoryFactory shareRepositoryFactory,
            IOptionsMonitor<Options> optionsMonitor,
            resonance.MusicLibrary.IMusicLibraryService musicLibrary = null,
            IShareScanner scanner = null)
        {
            var options = optionsMonitor.CurrentValue;

            ShareRepositoryFactory = shareRepositoryFactory;

            var host = new Host(Program.LocalHostName);
            var repository = ShareRepositoryFactory.CreateFromHost(host.Name);

            Local = (host, repository);

            AllRepositories = [repository];

            MusicLibrary = musicLibrary;

            Scanner = scanner ?? new ShareScanner(
                workerCount: options.Shares.Cache.Workers,
                fileService: fileService);

            Scanner.StateMonitor.OnChange(cacheState =>
            {
                var (previous, current) = cacheState;

                State.SetValue(state => state with
                {
                    // scan is pending if faulted, or if state DIDN'T just transition from filling to not filling AND a scan was already pending
                    ScanPending = current.Faulted || current.Cancelled || (!(previous.Filling && !current.Filling) && state.ScanPending),
                    Scanning = current.Filling,
                    Faulted = current.Faulted,
                    Cancelled = current.Cancelled,
                    ScanProgress = current.FillProgress,
                    Directories = current.Directories,
                    ScannedDirectories = current.ScannedDirectories,
                    Files = current.Files,
                });
            });

            OptionsMonitor = optionsMonitor;
            OptionsMonitor.OnChange(options => Configure(options));

            StateMonitor = State;

            Configure(OptionsMonitor.CurrentValue);
        }

        /// <summary>
        ///     Gets the list of share hosts.
        /// </summary>
        public IReadOnlyList<Host> Hosts => HostDictionary.Values.Select(v => v.Host).Prepend(Local.Host).ToList().AsReadOnly();

        /// <summary>
        ///     Gets the local share host.
        /// </summary>
        public Host LocalHost => Local.Host;

        /// <summary>
        ///     Gets the state monitor for the service.
        /// </summary>
        public IStateMonitor<ShareState> StateMonitor { get; }

        private resonance.MusicLibrary.IMusicLibraryService MusicLibrary { get; }
        private IShareRepositoryFactory ShareRepositoryFactory { get; }
        private IShareScanner Scanner { get; }
        private SemaphoreSlim ScannerSyncRoot { get; } = new SemaphoreSlim(1, 1);
        private string LastOptionsHash { get; set; }
        private IOptionsMonitor<Options> OptionsMonitor { get; }
        private ConcurrentDictionary<string, (Host Host, IShareRepository Repository)> HostDictionary { get; set; } = new();
        private IManagedState<ShareState> State { get; } = new ManagedState<ShareState>();
        private SemaphoreSlim SyncRoot { get; } = new SemaphoreSlim(1, 1);
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Shares.Service);
        private (Host Host, IShareRepository Repository) Local { get; set; }
        private IReadOnlyList<IShareRepository> AllRepositories { get; set; }
        private ConcurrentDictionary<string, Share> ManagedShares { get; } = new();

        /// <summary>
        ///     Adds a new, or updates an existing, share host.
        /// </summary>
        /// <param name="host">The host to add or update.</param>
        public void AddOrUpdateHost(Host host)
        {
            // we assume that if this method is called that the caller has verified that the
            // file for the host exists and is valid.
            HostDictionary.AddOrUpdate(
                key: host.Name,
                addValueFactory: (key) => (host, ShareRepositoryFactory.CreateFromHost(host.Name)),
                updateValueFactory: (_, existing) => (host, existing.Repository));

            AllRepositories = HostDictionary.Values
                .Select(value => value.Repository)
                .Prepend(Local.Repository)
                .ToList()
                .AsReadOnly();

            State.SetValue(state => state with
            {
                Hosts = Hosts.Select(host => host.Name).ToArray(),
                Directories = Hosts.SelectMany(host => host.Shares).Sum(share => share.Directories ?? 0),
                Files = Hosts.SelectMany(host => host.Shares).Sum(share => share.Files ?? 0),
            });
        }

        /// <summary>
        ///     Returns the count of files in the local share grouped by extension.
        /// </summary>
        /// <returns></returns>
        public IReadOnlyDictionary<string, int> GetFileTypeCounts()
        {
            return Local.Repository.GetFileTypeCounts();
        }

        /// <summary>
        ///     Returns tag metadata for all files that have ID3/tag data.
        /// </summary>
        /// <returns></returns>
        public IReadOnlyDictionary<string, FileTags> GetAllTags()
        {
            return AllRepositories
                .SelectMany(r => r.ListTags())
                .GroupBy(t => t.MaskedFilename)
                .ToDictionary(g => g.Key, g => g.First().Tags);
        }

        /// <summary>
        ///     Returns a list of files in the local share that have tag data.
        /// </summary>
        /// <returns></returns>
        public IEnumerable<TaggedFile> GetTaggedFiles()
        {
            return Local.Repository.ListTaggedFiles().Select(f =>
            {
                var sep = f.MaskedFilename.LastIndexOf('\\');
                var dir = sep >= 0 ? f.MaskedFilename[..sep] : string.Empty;
                var filename = sep >= 0 ? f.MaskedFilename[(sep + 1)..] : f.MaskedFilename;
                var ext = System.IO.Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
                return new TaggedFile(f.MaskedFilename, f.OriginalFilename, dir, filename, ext, f.Tags);
            });
        }

        /// <summary>
        ///     Returns a list of files in the local share that have no tag data.
        /// </summary>
        /// <returns></returns>
        public IEnumerable<UntaggedFile> GetUntaggedFiles()
        {
            return Local.Repository.ListUntaggedFiles().Select(f =>
            {
                var sep = f.MaskedFilename.LastIndexOf('\\');
                var dir = sep >= 0 ? f.MaskedFilename[..sep] : string.Empty;
                var filename = sep >= 0 ? f.MaskedFilename[(sep + 1)..] : f.MaskedFilename;
                var ext = System.IO.Path.GetExtension(filename).TrimStart('.').ToLowerInvariant();
                return new UntaggedFile(f.MaskedFilename, f.OriginalFilename, dir, filename, ext);
            });
        }

        /// <summary>
        ///     Returns tagged files whose metadata is incomplete (missing a core field).
        /// </summary>
        /// <returns></returns>
        public IEnumerable<TaggedFile> GetIncompleteFiles()
        {
            return GetTaggedFiles().Where(f => IsIncomplete(f.Tags));
        }

        // The tag editor's "incomplete" bar: title and artist are the only mandatory fields;
        // album/year/genre are optional here. (The online lookup still tries to fill those
        // separately — see MetadataLookup.NeedsEnrichment — this is just the manual-fix list.)
        private static bool IsIncomplete(FileTags tags)
        {
            if (tags == null)
            {
                return true;
            }

            return string.IsNullOrWhiteSpace(tags.Title)
                || string.IsNullOrWhiteSpace(tags.Artist);
        }

        /// <summary>
        ///     Writes tag data to the specified file on disk and updates the share cache.
        /// </summary>
        public void WriteFileTags(string maskedFilename, FileTags tags)
        {
            var (originalFilename, _) = Local.Repository.FindFileInfo(maskedFilename);
            if (originalFilename == null)
            {
                throw new NotFoundException($"File '{maskedFilename}' not found in share cache");
            }

            // Serialize against every other tag writer (metadata/bpm/key passes, sanitization)
            // touching this same file — concurrent TagLib opens risk a torn write.
            using var fileLock = FileWriteLock.Acquire(originalFilename);

            TagLib.File tagFile = null;
            try
            {
                tagFile = TagLib.File.Create(originalFilename);
                tagFile.Tag.Performers = string.IsNullOrWhiteSpace(tags.Artist) ? [] : [tags.Artist];
                tagFile.Tag.AlbumArtists = string.IsNullOrWhiteSpace(tags.AlbumArtist) ? [] : [tags.AlbumArtist];
                tagFile.Tag.Album = tags.Album ?? string.Empty;
                tagFile.Tag.Title = tags.Title ?? string.Empty;
                tagFile.Tag.Track = tags.TrackNumber;
                tagFile.Tag.Disc = tags.DiscNumber;
                tagFile.Tag.Year = tags.Year;
                tagFile.Tag.Genres = string.IsNullOrWhiteSpace(tags.Genre) ? [] : [tags.Genre];
                tagFile.Tag.BeatsPerMinute = tags.Bpm;
                tagFile.Tag.Comment = tags.Comment ?? string.Empty;

                // Enforce ID3v2.3 for MP3 files (set before key write which also sets v3)
                if (tagFile.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2Enforce)
                {
                    id3v2Enforce.Version = 3;
                }

                // write/clear musical key: ID3v2 uses KeyTagHelper (forces v2.3 + UTF-16,
                // writes TKEY only, removes legacy TXXX:KEY and COMM key frames);
                // Xiph uses INITIALKEY directly
                if (tags.Key != null)
                {
                    if (tagFile.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2Write)
                    {
                        KeyAnalysis.KeyTagHelper.WriteKey(id3v2Write, tags.Key);
                    }
                    else if (tagFile.GetTag(TagLib.TagTypes.Xiph, true) is TagLib.Ogg.XiphComment xiphWrite)
                    {
                        xiphWrite.SetField("INITIALKEY", tags.Key);
                    }
                }
                else
                {
                    if (tagFile.GetTag(TagLib.TagTypes.Id3v2) is TagLib.Id3v2.Tag id3v2Clear)
                    {
                        KeyAnalysis.KeyTagHelper.ClearKey(id3v2Clear);
                    }
                    else if (tagFile.GetTag(TagLib.TagTypes.Xiph) is TagLib.Ogg.XiphComment xiphClear)
                    {
                        xiphClear.RemoveField("INITIALKEY");
                    }
                }

                // Match tag sanitization: leave a single clean tag rather than letting the legacy
                // ID3v1 block or a non-standard APEv2 block linger alongside the ID3v2.3 tag we wrote.
                // (TagSanitization's TagConsolidator strips these; without it a lookup write would
                // re-introduce the duplicate blocks it had just removed.)
                tagFile.RemoveTags(TagLib.TagTypes.Id3v1 | TagLib.TagTypes.Ape);

                tagFile.Save();
            }
            finally
            {
                tagFile?.Dispose();
            }

            Local.Repository.UpdateFileTags(maskedFilename, tags);
            MusicLibrary?.TriggerSync();
        }

        /// <summary>
        ///     Renames a directory on the filesystem and updates the share cache.
        /// </summary>
        public void RemoveLocalPath(string localPath)
        {
            var share = Local.Host.Shares
                .FirstOrDefault(s => !s.IsExcluded && localPath.StartsWith(s.LocalPath, StringComparison.OrdinalIgnoreCase));

            if (share == null)
            {
                Log.Warning("Cannot remove share entries for '{Path}': not under any configured share", localPath);
                return;
            }

            var maskedPath = localPath.ReplaceFirst(share.LocalPath, share.RemotePath).NormalizePathForSoulseek();
            Local.Repository.DeleteEntriesByPaths(localPath, maskedPath);

            // Push updated counts through the state monitor so ShareState_OnChange fires and
            // ApplicationHub broadcasts the new state to all connected frontend/mobile clients.
            State.SetValue(state => state with
            {
                Directories = Local.Repository.CountDirectories(),
                Files = Local.Repository.CountFiles(),
            });
        }

        public void RenameDirectory(string maskedDirectory, string newLeafName)
        {
            var originalDirectory = Local.Repository.GetDirectoryOriginalPath(maskedDirectory);
            if (originalDirectory == null)
            {
                throw new NotFoundException($"Directory '{maskedDirectory}' not found in share cache");
            }

            var parentOriginal = System.IO.Path.GetDirectoryName(originalDirectory);
            var newOriginalDirectory = System.IO.Path.Combine(parentOriginal, newLeafName);

            var lastBackslash = maskedDirectory.LastIndexOf('\\');
            var parentMasked = lastBackslash >= 0 ? maskedDirectory[..lastBackslash] : string.Empty;
            var newMaskedDirectory = parentMasked.Length > 0
                ? parentMasked + '\\' + newLeafName
                : newLeafName;

            System.IO.Directory.Move(originalDirectory, newOriginalDirectory);

            try
            {
                Local.Repository.RenameDirectory(maskedDirectory, newMaskedDirectory, originalDirectory, newOriginalDirectory);
            }
            catch
            {
                // Roll back filesystem move if the DB update fails
                System.IO.Directory.Move(newOriginalDirectory, originalDirectory);
                throw;
            }

            Local.Repository.FlagLatestScanAsSuspect();
        }

        /// <summary>
        ///     Returns the entire contents of the share, split into public and locked directories.
        /// </summary>
        /// <returns>A tuple of public and locked directories.</returns>
        public Task<(IEnumerable<Directory> Directories, IEnumerable<Directory> LockedDirectories)> BrowseAsync(Share share = null)
        {
            var directories = new ConcurrentDictionary<string, Directory>();

            string prefix = null;

            if (share != null)
            {
                prefix = share.RemotePath + (share.RemotePath.EndsWith('\\') ? string.Empty : '\\');
            }

            // snapshot the current list of repositories
            var repositories = AllRepositories.ToList();

            // Soulseek requires that each directory in the tree have an entry in the list returned in a browse response. if
            // missing, files that are nested within directories which contain only directories (no files) are displayed as being
            // in the root. to get around this, prime a dictionary with all known directories, and an empty Soulseek.Directory. if
            // there are any files in the directory, this entry will be overwritten with a new Soulseek.Directory containing the
            // files. if not they'll be left as is.
            foreach (var directory in repositories.SelectMany(r => r.ListDirectories(prefix)))
            {
                directories.TryAdd(directory, new Directory(directory));
            }

            var files = repositories.SelectMany(r => r.ListFiles(prefix, includeFullPath: true));

            var groups = files
                .GroupBy(file => file.Filename.GetNormalizedDirectoryName())
                .Select(group => new Directory(group.Key, group.Select(f =>
                {
                    return new File(
                        f.Code,
                        f.Filename.GetNormalizedFileName(), // we can send the full path, or just the filename.  save bandwidth and omit the path.
                        f.Size,
                        f.Extension,
                        f.Attributes);
                }).OrderBy(f => f.Filename)));

            // merge the dictionary containing all directories with the Soulseek.Directory instances containing their files.
            // entries with no files will remain untouched.
            foreach (var group in groups)
            {
                directories.AddOrUpdate(group.Name, group, (_, _) => group);
            }

            var lockedSharePaths = Local.Host.Shares
                .Where(s => !s.IsExcluded && s.IsLocked)
                .Select(s => s.RemotePath)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            bool IsLockedDirectory(string dirName) => lockedSharePaths.Any(path =>
                dirName.Equals(path, StringComparison.OrdinalIgnoreCase) ||
                dirName.StartsWith(path + "\\", StringComparison.OrdinalIgnoreCase));

            var lockedDirs = directories.Values.Where(d => IsLockedDirectory(d.Name)).ToList();
            var publicDirs = directories.Values.Where(d => !IsLockedDirectory(d.Name)).ToList();

            return Task.FromResult(((IEnumerable<Directory>)publicDirs, (IEnumerable<Directory>)lockedDirs));
        }

        /// <summary>
        ///     Returns a value indicating whether the specified masked filename belongs to a locked share.
        /// </summary>
        /// <param name="maskedFilename">The masked (remote) filename.</param>
        /// <returns>True if the file is in a locked share.</returns>
        public bool IsFileLocked(string maskedFilename)
        {
            return Local.Host.Shares
                .Where(s => !s.IsExcluded && s.IsLocked)
                .Any(share => maskedFilename.StartsWith(share.RemotePath + "\\", StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>
        ///     Dumps the local share cache to a file.
        /// </summary>
        /// <param name="filename">The destination file.</param>
        /// <returns>The operation context.</returns>
        public Task DumpAsync(string filename)
        {
            Local.Repository.DumpTo(filename);
            return Task.CompletedTask;
        }

        /// <summary>
        ///     Returns the share host with the specified <paramref name="name"/>.
        /// </summary>
        /// <param name="name">The name of the host.</param>
        /// <param name="host">The host, if found.</param>
        /// <returns>A value indicating whether the host was found.</returns>
        public bool TryGetHost(string name, out Host host)
        {
            if (HostDictionary.TryGetValue(name, out var record))
            {
                host = record.Host;
                return true;
            }

            host = null;
            return false;
        }

        /// <summary>
        ///     Removes the share host with the specified <paramref name="name"/>.
        /// </summary>
        /// <param name="name">The name of the host.</param>
        /// <returns>A value indicating whether the host was removed.</returns>
        public bool TryRemoveHost(string name)
        {
            var removed = false;

            if (HostDictionary.TryRemove(name, out _))
            {
                removed = true;
            }

            AllRepositories = HostDictionary.Values
                .Select(value => value.Repository)
                .Prepend(Local.Repository)
                .ToList()
                .AsReadOnly();

            State.SetValue(state => state with
            {
                Hosts = Hosts.Select(host => host.Name).ToArray(),
                Directories = Hosts.SelectMany(host => host.Shares).Sum(share => share.Directories ?? 0),
                Files = Hosts.SelectMany(host => host.Shares).Sum(share => share.Files ?? 0),
            });

            return removed;
        }

        /// <summary>
        ///     Returns the contents of the specified <paramref name="directory"/>.
        /// </summary>
        /// <param name="directory">The directory for which the contents are to be listed.</param>
        /// <returns>The contents of the directory.</returns>
        public Task<Directory> ListDirectoryAsync(string directory)
        {
            var files = AllRepositories.SelectMany(r => r.ListFiles(directory));

            return Task.FromResult(new Directory(directory, files));
        }

        /// <summary>
        ///     Resolves the local filename of the specified <paramref name="remoteFilename"/>, if the mask is associated with a
        ///     configured share.
        /// </summary>
        /// <param name="remoteFilename">The fully qualified filename to resolve.</param>
        /// <returns>The resolved local filename.</returns>
        /// <exception cref="NotFoundException">
        ///     Thrown when the specified remote filename can not be associated with a configured share.
        /// </exception>
        public Task<(string Host, string Filename, long Size)> ResolveFileAsync(string remoteFilename)
        {
            var (resolvedFilename, size) = Local.Repository.FindFileInfo(remoteFilename);

            // when we're debugging the relay (running as both controller and agent on the same instance)
            // always resolve files from remote hosts, ignoring local. this is a crappy hack, but it is the
            // least crappy way to maintain sanity while trying to debug this feature.
            if (OptionsMonitor.CurrentValue.Relay.Mode.ToEnum<RelayMode>() == RelayMode.Debug)
            {
                Log.Warning("Ignoring resolved local file to facilitate Relay debugging.");
            }
            else if (!string.IsNullOrEmpty(resolvedFilename))
            {
                Log.Debug("Resolved remote file to {ResolvedFilename} on local host", resolvedFilename);
                return Task.FromResult((Program.LocalHostName, resolvedFilename, size));
            }
            else
            {
                Log.Debug("Failed to resolve remote file on local host; searching remote hosts: {Hosts}", HostDictionary.Values.Select(h => h.Host.Name));
            }

            // file not found locally.  begin searching other hosts one by one.
            // this is the slow, dumb way to do this, but it's plenty fast in this context.
            foreach (var host in HostDictionary.Values)
            {
                (resolvedFilename, size) = host.Repository.FindFileInfo(remoteFilename);

                if (!string.IsNullOrEmpty(resolvedFilename))
                {
                    Log.Debug("Resolved remote file to {ResolvedFilename} on host {Host}", remoteFilename, host.Host.Name);
                    return Task.FromResult((host.Host.Name, resolvedFilename, size));
                }

                Log.Debug("Failed to resolve remote file on host {Host}", host.Host.Name);
            }

            throw new NotFoundException($"The requested filename '{remoteFilename}' could not be resolved to a physical file");
        }

        /// <summary>
        ///     Returns the list of all <see cref="Scan"/>  started at or after the specified <paramref name="startedAtOrAfter"/>
        ///     unix timestamp.
        /// </summary>
        /// <remarks>
        ///     Note that this returns the scan history for local shares only.
        /// </remarks>
        /// <param name="startedAtOrAfter">A unix timestamp that serves as the lower bound of the time-based listing.</param>
        /// <returns>The operation context, including the list of found scans.</returns>
        public Task<IEnumerable<Scan>> ListScansAsync(long startedAtOrAfter = 0)
            => Task.FromResult(Local.Repository.ListScans(startedAtOrAfter));

        /// <summary>
        ///     Requests that a share scan is performed.
        /// </summary>
        public void RequestScan()
        {
            Local.Repository.FlagLatestScanAsSuspect();
            State.SetValue(state => state with { ScanPending = true });
        }

        /// <summary>
        ///     Searches the cache for the specified <paramref name="query"/> and returns the matching files.
        /// </summary>
        /// <param name="query">The query for which to search.</param>
        /// <param name="limit">An optional row limit.</param>
        /// <returns>The matching files.</returns>
        public Task<IEnumerable<File>> SearchAsync(SearchQuery query, int? limit = null)
        {
            var results = AllRepositories.SelectMany(r => r.Search(query, limit))
                .Where(f => !IsFileLocked(f.Filename));

            return Task.FromResult(results);
        }

        /// <summary>
        ///     Scans the configured shares.
        /// </summary>
        /// <returns>The operation context.</returns>
        /// <exception cref="ShareScanInProgressException">Thrown when a scan is already in progress.</exception>
        public async Task ScanAsync()
        {
            // try to obtain the semaphore, or fail if it has already been obtained
            // the scanner has an identical check, but because this method changes state we need it here, too
            if (!await ScannerSyncRoot.WaitAsync(millisecondsTimeout: 0))
            {
                Log.Warning("Shared file scan rejected; scan is already in progress.");
                throw new ShareScanInProgressException("Shared files are already being scanned.");
            }

            try
            {
                State.SetValue(state => state with { Ready = false });

                await Scanner.ScanAsync(Local.Host.Shares, OptionsMonitor.CurrentValue.Shares, Local.Repository);

                Log.Debug("Recomputing share statistics...");
                ComputeShareStatistics();
                Log.Debug("Share statistics updated: {Shares}", Local.Host.Shares.ToJson());

                State.SetValue(state => state with
                {
                    Directories = Hosts.SelectMany(host => host.Shares).Sum(share => share.Directories ?? 0),
                    Files = Hosts.SelectMany(host => host.Shares).Sum(share => share.Files ?? 0),
                    Ready = true,
                });
            }
            finally
            {
                ScannerSyncRoot.Release();
            }
        }

        /// <summary>
        ///     Scans only the specified local directories, adding or updating their entries in the share cache.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        public async Task ScanDirectoriesAsync(IEnumerable<string> localPaths)
        {
            if (!await ScannerSyncRoot.WaitAsync(millisecondsTimeout: 0))
            {
                Log.Warning("Shared file scan rejected; scan is already in progress.");
                throw new ShareScanInProgressException("Shared files are already being scanned.");
            }

            try
            {
                State.SetValue(state => state with { Ready = false });

                await Scanner.ScanAsync(Local.Host.Shares, OptionsMonitor.CurrentValue.Shares, Local.Repository, localPaths);

                Log.Debug("Recomputing share statistics after targeted scan...");
                ComputeShareStatistics();

                State.SetValue(state => state with
                {
                    Directories = Hosts.SelectMany(host => host.Shares).Sum(share => share.Directories ?? 0),
                    Files = Hosts.SelectMany(host => host.Shares).Sum(share => share.Files ?? 0),
                    Ready = true,
                });
            }
            finally
            {
                ScannerSyncRoot.Release();
            }
        }

        /// <summary>
        ///     Cancels the currently running scan, if one is running.
        /// </summary>
        /// <returns>A value indicating whether a scan was cancelled.</returns>
        public bool TryCancelScan()
        {
            return Scanner.TryCancelScan();
        }

        /// <summary>
        ///     Initializes the service and shares.
        /// </summary>
        /// <param name="forceRescan">A value indicating whether a full re-scan of shares should be performed.</param>
        /// <returns>The operation context.</returns>
        public async Task InitializeAsync(bool forceRescan = false)
        {
            Log.Information("Initializing shares");

            // _probably_ redundant, but to be safe
            State.SetValue(state => state with { Ready = false });

            try
            {
                if (forceRescan)
                {
                    Log.Warning("Performing a forced re-scan of shares");
                    await ScanAsync();
                }
                else if (!Local.Repository.TryValidate(out _))
                {
                    throw new ShareInitializationException("Share cache is missing or corrupt");
                }

                var options = OptionsMonitor.CurrentValue.Shares;
                var latestScan = Local.Repository.FindLatestScan();
                Log.Debug("Latest scan: {Scan}, current options {@Options}", latestScan, options);

                if (latestScan == default)
                {
                    throw new ShareInitializationException("Shares not yet scanned");
                }

                if (!latestScan.EndedAt.HasValue)
                {
                    throw new ShareInitializationException("Previous share scan did not complete");
                }

                if (latestScan.Suspect)
                {
                    throw new ShareInitializationException("Previous share scan was marked as suspect");
                }

                if (latestScan.OptionsJson != options.ToJson())
                {
                    throw new ShareInitializationException("Share options changed since previous scan");
                }

                Log.Debug("Recomputing share statistics...");
                ComputeShareStatistics();
                Log.Debug("Share statistics updated");

                State.SetValue(state => state with
                {
                    Scanning = false,
                    Faulted = false,
                    Ready = true,
                    ScanProgress = 1,
                    Hosts = Hosts.Select(host => host.Name).ToList().AsReadOnly(),
                    Directories = Hosts.SelectMany(host => host.Shares).Sum(share => share.Directories ?? 0),
                    Files = Hosts.SelectMany(host => host.Shares).Sum(share => share.Files ?? 0),
                });
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Error initializing shares: {Message}", ex.Message);

                if (!forceRescan)
                {
                    Log.Warning("Re-attempting initialization");
                    await InitializeAsync(forceRescan: true);
                }
                else
                {
                    Log.Error("Failed to initialize shares, and an attempt to force a full scan to repair failed");
                    throw;
                }
            }
        }

        private void ComputeShareStatistics()
        {
            foreach (var share in Local.Host.Shares)
            {
                var prefix = share.RemotePath + (share.RemotePath.EndsWith('\\') ? string.Empty : '\\');

                var dirs = Local.Repository.CountDirectories(prefix);
                var files = Local.Repository.CountFiles(prefix);

                share.UpdateStatistics(dirs, files);
            }
        }

        public void SetManagedShare(string localPath, string alias, bool isExcluded = false)
        {
            ManagedShares[localPath] = Share.CreateManaged(localPath, alias, isExcluded);
            RebuildSharesList(OptionsMonitor.CurrentValue);
        }

        public void RemoveManagedShare(string localPath)
        {
            if (ManagedShares.Remove(localPath, out _))
            {
                RebuildSharesList(OptionsMonitor.CurrentValue);
            }
        }

        private void Configure(Options options)
        {
            SyncRoot.Wait();

            try
            {
                var combinedHash = Compute.Sha1Hash(string.Join(';',
                    options.Shares.Directories.Concat(ManagedShares.Keys.OrderBy(k => k))));

                if (combinedHash == LastOptionsHash)
                {
                    return;
                }

                ApplySharesList(options);

                LastOptionsHash = combinedHash;
            }
            finally
            {
                SyncRoot.Release();
            }
        }

        private void RebuildSharesList(Options options)
        {
            SyncRoot.Wait();

            try
            {
                var combinedHash = Compute.Sha1Hash(string.Join(';',
                    options.Shares.Directories.Concat(ManagedShares.Keys.OrderBy(k => k))));

                ApplySharesList(options);

                LastOptionsHash = combinedHash;
            }
            finally
            {
                SyncRoot.Release();
            }
        }

        private void ApplySharesList(Options options)
        {
            var userShares = options.Shares.Directories
                .Select(share => share.TrimEnd('/', '\\'))
                .ToHashSet()
                .Select(share => new Share(share))
                .ToList();

            var allShares = userShares
                .Concat(ManagedShares.Values)
                .OrderByDescending(share => share.LocalPath.Length)
                .ToList();

            Local = (Local.Host with { Shares = allShares }, Local.Repository);
        }
    }
}
