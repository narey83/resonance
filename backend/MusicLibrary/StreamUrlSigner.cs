// <copyright file="StreamUrlSigner.cs" company="John Narey">
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

namespace resonance.MusicLibrary
{
    using System;
    using System.Security.Cryptography;
    using System.Text;

    /// <summary>
    ///     Produces and validates short-lived, path-scoped HMAC signatures for stream and
    ///     artwork URLs. This lets clients fetch media without carrying their (account) JWT
    ///     in the URL: the server signs <c>path</c> + an expiry, and the endpoints validate
    ///     the signature instead of a bearer token. A leaked URL only exposes one file until
    ///     it expires, and clients can never forge a signature for an arbitrary filesystem
    ///     path (the signing key never leaves the server).
    /// </summary>
    public sealed class StreamUrlSigner
    {
        // Domain-separated subkey derived from the JWT signing secret so it rotates with the
        // JWT key and needs no separate secret management. Bump the label to invalidate all
        // outstanding signatures.
        private const string KeyDerivationLabel = "resonance-stream-url-v1";

        private readonly byte[] key;
        private readonly long ttlSeconds;

        /// <summary>
        ///     Initializes a new instance of the <see cref="StreamUrlSigner"/> class.
        /// </summary>
        /// <param name="jwtSigningKey">The application's JWT signing secret.</param>
        /// <param name="ttlMilliseconds">How long a freshly issued signature stays valid.</param>
        public StreamUrlSigner(string jwtSigningKey, long ttlMilliseconds)
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(jwtSigningKey ?? string.Empty));
            key = hmac.ComputeHash(Encoding.UTF8.GetBytes(KeyDerivationLabel));
            ttlSeconds = Math.Max(1, ttlMilliseconds / 1000);
        }

        /// <summary>
        ///     Signs <paramref name="path"/>, returning the expiry (unix seconds) and signature
        ///     to append to a stream/artwork URL as <c>&amp;exp=...&amp;sig=...</c>.
        /// </summary>
        /// <returns>The expiry, in unix seconds, and the signature.</returns>
        public (long Exp, string Sig) Sign(string path)
        {
            var exp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + ttlSeconds;
            return (exp, Compute(path, exp));
        }

        /// <summary>
        ///     Validates a signature for <paramref name="path"/>. Returns false if the signature
        ///     is malformed, expired, or does not match (constant-time comparison).
        /// </summary>
        /// <returns>A value indicating whether the signature is valid and unexpired.</returns>
        public bool Validate(string path, long exp, string? sig)
        {
            if (string.IsNullOrEmpty(sig) || path is null)
            {
                return false;
            }

            if (exp < DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                return false;
            }

            var expected = Encoding.ASCII.GetBytes(Compute(path, exp));
            var provided = Encoding.ASCII.GetBytes(sig);
            return CryptographicOperations.FixedTimeEquals(expected, provided);
        }

        private static string Base64Url(byte[] bytes)
            => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private string Compute(string path, long exp)
        {
            var payload = Encoding.UTF8.GetBytes($"{path}\n{exp}");
            var hash = HMACSHA256.HashData(key, payload);
            return Base64Url(hash);
        }
    }
}
