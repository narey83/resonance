// <copyright file="ReportsCacheWarmer.cs" company="John Narey">
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
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Serilog;
using Soulseek;

/// <summary>
///     Keeps the Overview dashboard's report cache warm.
/// </summary>
/// <remarks>
///     <para>
///         The report methods are cached with serve-stale-while-revalidate (see
///         <see cref="ReportsService"/>), so the only requests that ever block on the
///         database are the ones for a window whose entry has been evicted — which is
///         exactly what happens the first time an admin picks a new timescale after the
///         dashboard has been idle. A 30-day aggregate is slow, so that first tap "hangs".
///     </para>
///     <para>
///         This background service periodically replays the exact calls the Overview
///         dashboard makes, for every standard range, so their cache entries always
///         exist (and stay fresh). Because <c>WindowKey</c> quantises the window
///         relative to now by the TTL, the keys the warmer populates are the same ones
///         the client asks for — so a range switch becomes a cache hit instead of a
///         cold query. The parameters below mirror the dashboard's requests
///         (<c>mobile/src/api/analytics.ts</c> + <c>OverviewScreen.tsx</c>); a mismatch
///         is harmless (it just warms an unused key), never incorrect.
///     </para>
/// </remarks>
public sealed class ReportsCacheWarmer : BackgroundService
{
    // The dashboard's range picker. Kept in sync with RANGES in OverviewScreen.tsx.
    private static readonly int[] RangeHours = { 1, 6, 24, 168, 720 };

    // Warm well inside the shortest eviction horizon (min TTL is 2 min, retention is
    // 6×TTL = 12 min) so no window is ever evicted between passes — an existing entry
    // is served instantly (stale-while-revalidate), so a user never blocks on the DB.
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(4);

    // Let the app finish booting (and the transfer schema settle) before the first pass.
    private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(30);

    public ReportsCacheWarmer(ReportsService reports)
    {
        Reports = reports;
    }

    private ReportsService Reports { get; }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var startedAt = DateTime.UtcNow;

            try
            {
                WarmAll(stoppingToken);
                Log.Debug("Report cache warm pass completed in {Elapsed}ms", (int)(DateTime.UtcNow - startedAt).TotalMilliseconds);
            }
            catch (Exception ex)
            {
                Log.Warning("Report cache warm pass failed: {Message}", ex.Message);
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    // Mirror of histogramInterval() in OverviewScreen.tsx — the bucket size (minutes)
    // the dashboard requests per range, which is part of the histogram cache key.
    private static int HistogramIntervalMinutes(int hours) => hours switch
    {
        <= 1 => 5,
        <= 6 => 15,
        <= 24 => 60,
        <= 168 => 360,
        _ => 1_440,
    };

    // Replays every report call the Overview dashboard makes, for every range. Each call
    // is isolated so one failure (or a range with no data) can't abort the whole pass.
    private void WarmAll(CancellationToken ct)
    {
        // Global (range-independent) cards.
        Warm(() => Reports.GetCatalogCoverage());

        // The web heatmap deliberately uses a fixed 90-day window, independently of the range
        // picker. Warm that one report explicitly without running every other report for 90 days.
        var heatmapEnd = DateTime.UtcNow;
        Warm(() => Reports.GetActivityHeatmap(heatmapEnd.AddDays(-90), heatmapEnd));

        foreach (var hours in RangeHours)
        {
            if (ct.IsCancellationRequested)
            {
                return;
            }

            var end = DateTime.UtcNow;
            var start = end.AddHours(-hours);
            var prevStart = end.AddHours(-2 * hours);
            var interval = TimeSpan.FromMinutes(HistogramIntervalMinutes(hours));

            // "At a Glance" tab.
            Warm(() => Reports.GetTransferSummary(start, end));
            Warm(() => Reports.GetTransferSummary(prevStart, start)); // previous-period comparison
            Warm(() => Reports.GetSocialActivity(start, end));

            // "Activity" tab.
            Warm(() => Reports.GetTransferHistogram(start, end, interval));
            Warm(() => Reports.GetActivityHeatmap(start, end));

            // "Reliability" tab.
            Warm(() => Reports.GetTransferExceptionsPareto(TransferDirection.Download, start, end, limit: 10, offset: 0));
            Warm(() => Reports.GetTransferExceptionsPareto(TransferDirection.Upload, start, end, limit: 10, offset: 0));
            Warm(() => Reports.GetRetryFunnel(start, end));
            Warm(() => Reports.GetQueueWaitStats(start, end));

            // "Top Users" tab.
            Warm(() => Reports.GetTransferLeaderboard(TransferDirection.Download, start, end, LeaderboardSortBy.TotalBytes, SortOrder.DESC, limit: 10, offset: 0));
            Warm(() => Reports.GetTransferLeaderboard(TransferDirection.Upload, start, end, LeaderboardSortBy.TotalBytes, SortOrder.DESC, limit: 10, offset: 0));
            Warm(() => Reports.GetTopFiles(start, end, limit: 10, offset: 0));
            Warm(() => Reports.GetTransferDirectoryFrequency(start, end, username: null, SortOrder.DESC, limit: 10, offset: 0));

            // "Geography" tab.
            Warm(() => Reports.GetGeography(start, end, limit: 10));
            Warm(() => Reports.GetPeerRetention(start, end));
            Warm(() => Reports.GetUserList(start, end, search: null, UserReportSortBy.DownloadBytes, SortOrder.DESC, limit: 100, offset: 0));
        }
    }

    private void Warm(Action call)
    {
        try
        {
            Reports.WarmCache(call);
        }
        catch (Exception ex)
        {
            Log.Debug("Report cache warm call failed: {Message}", ex.Message);
        }
    }
}
