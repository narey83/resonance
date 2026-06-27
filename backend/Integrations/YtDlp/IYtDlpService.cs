// <copyright file="IYtDlpService.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Resonance.Integrations.YtDlp.Types;

public interface IYtDlpService : IHostedService
{
    IReadOnlyList<YtDlpJob> ListJobs();
    IReadOnlyList<YtDlpEvent> GetRecentEvents();
    Task<YtDlpJob> SubmitAsync(string url, string? outputDirectory = null, string? audioFormat = null, int? audioQuality = null, string? defaultGenre = null, int? minTrackDurationSeconds = null, int? maxTrackDurationSeconds = null, string? convertOnCompletionFormat = null, string? uploadedAfter = null, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<YtDlpTrack>> GetTracksAsync(Guid jobId);
    Task<IReadOnlyList<YtDlpTrack>> GetTagErrorTracksAsync();
    Task CancelJobAsync(Guid jobId);
    Task PauseJobAsync(Guid jobId);
    Task ResumeJobAsync(Guid jobId);
    Task CancelTrackAsync(Guid trackId);
    Task RemoveJobAsync(Guid jobId);
    Task RetryFailedTracksAsync(Guid jobId);
    Task RetryTagWritingAsync(Guid trackId);
    Task<IReadOnlyList<YtDlpSearchResult>> SearchAsync(string query, int limit = 25, string? type = null, string? duration = null, string? uploadDate = null, string? sortBy = null, CancellationToken cancellationToken = default);
    Task<(string? YtDlpVersion, string? FfmpegVersion)> GetVersionsAsync(CancellationToken cancellationToken = default);
    Task<(string? Current, string? Latest, bool UpdateAvailable)> CheckForUpdateAsync(CancellationToken cancellationToken = default);
    Task<string> UpdateYtDlpAsync(CancellationToken cancellationToken = default);
    Task<(int Updated, int Failed, int Skipped)> BackfillDurationsAsync(CancellationToken cancellationToken = default);
    Task ReconcileJobAsync(Guid jobId);

    // ── Subscriptions ─────────────────────────────────────────────────────────
    IReadOnlyList<YtDlpSubscription> ListSubscriptions();
    Task<YtDlpSubscription> AddSubscriptionAsync(string channelUrl, YtDlpSubscriptionOverrides? overrides = null, CancellationToken cancellationToken = default);
    Task UpdateSubscriptionAsync(Guid id, bool? enabled, int? pollIntervalMinutes, YtDlpSubscriptionOverrides? overrides, CancellationToken cancellationToken = default);
    Task RemoveSubscriptionAsync(Guid id, CancellationToken cancellationToken = default);
    Task CheckSubscriptionNowAsync(Guid id, CancellationToken cancellationToken = default);
}

public record YtDlpSubscriptionOverrides(
    string? OutputDirectory = null,
    string? AudioFormat = null,
    int? AudioQuality = null,
    string? DefaultGenre = null,
    int? MinTrackDurationSeconds = null,
    int? MaxTrackDurationSeconds = null,
    string? ConvertOnCompletionFormat = null,
    string? UploadedAfter = null);

public record YtDlpEvent(DateTime Timestamp, Guid? JobId, string? JobTitle, string Level, string Message);

public record YtDlpSearchResult(
    string VideoId,
    string Url,
    string Title,
    string Uploader,
    string? ThumbnailUrl,
    int? Duration,
    string Type = "video",
    long? SubscriberCount = null);
