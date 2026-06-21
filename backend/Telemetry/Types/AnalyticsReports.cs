// <copyright file="AnalyticsReports.cs" company="JP Dillingham">
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

namespace resonance.Telemetry;

using System.Collections.Generic;

/// <summary>
///     A single cell of the day-of-week / hour-of-day activity heatmap (times are UTC).
/// </summary>
public record HeatmapCell
{
    public int Dow { get; init; }
    public int Hour { get; init; }
    public long Bytes { get; init; }
    public long Count { get; init; }
}

/// <summary>
///     Aggregate upload activity for a single country.
/// </summary>
public record CountrySummary
{
    public string Country { get; init; }
    public long Bytes { get; init; }
    public long Count { get; init; }
    public long Users { get; init; }
}

/// <summary>
///     Geographic breakdown of upload activity plus VPN usage among active peers.
/// </summary>
public record GeographyReport
{
    public List<CountrySummary> Countries { get; init; } = new();
    public long VpnUsers { get; init; }
    public long TotalUsers { get; init; }
    public long UnknownUsers { get; init; }
}

/// <summary>
///     The number of terminal download transfers that finished after a given number of attempts.
/// </summary>
public record RetryBucket
{
    public int Attempts { get; init; }
    public long Count { get; init; }
    public long Succeeded { get; init; }
}

/// <summary>
///     Distribution statistics (seconds) for how long peers waited in the upload queue.
/// </summary>
public record QueueWaitStats
{
    public double P50 { get; init; }
    public double P90 { get; init; }
    public double P99 { get; init; }
    public double Max { get; init; }
    public double Avg { get; init; }
    public long Count { get; init; }
}

/// <summary>
///     New versus returning peers seen within a window, based on each peer's first-ever transfer.
/// </summary>
public record PeerRetention
{
    public long NewPeers { get; init; }
    public long ReturningPeers { get; init; }
}

/// <summary>
///     Catalog reach: how many distinct shared files have ever been uploaded.
/// </summary>
public record CoverageReport
{
    public long UploadedFiles { get; init; }
}

/// <summary>
///     Counts of social / discovery events within a window.
/// </summary>
public record SocialActivity
{
    public long Browsed { get; init; }
    public long PrivateMessages { get; init; }
    public long RoomMessages { get; init; }
    public long Mentions { get; init; }
}
