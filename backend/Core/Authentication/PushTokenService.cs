// <copyright file="PushTokenService.cs" company="John Narey">
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
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;

public class PushTokenService
{
    // Bounds how many FCM sends one library change fans out into per account. A user with a
    // legitimate need for more than this has bigger problems than push notifications; a
    // malicious account spamming fake device ids just evicts its own oldest entries instead of
    // growing the table or the fan-out without limit.
    private const int MaxDevicesPerUser = 10;

    public PushTokenService(IDbContextFactory<UsersDbContext> contextFactory)
    {
        ContextFactory = contextFactory;
    }

    private IDbContextFactory<UsersDbContext> ContextFactory { get; }

    // Upserts on (Username, DeviceId) so a rotated token or a re-registering device overwrites its
    // existing row instead of accumulating duplicates.
    public void Register(string username, string deviceId, string token, string platform)
    {
        using var db = ContextFactory.CreateDbContext();
        var existing = db.PushTokens.FirstOrDefault(t => t.Username == username && t.DeviceId == deviceId);

        if (existing is null)
        {
            var forUser = db.PushTokens.Where(t => t.Username == username).OrderBy(t => t.UpdatedAt).ToList();
            if (forUser.Count >= MaxDevicesPerUser)
            {
                db.PushTokens.RemoveRange(forUser.Take(forUser.Count - MaxDevicesPerUser + 1));
            }

            db.PushTokens.Add(new PushToken
            {
                Username = username,
                DeviceId = deviceId,
                Token = token,
                Platform = platform,
            });
        }
        else
        {
            existing.Token = token;
            existing.Platform = platform;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        db.SaveChanges();
    }

    public void Unregister(string username, string deviceId)
    {
        using var db = ContextFactory.CreateDbContext();
        var existing = db.PushTokens.FirstOrDefault(t => t.Username == username && t.DeviceId == deviceId);

        if (existing is not null)
        {
            db.PushTokens.Remove(existing);
            db.SaveChanges();
        }
    }

    public IReadOnlyList<PushToken> GetAll()
    {
        using var db = ContextFactory.CreateDbContext();
        return db.PushTokens.ToList();
    }

    // Tokens belonging to administrators only. Used for pushes that announce an action only an
    // administrator can take (a pending restart), so the alert doesn't reach accounts that would
    // be shown a button the API would refuse. A user whose role is demoted stops matching here
    // immediately -- the join is evaluated per send rather than cached against the token row.
    public IReadOnlyList<PushToken> GetForAdministrators()
    {
        using var db = ContextFactory.CreateDbContext();

        return db.PushTokens
            .Join(
                db.Users.Where(u => u.Role == Role.Administrator),
                token => token.Username,
                user => user.Username,
                (token, _) => token)
            .ToList();
    }

    // Called when FCM reports a token as unregistered/invalid, so it stops being sent to.
    public void DeleteByToken(string token)
    {
        using var db = ContextFactory.CreateDbContext();
        var existing = db.PushTokens.FirstOrDefault(t => t.Token == token);

        if (existing is not null)
        {
            db.PushTokens.Remove(existing);
            db.SaveChanges();
        }
    }
}
