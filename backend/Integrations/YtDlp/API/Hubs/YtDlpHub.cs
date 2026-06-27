// <copyright file="YtDlpHub.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp.API.Hubs;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using resonance;
using Resonance.Integrations.YtDlp.Types;

public static class YtDlpHubMethods
{
    public const string Jobs = "JOBS";
    public const string TrackProgress = "TRACK_PROGRESS";
    public const string JobLog = "JOB_LOG";
    public const string Event = "EVENT";
    public const string EventSnapshot = "EVENT_SNAPSHOT";
    public const string Subscriptions = "SUBSCRIPTIONS";
}

public static class YtDlpHubExtensions
{
    public static Task BroadcastJobsAsync(this IHubContext<YtDlpHub> hub, IEnumerable<YtDlpJob> jobs)
        => hub.Clients.All.SendAsync(YtDlpHubMethods.Jobs, jobs);

    public static Task BroadcastTrackProgressAsync(this IHubContext<YtDlpHub> hub, YtDlpTrack track)
        => hub.Clients.All.SendAsync(YtDlpHubMethods.TrackProgress, track);

    public static Task BroadcastJobLogAsync(this IHubContext<YtDlpHub> hub, Guid jobId, string line, bool isError = false)
        => hub.Clients.All.SendAsync(YtDlpHubMethods.JobLog, new { jobId, line, isError });

    public static Task BroadcastEventAsync(this IHubContext<YtDlpHub> hub, YtDlpEvent ev)
        => hub.Clients.All.SendAsync(YtDlpHubMethods.Event, ev);

    public static Task BroadcastSubscriptionsAsync(this IHubContext<YtDlpHub> hub, IEnumerable<YtDlpSubscription> subscriptions)
        => hub.Clients.All.SendAsync(YtDlpHubMethods.Subscriptions, subscriptions);
}

[Authorize(Policy = AuthPolicy.Any)]
public class YtDlpHub : Hub
{
    public YtDlpHub(IYtDlpService service)
    {
        Service = service;
    }

    private IYtDlpService Service { get; }

    public override async Task OnConnectedAsync()
    {
        await Clients.Caller.SendAsync(YtDlpHubMethods.Jobs, Service.ListJobs());
        await Clients.Caller.SendAsync(YtDlpHubMethods.EventSnapshot, Service.GetRecentEvents());
        await Clients.Caller.SendAsync(YtDlpHubMethods.Subscriptions, Service.ListSubscriptions());
    }

    public Task RemoveJob(Guid jobId) => Service.RemoveJobAsync(jobId);
    public Task CancelJob(Guid jobId) => Service.CancelJobAsync(jobId);
    public Task CancelTrack(Guid trackId) => Service.CancelTrackAsync(trackId);
    public Task RetryTags(Guid trackId) => Service.RetryTagWritingAsync(trackId);
    public Task RetryFailedTracks(Guid jobId) => Service.RetryFailedTracksAsync(jobId);
}
