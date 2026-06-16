// <copyright file="LoginRateLimiter.cs" company="JP Dillingham">
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

namespace resonance.Authentication;

using System;
using System.Collections.Concurrent;

/// <summary>
///     Tracks failed login attempts per caller and blocks further attempts after too many
///     failures within the window. In-memory; state is lost on restart, which only errs
///     in the caller's favor.
/// </summary>
public class LoginRateLimiter
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    private ConcurrentDictionary<string, (int Failures, DateTime WindowStart)> Attempts { get; } = new();

    /// <summary>
    ///     Returns true if the caller has exceeded the failure limit and should be rejected
    ///     before credentials are checked.
    /// </summary>
    /// <returns></returns>
    public bool IsBlocked(string key)
    {
        key ??= "unknown";

        if (!Attempts.TryGetValue(key, out var entry))
        {
            return false;
        }

        if (DateTime.UtcNow - entry.WindowStart > Window)
        {
            Attempts.TryRemove(key, out _);
            return false;
        }

        return entry.Failures >= MaxFailures;
    }

    public void RecordFailure(string key)
    {
        key ??= "unknown";
        Attempts.AddOrUpdate(
            key,
            _ => (1, DateTime.UtcNow),
            (_, entry) => DateTime.UtcNow - entry.WindowStart > Window
                ? (1, DateTime.UtcNow)
                : (entry.Failures + 1, entry.WindowStart));
    }

    public void RecordSuccess(string key)
        => Attempts.TryRemove(key ?? "unknown", out _);
}
