// <copyright file="MusicPath.cs" company="John Narey">
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

namespace resonance.Common
{
    using System;
    using System.IO;

    /// <summary>
    ///     Central mapping between absolute filesystem paths and their storage form, which is relative
    ///     to the single music root (the shared/downloads directory).
    /// </summary>
    /// <remarks>
    ///     <para>
    ///         Absolute paths must never be persisted: they couple every stored row to the mount layout,
    ///         so moving the music location breaks the whole database. Instead each persistence boundary
    ///         calls <see cref="ToRelative"/> on the way in and <see cref="ToAbsolute"/> on the way out.
    ///         The conversion is symmetric, so in-memory logic is unchanged — only the stored text differs.
    ///     </para>
    ///     <para>
    ///         Moving the library to a new location then requires only a config change to the root; no data
    ///         migration. The root is fixed at startup (the downloads directory requires a restart to change).
    ///     </para>
    /// </remarks>
    public static class MusicPath
    {
        private static string root = string.Empty;

        /// <summary>
        ///     Gets the absolute music root that stored paths are relative to (normalised, no trailing separator).
        /// </summary>
        public static string Root => root;

        /// <summary>
        ///     Configures the music root. Called once at startup from the resolved options.
        /// </summary>
        /// <param name="musicRoot">The absolute path of the shared/downloads music directory.</param>
        public static void Configure(string musicRoot)
        {
            root = string.IsNullOrWhiteSpace(musicRoot)
                ? string.Empty
                : Path.TrimEndingDirectorySeparator(Path.GetFullPath(musicRoot));
        }

        /// <summary>
        ///     Converts an absolute path to its storage form, relative to <see cref="Root"/>. Paths that are
        ///     already relative, empty, or fall outside the root are returned unchanged (defensive).
        /// </summary>
        /// <param name="absolute">The absolute path.</param>
        /// <returns>The path relative to the music root, using forward slashes.</returns>
        public static string ToRelative(string absolute)
        {
            if (string.IsNullOrEmpty(absolute) || string.IsNullOrEmpty(root))
            {
                return absolute;
            }

            // The root itself maps to the empty relative path.
            if (absolute.Equals(root, StringComparison.Ordinal))
            {
                return string.Empty;
            }

            var prefix = root + '/';
            if (absolute.StartsWith(prefix, StringComparison.Ordinal))
            {
                return absolute.Substring(prefix.Length);
            }

            return absolute;
        }

        /// <summary>
        ///     Converts a stored (relative) path back to an absolute path under <see cref="Root"/>. Paths that
        ///     are already absolute or empty are returned unchanged (defensive).
        /// </summary>
        /// <param name="relative">The stored, root-relative path.</param>
        /// <returns>The absolute path.</returns>
        public static string ToAbsolute(string relative)
        {
            if (string.IsNullOrEmpty(root))
            {
                return relative;
            }

            // The empty relative path is the root itself (symmetric with ToRelative(root) == "").
            if (string.IsNullOrEmpty(relative))
            {
                return root;
            }

            if (Path.IsPathRooted(relative))
            {
                return relative;
            }

            return root + '/' + relative;
        }
    }
}
