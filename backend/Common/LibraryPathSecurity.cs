// <copyright file="LibraryPathSecurity.cs" company="John Narey">
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

namespace resonance.Common;

using System;
using System.Collections.Generic;
using System.IO;

/// <summary>Canonical filesystem containment, including links in every parent directory.</summary>
public static class LibraryPathSecurity
{
    public static string Resolve(string path) => Resolve(path, 0);

    public static bool Contains(string root, string path) => ResolveWithin([root], path) != null;

    /// <summary>Resolves a file once and authorizes it against freshly resolved configured roots.</summary>
    /// <returns>The canonical file path, or null when it is outside every accessible root.</returns>
    public static string ResolveWithin(IEnumerable<string> roots, string path)
    {
        try
        {
            var canonicalPath = Resolve(path);
            foreach (var root in roots)
            {
                try
                {
                    var canonicalRoot = Resolve(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                    if (canonicalPath.StartsWith(canonicalRoot, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
                    {
                        return canonicalPath;
                    }
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
                {
                    // An unavailable root cannot authorize a file; another configured root may.
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
        }

        return null;
    }

    private static string Resolve(string path, int links)
    {
        if (links > 40)
        {
            throw new IOException("Too many symbolic links.");
        }

        var full = Path.GetFullPath(path);
        var root = Path.GetPathRoot(full);
        var current = root;
        foreach (var segment in full[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            var attributes = File.GetAttributes(current);
            if (!attributes.HasFlag(FileAttributes.ReparsePoint))
            {
                continue;
            }

            FileSystemInfo info = attributes.HasFlag(FileAttributes.Directory) ? new DirectoryInfo(current) : new FileInfo(current);
            if (info.LinkTarget is { } target)
            {
                current = Resolve(Path.IsPathRooted(target) ? target : Path.Combine(Path.GetDirectoryName(current), target), links + 1);
            }
        }

        return current;
    }
}
