// <copyright file="YtDlpTrack.cs" company="John Narey">
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

public enum YtDlpTrackState
{
    Queued,
    InProgress,
    Completed,
    Failed,
    Skipped,
    Cancelled,
}

public class YtDlpTrack
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public Guid JobId { get; init; }
    public string VideoId { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Uploader { get; init; } = string.Empty;
    public string? ThumbnailUrl { get; init; }
    public int? Duration { get; set; }
    public int? PlaylistIndex { get; init; }
    public string? UploadDate { get; init; }
    public YtDlpTrackState State { get; set; } = YtDlpTrackState.Queued;
    public double Progress { get; set; }
    public string? Speed { get; set; }
    public string? Eta { get; set; }
    public int AttemptCount { get; set; }
    public string? FilePath { get; set; }
    public string? Error { get; set; }
    public string? TagWritingError { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
