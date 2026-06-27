// <copyright file="YtDlpSubscription.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp.Types;

using System;

/// <summary>
///     A subscription to a YouTube channel (or playlist). The poller periodically re-enumerates
///     the channel's most recent uploads and auto-downloads any video not yet seen.
/// </summary>
public class YtDlpSubscription
{
    public Guid Id { get; init; } = Guid.NewGuid();

    /// <summary>Gets the channel/playlist URL to poll.</summary>
    public string ChannelUrl { get; init; } = string.Empty;

    /// <summary>Gets or sets the resolved channel display name (populated on first check).</summary>
    public string ChannelTitle { get; set; } = string.Empty;

    public string? ThumbnailUrl { get; set; }

    /// <summary>Gets or sets a value indicating whether the subscription is actively polled.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets the poll interval in minutes (0 = use the global default).</summary>
    public int PollIntervalMinutes { get; set; }

    /// <summary>
    ///     Gets or sets the id of the newest video seen at the last check. Acts as the cursor:
    ///     anything listed ahead of it on the next check is new. Null until the first (baseline) check.
    /// </summary>
    public string? LastVideoId { get; set; }

    public DateTime? LastCheckedAt { get; set; }

    /// <summary>Gets or sets the cumulative count of videos auto-downloaded by this subscription.</summary>
    public int NewVideosFound { get; set; }

    /// <summary>Gets or sets the last error encountered while checking (cleared on success).</summary>
    public string? LastError { get; set; }

    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;

    // Per-subscription overrides passed through to each download job (null = use global option).
    public string? OutputDirectoryOverride { get; set; }
    public string? AudioFormatOverride { get; set; }
    public int? AudioQualityOverride { get; set; }
    public string? DefaultGenreOverride { get; set; }
    public int? MinTrackDurationSecondsOverride { get; set; }
    public int? MaxTrackDurationSecondsOverride { get; set; }
    public string? ConvertOnCompletionFormatOverride { get; set; }
    public string? UploadedAfterOverride { get; set; }
}
