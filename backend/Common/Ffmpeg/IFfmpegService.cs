// <copyright file="IFfmpegService.cs" company="John Narey">
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

namespace resonance.Common.Ffmpeg;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;

/// <summary>
///     The single, app-wide source of truth for the ffmpeg and ffprobe binaries. Ensures a usable
///     copy exists (auto-downloading a static build when necessary) and keeps it updated in the
///     background. All ffmpeg/ffprobe consumers should resolve their binary through this service.
/// </summary>
public interface IFfmpegService : IHostedService
{
    /// <summary>Gets the cached ffmpeg path, or null if not yet resolved.</summary>
    string? FfmpegPath { get; }

    /// <summary>Gets the cached ffprobe path, or null if not yet resolved.</summary>
    string? FfprobePath { get; }

    /// <summary>Ensures ffmpeg is available (downloading if needed) and returns its path.</summary>
    /// <returns>The path to the ffmpeg executable.</returns>
    Task<string> GetFfmpegPathAsync(CancellationToken cancellationToken = default);

    /// <summary>Ensures ffprobe is available (downloading if needed) and returns its path.</summary>
    /// <returns>The path to the ffprobe executable.</returns>
    Task<string> GetFfprobePathAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns the first line of <c>ffmpeg -version</c>, or null on failure.</summary>
    /// <returns>The ffmpeg version string, or null if it could not be determined.</returns>
    Task<string?> GetVersionAsync(CancellationToken cancellationToken = default);

    /// <summary>Checks GitHub for a newer static build of the self-managed ffmpeg.</summary>
    /// <returns>The current and latest version tags, and whether an update is available.</returns>
    Task<(string? Current, string? Latest, bool UpdateAvailable)> CheckForUpdateAsync(CancellationToken cancellationToken = default);

    /// <summary>Downloads and installs the latest static ffmpeg/ffprobe build. Returns the new version tag.</summary>
    /// <returns>The version tag of the newly installed build.</returns>
    Task<string> UpdateAsync(CancellationToken cancellationToken = default);
}
