// <copyright file="BrowseRateLimiter.cs" company="JP Dillingham">
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

namespace resonance.Core;

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Microsoft.Extensions.Options;
using Serilog;
using Soulseek;

public class BrowseRateLimiter
{
    public BrowseRateLimiter(IOptionsMonitor<resonance.Options> options, ISoulseekClient soulseekClient)
    {
        Options = options;
        Client = soulseekClient;
    }

    private IOptionsMonitor<resonance.Options> Options { get; }
    private ISoulseekClient Client { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext<BrowseRateLimiter>();

    // username → (request count, window start)
    private ConcurrentDictionary<string, (int Count, DateTime WindowStart)> Counters { get; } = new();

    // username → block expiry
    private ConcurrentDictionary<string, DateTime> Blocked { get; } = new();

    /// <summary>
    ///     Records a folder-contents request from <paramref name="username"/> and returns true
    ///     if the user is currently rate-limited (block still active, or this request tips them over).
    /// </summary>
    /// <returns></returns>
    public bool IsRateLimited(string username)
    {
        var opts = Options.CurrentValue.BrowseRateLimit;
        if (!opts.Enabled)
        {
            return false;
        }

        // Check existing block
        if (Blocked.TryGetValue(username, out var expiry))
        {
            if (DateTime.UtcNow < expiry)
            {
                return true;
            }

            Blocked.TryRemove(username, out _);
        }

        var now = DateTime.UtcNow;
        var window = TimeSpan.FromSeconds(opts.WindowSecs);

        var entry = Counters.AddOrUpdate(
            username,
            _ => (1, now),
            (_, existing) =>
            {
                if (now - existing.WindowStart > window)
                {
                    return (1, now);
                }

                return (existing.Count + 1, existing.WindowStart);
            });

        if (entry.Count <= opts.Requests)
        {
            return false;
        }

        // Threshold exceeded — block and optionally notify
        var blockUntil = now.AddMinutes(opts.BlockDurationMins);
        Blocked[username] = blockUntil;
        Counters.TryRemove(username, out _);

        var minutes = opts.BlockDurationMins;
        Log.Warning("Browse rate limit exceeded for {Username} — blocked for {Minutes}m", username, minutes);

        if (opts.SendMessage && !string.IsNullOrWhiteSpace(opts.MessageTemplate))
        {
            var message = opts.MessageTemplate.Replace("{minutes}", minutes.ToString());
            _ = TrySendMessageAsync(username, message);
        }

        return true;
    }

    public IReadOnlyList<BrowseRateLimitUser> GetUsers()
    {
        var now = DateTime.UtcNow;
        var result = new List<BrowseRateLimitUser>();

        foreach (var (username, (count, windowStart)) in Counters)
        {
            result.Add(new BrowseRateLimitUser(username, count, windowStart, Blocked: false, BlockedUntil: null));
        }

        foreach (var (username, expiry) in Blocked)
        {
            if (now < expiry)
            {
                result.Add(new BrowseRateLimitUser(username, Requests: 0, WindowStart: null, Blocked: true, BlockedUntil: expiry));
            }
        }

        return result;
    }

    public void Unblock(string username)
    {
        Blocked.TryRemove(username, out _);
        Counters.TryRemove(username, out _);
    }

    public record BrowseRateLimitUser(
        string Username,
        int Requests,
        DateTime? WindowStart,
        bool Blocked,
        DateTime? BlockedUntil);

    private async System.Threading.Tasks.Task TrySendMessageAsync(string username, string message)
    {
        try
        {
            await Client.SendPrivateMessageAsync(username, message);
            Log.Information("Sent rate-limit notification to {Username}", username);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to send rate-limit notification to {Username}", username);
        }
    }
}
