// <copyright file="VirtualShare.cs" company="John Narey">
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

namespace resonance.Shares
{
    using System.Collections.Generic;

    /// <summary>
    ///     A single file in a virtual share directory: a masked (peer-visible) name mapped to the real
    ///     file it is served from. Unlike a physical share entry, no file exists at the masked path on disk.
    /// </summary>
    /// <param name="MaskedFilename">The peer-visible path, backslash-separated (e.g. <c>Mixtapes\My Set\01 - Track.flac</c>).</param>
    /// <param name="OriginalFilename">The absolute path of the real file to serve.</param>
    public sealed record VirtualShareFile(string MaskedFilename, string OriginalFilename);

    /// <summary>
    ///     A directory that is presented to peers without existing on disk. Its files are served from their
    ///     real locations elsewhere in the library. Contributed by <see cref="IShareService"/> virtual-share
    ///     providers (e.g. mixtapes) and materialised into the share cache during scans, replacing the older
    ///     symlink-directory approach.
    /// </summary>
    /// <param name="MaskedDirectory">The peer-visible directory, backslash-separated (e.g. <c>Mixtapes\My Set</c>).</param>
    /// <param name="Files">The files in the directory.</param>
    public sealed record VirtualShareDirectory(string MaskedDirectory, IReadOnlyList<VirtualShareFile> Files);
}
