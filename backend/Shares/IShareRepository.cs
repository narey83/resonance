// <copyright file="IShareRepository.cs" company="JP Dillingham">
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

namespace resonance.Shares
{
    using System;
    using System.Collections.Generic;
    using Soulseek;

    /// <summary>
    ///     A cached file record read from the shares database, used to detect unchanged files during a scan.
    /// </summary>
    public record CachedShareFile(string MaskedFilename, string OriginalFilename, long Size, DateTime? TouchedAt);

    /// <summary>
    ///     A scanned file pending insertion into the shares database.
    /// </summary>
    public record ShareFileUpsert(string MaskedFilename, string OriginalFilename, DateTime TouchedAt, File File, FileTags Tags);

    /// <summary>
    ///     Persistent storage of shared files and metadata.
    /// </summary>
    public interface IShareRepository : IDisposable
    {
        /// <summary>
        ///     Gets the connection string for this repository.
        /// </summary>
        string ConnectionString { get; }

        /// <summary>
        ///     Counts the number of directories in the database.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for counting subdirectories.</param>
        /// <returns>The number of directories.</returns>
        int CountDirectories(string parentDirectory = null);

        /// <summary>
        ///     Counts the number of files in the database.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for counting files in a subdirectory.</param>
        /// <returns>The number of files.</returns>
        int CountFiles(string parentDirectory = null);

        /// <summary>
        ///     Returns the count of files grouped by extension.
        /// </summary>
        /// <returns>A dictionary mapping extension to file count.</returns>
        IReadOnlyDictionary<string, int> GetFileTypeCounts();

        /// <summary>
        ///     Creates a new database.
        /// </summary>
        /// <remarks>
        ///     Creates tables using 'IF NOT EXISTS', so this is idempotent unless 'discardExisting` is specified, in which case
        ///     tables are explicitly dropped prior to creation.
        /// </remarks>
        /// <param name="discardExisting">An optional value that determines whether the existing database should be discarded.</param>
        void Create(bool discardExisting = false);

        /// <summary>
        ///     Dumps the contents of the database to a file.
        /// </summary>
        /// <param name="filename">The destination file.</param>
        void DumpTo(string filename);

        /// <summary>
        ///     Finds the filename and length of the file matching the specified <paramref name="maskedFilename"/>.
        /// </summary>
        /// <param name="maskedFilename">The fully qualified remote path of the file.</param>
        /// <returns>The filename, if found.</returns>
        (string Filename, long Size) FindFileInfo(string maskedFilename);

        /// <summary>
        ///     Finds and returns the most recent scan record.
        /// </summary>
        /// <returns>The most recent scan record, or default if no scan was found.</returns>
        Scan FindLatestScan();

        /// <summary>
        ///     Flags the latest scan as suspect, indicating that the cached contents may have diverged from physical storage.
        /// </summary>
        void FlagLatestScanAsSuspect();

        /// <summary>
        ///     Lists the files that are direct children of the specified <paramref name="maskedDirectoryName"/>.
        /// </summary>
        /// <param name="maskedDirectoryName">The fully qualified remote path of the directory.</param>
        /// <returns>The cached file records, keyed by masked filename.</returns>
        IReadOnlyDictionary<string, CachedShareFile> ListDirectoryFiles(string maskedDirectoryName);

        /// <summary>
        ///     Upserts a directory record along with its files in a single transaction.
        /// </summary>
        /// <param name="maskedDirectoryName">The fully qualified remote path of the directory.</param>
        /// <param name="timestamp">The timestamp to assign to the records.</param>
        /// <param name="upserts">Files to insert or update.</param>
        /// <param name="touchedFilenames">Masked filenames of unchanged files whose record timestamps should be refreshed.</param>
        void UpsertDirectoryContents(string maskedDirectoryName, long timestamp, IReadOnlyCollection<ShareFileUpsert> upserts, IReadOnlyCollection<string> touchedFilenames);

        /// <summary>
        ///     Inserts a scan record at the specified <paramref name="timestamp"/>.
        /// </summary>
        /// <param name="timestamp">The timestamp associated with the scan.</param>
        /// <param name="options">The options snapshot at the start of the scan.</param>
        void InsertScan(long timestamp, Options.SharesOptions options);

        /// <summary>
        ///     Lists all directories.
        /// </summary>
        /// <param name="parentDirectory">The optional directory prefix used for listing subdirectories.</param>
        /// <returns>The list of directories.</returns>
        IEnumerable<string> ListDirectories(string parentDirectory = null);

        /// <summary>
        ///     Lists all files.
        /// </summary>
        /// <param name="parentDirectory">The optional parent directory.</param>
        /// <param name="includeFullPath">A value indicating whether the fully qualified path should be returned.</param>
        /// <returns>The list of files.</returns>
        IEnumerable<File> ListFiles(string parentDirectory = null, bool includeFullPath = false);

        /// <summary>
        ///     Lists tag metadata for all files.
        /// </summary>
        /// <returns>The list of file tags, keyed by masked filename.</returns>
        IEnumerable<(string MaskedFilename, FileTags Tags)> ListTags();

