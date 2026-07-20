// <copyright file="Share.cs" company="JP Dillingham">
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
    using System.Linq;
    using System.Text.Json.Serialization;
    using System.Text.RegularExpressions;

    /// <summary>
    ///     A file share.
    /// </summary>
    public sealed class Share
    {
        /// <summary>
        ///     Initializes a new instance of the <see cref="Share"/> class.
        /// </summary>
        /// <param name="id"></param>
        /// <param name="alias"></param>
        /// <param name="isExcluded"></param>
        /// <param name="isLocked"></param>
        /// <param name="isManaged"></param>
        /// <param name="localPath"></param>
        /// <param name="raw"></param>
        /// <param name="remotePath"></param>
        /// <param name="directories"></param>
        /// <param name="files"></param>
        [JsonConstructor]
        public Share(string id, string alias, bool isExcluded, bool isLocked, bool isManaged, string localPath, string raw, string remotePath, int? directories, int? files)
        {
            Id = id;
            Alias = alias;
            IsExcluded = isExcluded;
            IsLocked = isLocked;
            IsManaged = isManaged;
            LocalPath = localPath;
            Raw = raw;
            RemotePath = remotePath;
            Directories = directories;
            Files = files;
        }

        /// <summary>
        ///     Initializes a new instance of the <see cref="Share"/> class.
        /// </summary>
        /// <param name="share"></param>
        public Share(string share)
        {
            Raw = share;
            IsExcluded = share.StartsWith('-') || share.StartsWith('!');
            IsLocked = !IsExcluded && share.StartsWith('~');

            if (IsExcluded || IsLocked)
            {
                share = share[1..];
            }

            // test to see whether an alias has been specified
            var matches = Regex.Matches(share, @"^\[(.*)\](.*)$");

            if (matches.Any())
            {
                // split the alias from the path, and validate the alias
                var groups = matches[0].Groups;
                Alias = groups[1].Value;
                LocalPath = groups[2].Value;
            }
            else
            {
#pragma warning disable S3878 // Arrays should not be created for params parameters
                Alias = share.Split(new[] { '/', '\\' }).Last();
#pragma warning restore S3878 // Arrays should not be created for params parameters
                LocalPath = share;
            }

            RemotePath = Alias;

            Id = Compute.Sha1Hash(RemotePath);
        }

        public string Id { get; init; }
        public string Alias { get; init; }
        public bool IsExcluded { get; init; }
        public bool IsLocked { get; init; }
        public bool IsManaged { get; init; }
        public string LocalPath { get; init; }
        public string Raw { get; init; }
        public string RemotePath { get; init; }
        public int? Directories { get; private set; }
        public int? Files { get; private set; }

        public static Share CreateManaged(string localPath, string alias, bool isExcluded = false)
        {
            var remotePath = alias;
            return new Share(
                id: Compute.Sha1Hash(remotePath),
                alias: alias,
                isExcluded: isExcluded,
                isLocked: false,
                isManaged: true,
                localPath: localPath,
                raw: $"{(isExcluded ? "!" : string.Empty)}[{alias}]{localPath}",
                remotePath: remotePath,
                directories: null,
                files: null);
        }

        public void UpdateStatistics(int directories, int files)
        {
            Directories = directories;
            Files = files;
        }
    }
}
