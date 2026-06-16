// <copyright file="IYtDlpService.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
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
    Task<YtDlpJob> SubmitAsync(string url, string? outputDirectory = null, string? audioFormat = null, int? audioQuality = null, string? defaultGenre = null, int? minTrackDurationSeconds = null, int? maxTrackDurationSeconds = null, string? convertOnCompletionFormat = null, CancellationToken cancellationToken = default);
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
}

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