        /// <summary>
        ///     Lists files that have tag data.
        /// </summary>
        /// <returns>Tuples of (maskedFilename, originalFilename, tags) for files with tags.</returns>
        IEnumerable<(string MaskedFilename, string OriginalFilename, FileTags Tags)> ListTaggedFiles();

        /// <summary>
        ///     Lists files that have no tag data.
        /// </summary>
        /// <returns>Tuples of (maskedFilename, originalFilename) for files without tags.</returns>
        IEnumerable<(string MaskedFilename, string OriginalFilename)> ListUntaggedFiles();

        /// <summary>
        ///     Updates tag metadata for the file with the specified <paramref name="maskedFilename"/>.
        /// </summary>
        /// <param name="maskedFilename">The masked filename of the file to update.</param>
        /// <param name="tags">The new tag data.</param>
        void UpdateFileTags(string maskedFilename, FileTags tags);

        /// <summary>
        ///     Returns the physical directory path for any file in the specified <paramref name="maskedDirectory"/>.
        /// </summary>
        /// <param name="maskedDirectory">The masked directory path.</param>
        /// <returns>The physical directory path, or null if no files exist in the directory.</returns>
        string GetDirectoryOriginalPath(string maskedDirectory);

        /// <summary>
        ///     Renames a directory, updating all file and directory records in the database.
        /// </summary>
        /// <param name="oldMaskedDirectory">The current masked directory path.</param>
        /// <param name="newMaskedDirectory">The new masked directory path.</param>
        /// <param name="oldOriginalDirectory">The current physical directory path.</param>
        /// <param name="newOriginalDirectory">The new physical directory path.</param>
        void RenameDirectory(string oldMaskedDirectory, string newMaskedDirectory, string oldOriginalDirectory, string newOriginalDirectory);

        /// <summary>
        ///     Returns the list of all <see cref="Scan"/> started at or after the specified <paramref name="startedAtOrAfter"/>
        ///     unix timestamp.
        /// </summary>
        /// <param name="startedAtOrAfter">A unix timestamp that serves as the lower bound of the time-based listing.</param>
        /// <returns>The operation context, including the list of found scans.</returns>
        IEnumerable<Scan> ListScans(long startedAtOrAfter = 0);

        /// <summary>
        ///     Deletes all file and directory entries whose original or masked path matches the specified prefixes.
        ///     Used for targeted cleanup after a file/folder rename or deletion, avoiding a full share rescan.
        /// </summary>
        /// <param name="originalPathPrefix">The local filesystem path prefix to match against file.originalFilename.</param>
        /// <param name="maskedPathPrefix">The Soulseek masked path prefix to match against directories.name.</param>
        void DeleteEntriesByPaths(string originalPathPrefix, string maskedPathPrefix);

        /// <summary>
        ///     Deletes directory records with a timestamp prior to the specified <paramref name="olderThanTimestamp"/>.
        /// </summary>
        /// <param name="olderThanTimestamp">The timestamp before which to delete directories.</param>
        /// <returns>The number of records deleted.</returns>
        long PruneDirectories(long olderThanTimestamp);

        /// <summary>
        ///     Deletes file records with a timestamp prior to the specified <paramref name="olderThanTimestamp"/>.
        /// </summary>
        /// <param name="olderThanTimestamp">The timestamp before which to delete files.</param>
        /// <returns>The number of records deleted.</returns>
        long PruneFiles(long olderThanTimestamp);

        /// <summary>
        ///     Rebuilds the filename index table using the data in the files table.
        /// </summary>
        void RebuildFilenameIndex();

        /// <summary>
        ///     Restores the current database from the database at the specified <paramref name="repository"/>.
        /// </summary>
        /// <param name="repository">The destination repository.</param>
        void RestoreFrom(IShareRepository repository);

        /// <summary>
        ///     Searches the database for files matching the specified <paramref name="query"/>.
        /// </summary>
        /// <param name="query">The search query.</param>
        /// <param name="limit">An optional row limit.</param>
        /// <returns>The list of matching files.</returns>
        IEnumerable<File> Search(SearchQuery query, int? limit = null);

        /// <summary>
        ///     Attempts to validate the backing database.
        /// </summary>
        /// <returns>A value indicating whether the database is valid.</returns>
        bool TryValidate();

        /// <summary>
        ///     Attempts to validate the backing database.
        /// </summary>
        /// <param name="problems">The list of problems, if the database is invalid.</param>
        /// <returns>A value indicating whether the database is valid.</returns>
        bool TryValidate(out IEnumerable<string> problems);

        /// <summary>
        ///     Updates the scan started at the specified <paramref name="timestamp"/> to set the <paramref name="end"/>.
        /// </summary>
        /// <param name="timestamp">The timestamp associated with the scan.</param>
        /// <param name="end">The timestamp at the conclusion of the scan.</param>
        void UpdateScan(long timestamp, long end);

        /// <summary>
        ///     Reclaims unused space.
        /// </summary>
        void Vacuum();
    }
}