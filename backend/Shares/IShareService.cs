// <copyright file="IShareService.cs" company="JP Dillingham">
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

namespace resonance.Shares
{
    using System.Collections.Generic;
    using System.Threading.Tasks;
    using Soulseek;

    /// <summary>
    ///     Provides control and interactions with configured shares and shared files.
    /// </summary>
    public interface IShareService
    {
        /// <summary>
        ///     Gets the list of share hosts.
        /// </summary>
        IReadOnlyList<Host> Hosts { get; }

        /// <summary>
        ///     Gets the local share host.
        /// </summary>
        Host LocalHost { get; }

        /// <summary>
        ///     Gets the state monitor for the service.
        /// </summary>
        IStateMonitor<ShareState> StateMonitor { get; }

        /// <summary>
        ///     Adds a new, or updates an existing, share host.
        /// </summary>
        /// <param name="host">The host to add or update.</param>
        void AddOrUpdateHost(Host host);

        /// <summary>
        ///     Registers a system-managed share that appears alongside user-configured shares.
        ///     The share is greyed out in the UI and cannot be removed by the user.
        ///     When <paramref name="isExcluded"/> is true the path is excluded from shares instead.
        /// </summary>
        void SetManagedShare(string localPath, string alias, bool isExcluded = false);

        /// <summary>
        ///     Removes a previously registered system-managed share.
        /// </summary>
        void RemoveManagedShare(string localPath);

        /// <summary>
        ///     Returns the entire contents of the share, split into public and locked directories.
        /// </summary>
        /// <returns>A tuple of public and locked directories.</returns>
        Task<(IEnumerable<Directory> Directories, IEnumerable<Directory> LockedDirectories)> BrowseAsync(Share share = null);

        /// <summary>
        ///     Returns a value indicating whether the specified masked filename belongs to a locked share.
        /// </summary>
        /// <param name="maskedFilename">The masked (remote) filename.</param>
        /// <returns>True if the file is in a locked share.</returns>
        bool IsFileLocked(string maskedFilename);

        /// <summary>
        ///     Returns the count of files in the local share grouped by extension.
        /// </summary>
        /// <returns>A dictionary mapping extension to file count.</returns>
        IReadOnlyDictionary<string, int> GetFileTypeCounts();

        /// <summary>
        ///     Returns tag metadata for all files that have ID3/tag data.
        /// </summary>
        /// <returns>A dictionary mapping masked filename to tag metadata.</returns>
        IReadOnlyDictionary<string, FileTags> GetAllTags();

        /// <summary>
        ///     Returns a list of files in the local share that have tag data.
        /// </summary>
        /// <returns>The list of tagged files.</returns>
        IEnumerable<TaggedFile> GetTaggedFiles();

        /// <summary>
        ///     Returns a list of files in the local share that have no tag data.
        /// </summary>
        /// <returns>The list of untagged files.</returns>
        IEnumerable<UntaggedFile> GetUntaggedFiles();

        /// <summary>
        ///     Writes tag data to the specified file and updates the share cache.
        /// </summary>
        /// <param name="maskedFilename">The masked filename identifying the file.</param>
        /// <param name="tags">The tag data to write.</param>
        void WriteFileTags(string maskedFilename, FileTags tags);

        /// <summary>
        ///     Renames a directory on the filesystem and updates the share cache.
        /// </summary>
        /// <param name="maskedDirectory">The current masked directory path.</param>
        /// <param name="newLeafName">The new name for the last path segment of the directory.</param>
        void RenameDirectory(string maskedDirectory, string newLeafName);

        /// <summary>
        ///     Dumps the local share cache to a file.
        /// </summary>
        /// <param name="filename">The destination file.</param>
        /// <returns>The operation context.</returns>
        Task DumpAsync(string filename);

        /// <summary>
        ///     Initializes the service and shares.
        /// </summary>
        /// <param name="forceRescan">A value indicating whether a full re-scan of shares should be performed.</param>
        /// <returns>The operation context.</returns>
        Task InitializeAsync(bool forceRescan = false);

        /// <summary>
        ///     Returns the contents of the specified <paramref name="directory"/>.
        /// </summary>
        /// <param name="directory">The directory for which the contents are to be listed.</param>
        /// <returns>The contents of the directory.</returns>
        Task<Directory> ListDirectoryAsync(string directory);

        /// <summary>
        ///     Returns the list of all <see cref="Scan"/>  started at or after the specified <paramref name="startedAtOrAfter"/>
        ///     unix timestamp.
        /// </summary>
        /// <param name="startedAtOrAfter">A unix timestamp that serves as the lower bound of the time-based listing.</param>
        /// <returns>The operation context, including the list of found scans.</returns>
        Task<IEnumerable<Scan>> ListScansAsync(long startedAtOrAfter = 0);

        /// <summary>
        ///     Requests that a share scan is performed.
        /// </summary>
        void RequestScan();

        /// <summary>
        ///     Resolves the local filename and size of the specified <paramref name="remoteFilename"/>, if the mask is associated with a
        ///     configured share.
        /// </summary>
        /// <param name="remoteFilename">The fully qualified filename to resolve.</param>
        /// <returns>The resolved host and filename.</returns>
        /// <exception cref="NotFoundException">
        ///     Thrown when the specified remote filename can not be associated with a configured share.
        /// </exception>
        Task<(string Host, string Filename, long Size)> ResolveFileAsync(string remoteFilename);

        /// <summary>
        ///     Removes all share cache entries (files and directories) whose original path matches the
        ///     specified local path prefix, without triggering a rescan.
        ///     Call this after a file/folder rename or deletion to keep the share index in sync.
        /// </summary>
        /// <param name="localPath">The local filesystem path (file or directory) to remove.</param>
        void RemoveLocalPath(string localPath);

        /// <summary>
        ///     Scans the configured shares on the local host.
        /// </summary>
        /// <returns>The operation context.</returns>
        /// <exception cref="ShareScanInProgressException">Thrown when a scan is already in progress.</exception>
        Task ScanAsync();

        /// <summary>
        ///     Scans only the specified local directories, adding or updating their entries in the share cache.
        ///     Stale records in unscanned directories are left untouched; use <see cref="ScanAsync"/> for full cleanup.
        /// </summary>
        /// <param name="localPaths">The local filesystem paths to scan.</param>
        /// <returns>The operation context.</returns>
        /// <exception cref="ShareScanInProgressException">Thrown when a scan is already in progress.</exception>
        Task ScanDirectoriesAsync(IEnumerable<string> localPaths);

        /// <summary>
        ///     Searches the cache for the specified <paramref name="query"/> and returns the matching files.
        /// </summary>
        /// <param name="query">The query for which to search.</param>
        /// <param name="limit">An optional row limit.</param>
        /// <returns>The matching files.</returns>
        Task<IEnumerable<File>> SearchAsync(SearchQuery query, int? limit = null);

        /// <summary>
        ///     Cancels the currently running scan on the local host, if one is running.
        /// </summary>
        /// <returns>A value indicating whether a scan was cancelled.</returns>
        bool TryCancelScan();

        /// <summary>
        ///     Returns the share host with the specified <paramref name="name"/>.
        /// </summary>
        /// <param name="name">The name of the host.</param>
        /// <param name="host">The host, if found.</param>
        /// <returns>A value indicating whether the host was found.</returns>
        bool TryGetHost(string name, out Host host);

        /// <summary>
        ///     Removes the share host with the specified <paramref name="name"/>.
        /// </summary>
        /// <param name="name">The name of the host.</param>
        /// <returns>A value indicating whether the host was removed.</returns>
        bool TryRemoveHost(string name);
    }
}