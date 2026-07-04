// <copyright file="YtDlpJob.cs" company="John Narey">
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

public enum YtDlpJobState
{
    Enumerating,
    Active,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

public class YtDlpJob
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public string Url { get; init; } = string.Empty;

    // Set when the subscription poller auto-spawned this job; null for manual downloads.
    // Lets the UI collapse auto-downloads under their subscription instead of listing them loose.
    public Guid? SubscriptionId { get; init; }
    public string Title { get; set; } = string.Empty;
    public string Uploader { get; set; } = string.Empty;
    public string? ThumbnailUrl { get; set; }
    public YtDlpJobState State { get; set; } = YtDlpJobState.Enumerating;
    public int TotalTracks { get; set; }
    public int CompletedTracks { get; set; }
    public int FailedTracks { get; set; }
    public int SkippedTracks { get; set; }
    public int TagFailedTracks { get; set; }
    public string? CurrentTrackTitle { get; set; }
    public string OutputDirectory { get; init; } = string.Empty;

    // Per-job overrides (null = use global option)
    public string? AudioFormatOverride { get; set; }
    public int? AudioQualityOverride { get; set; }
    public string? DefaultGenreOverride { get; set; }
    public int? MinTrackDurationSecondsOverride { get; set; }
    public int? MaxTrackDurationSecondsOverride { get; set; }

    // Upload-date window for channel/playlist downloads (today/week/month/year; null = no limit).
    public string? UploadedAfterOverride { get; set; }

    // Audio format to convert completed tracks to before they go live (null = use global option,
    // empty/"none"/"best" = no conversion). Applied in staging during FinalizeJobAsync.
    public string? ConvertOnCompletionFormatOverride { get; set; }

    public DateTime RequestedAt { get; init; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
