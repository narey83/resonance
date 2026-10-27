// <copyright file="HubSecurityConnections.cs" company="John Narey">
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

namespace resonance.Authentication;

using System;
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

/// <summary>Retains connection handles only for immediate server-side revocation.</summary>
public static class HubSecurityConnections
{
    private static readonly ConcurrentDictionary<string, HubCallerContext> Connections = new();
    public static void Register(HubCallerContext context) => Connections[context.ConnectionId] = context;
    public static void Remove(string id) => Connections.TryRemove(id, out _);
    public static void AbortSession(Guid id) => AbortWhere(c => c.User?.FindFirst("sid")?.Value == id.ToString());
    public static void AbortAll() => AbortWhere(_ => true);
    private static void AbortWhere(Func<HubCallerContext, bool> matches)
    {
        foreach (var pair in Connections)
        {
            if (matches(pair.Value))
            {
                pair.Value.Abort();
                Connections.TryRemove(pair.Key, out _);
            }
        }
    }
}

public sealed class HubSecurityFilter(SessionService sessions) : IHubFilter
{
    public async Task OnConnectedAsync(HubLifetimeContext context, Func<HubLifetimeContext, Task> next)
    {
        HubSecurityConnections.Register(context.Context);
        try
        {
            var user = context.Context.User;
            if (Guid.TryParse(user?.FindFirst("sid")?.Value, out var sid) &&
                sessions.IsJwtRevoked(sid, user.Identity?.Name, user.FindFirstValue(ClaimTypes.Role)))
            {
                context.Context.Abort();
                throw new HubException("Session is no longer authorised.");
            }

            await next(context);
        }
        catch
        {
            HubSecurityConnections.Remove(context.Context.ConnectionId);
            throw;
        }
    }

    public async Task OnDisconnectedAsync(HubLifetimeContext context, Exception exception, Func<HubLifetimeContext, Exception, Task> next)
    {
        HubSecurityConnections.Remove(context.Context.ConnectionId);
        await next(context, exception);
    }
}
