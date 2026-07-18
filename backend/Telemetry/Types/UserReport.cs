// <copyright file="UserReport.cs" company="John Narey">
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

namespace resonance.Telemetry;

using System;

public enum UserReportSortBy
{
    UploadCount,
    DownloadCount,
    UploadBytes,
    DownloadBytes,
    Errors,
    LastSeen,
    Username,
    IpAddress,
    Country,
    City,
    UploadSpeed,
    DownloadSpeed,
}

public record UserReportSummary
{
    public string Username { get; init; }
    public long UploadCount { get; init; }
    public long DownloadCount { get; init; }
    public long UploadBytes { get; init; }
    public long DownloadBytes { get; init; }
    public long UploadErrorCount { get; init; }
    public long DownloadErrorCount { get; init; }
    public double UploadAverageSpeed { get; init; }
    public double DownloadAverageSpeed { get; init; }
    public DateTime? LastSeen { get; init; }
    public string IpAddress { get; init; }
    public string Country { get; init; }
    public string City { get; init; }
    public int? IsVpn { get; init; }
    public double? Lat { get; init; }
    public double? Lon { get; init; }
}

public record UserTransferRecord
{
    public string Id { get; init; }
    public string Username { get; init; }
    public string Direction { get; init; }
    public string Filename { get; init; }
    public long Size { get; init; }
    public string StateDescription { get; init; }
    public string Exception { get; init; }
    public DateTime RequestedAt { get; init; }
    public DateTime? EnqueuedAt { get; init; }
    public DateTime? StartedAt { get; init; }
    public DateTime? EndedAt { get; init; }
    public long BytesTransferred { get; init; }
    public double AverageSpeed { get; init; }
}

public record TransferFileSummary
{
    public string Filename { get; init; }
    public long Count { get; init; }
    public long DistinctUsers { get; init; }
    public long TotalBytes { get; init; }
}

public record UserEventCounts(int BrowseCount, int ChatCount);
