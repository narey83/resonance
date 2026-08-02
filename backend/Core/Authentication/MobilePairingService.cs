// <copyright file="MobilePairingService.cs" company="John Narey">
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

namespace resonance.Authentication
{
    using System;
    using System.Collections.Concurrent;
    using System.Security.Cryptography;

    /// <summary>
    ///     Issues and redeems short-lived, single-use codes that let a phone acquire a session by
    ///     scanning a QR code shown in the web UI.
    /// </summary>
    /// <remarks>
    ///     The code stands in for a login, so it is treated like one: it carries no credentials, it
    ///     is bound to the user who generated it, it expires, and it can be redeemed exactly once. A
    ///     QR containing a username and password would instead hand over the account permanently to
    ///     anyone who photographed the screen.
    ///
    ///     Codes live in memory only. They are worthless after a few minutes, so surviving a restart
    ///     buys nothing, and keeping them out of the database means a backup can't leak one. A
    ///     redeemed code is kept (marked, not deleted) until it expires, purely so the page that
    ///     issued it can report which device picked it up; it cannot be redeemed twice.
    /// </remarks>
    public class MobilePairingService
    {
        /// <summary>
        ///     How long a code remains redeemable.
        /// </summary>
        public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

        private readonly ConcurrentDictionary<string, Pairing> pairings = new(StringComparer.Ordinal);

        /// <summary>
        ///     Creates a code that will grant a session for <paramref name="username"/>.
        /// </summary>
        /// <param name="username">The user the redeemed session will belong to.</param>
        /// <returns>The code and the instant it stops being redeemable.</returns>
        public (string Code, DateTime ExpiresAtUtc) Create(string username)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(username);

            Prune();

            // 32 bytes of CSPRNG output, url-safe. Long enough that guessing is hopeless, which
            // matters because redemption is necessarily anonymous — the caller is a phone that has
            // no session yet, so there is nothing else to authenticate it by.
            var code = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .Replace('+', '-')
                .Replace('/', '_')
                .TrimEnd('=');

            var expiresAt = DateTime.UtcNow.Add(Lifetime);
            pairings[code] = new Pairing(username, expiresAt);

            return (code, expiresAt);
        }

        /// <summary>
        ///     Redeems a code, returning the username it was issued for. A code works exactly once.
        /// </summary>
        /// <param name="code">The code to redeem.</param>
        /// <param name="deviceName">The name of the device redeeming it, reported back to the issuer.</param>
        /// <returns>The username, or null when the code is unknown, already used or expired.</returns>
        public string Redeem(string code, string deviceName = null)
        {
            if (string.IsNullOrWhiteSpace(code) || !pairings.TryGetValue(code, out var pairing))
            {
                return null;
            }

            var now = DateTime.UtcNow;

            if (pairing.RedeemedAtUtc is not null || pairing.ExpiresAtUtc <= now)
            {
                return null;
            }

            // Compare-and-swap rather than remove: the entry has to survive redemption so the page
            // showing the QR can see that it succeeded and say which device it was. Single use is
            // preserved by the RedeemedAtUtc check plus this swap — two concurrent redemptions of
            // the same code cannot both win it, since only one can match `pairing` by reference.
            var redeemed = pairing with { RedeemedAtUtc = now, DeviceName = deviceName };

            return pairings.TryUpdate(code, redeemed, pairing) ? pairing.Username : null;
        }

        /// <summary>
        ///     Reports whether a code has been redeemed, and by what.
        /// </summary>
        /// <param name="code">The code to look up.</param>
        /// <returns>The status, or null when the code is unknown or has aged out.</returns>
        public PairingStatus Status(string code)
        {
            if (string.IsNullOrWhiteSpace(code) || !pairings.TryGetValue(code, out var pairing))
            {
                return null;
            }

            return new PairingStatus(pairing.RedeemedAtUtc is not null, pairing.DeviceName, pairing.RedeemedAtUtc);
        }

        /// <summary>
        ///     Discards any codes issued for the given user, e.g. when one is superseded.
        /// </summary>
        /// <param name="username">The user whose codes should be discarded.</param>
        public void RevokeFor(string username)
        {
            foreach (var entry in pairings)
            {
                if (string.Equals(entry.Value.Username, username, StringComparison.OrdinalIgnoreCase))
                {
                    pairings.TryRemove(entry.Key, out _);
                }
            }
        }

        private void Prune()
        {
            var now = DateTime.UtcNow;

            foreach (var entry in pairings)
            {
                if (entry.Value.ExpiresAtUtc <= now)
                {
                    pairings.TryRemove(entry.Key, out _);
                }
            }
        }

        /// <summary>
        ///     What has become of a code, for the page that is showing its QR.
        /// </summary>
        public record PairingStatus(bool Redeemed, string DeviceName, DateTime? RedeemedAtUtc);

        private record Pairing(string Username, DateTime ExpiresAtUtc)
        {
            public DateTime? RedeemedAtUtc { get; init; }

            public string DeviceName { get; init; }
        }
    }
}
