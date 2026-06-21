// <copyright file="TokenResponse.cs" company="JP Dillingham">
//           ▄▄▄▄     ▄▄▄▄     ▄▄▄▄
//     ▄▄▄▄▄▄█  █▄▄▄▄▄█  █▄▄▄▄▄█  █
//     █__ --█  █__ --█    ◄█  -  █
//     █▄▄▄▄▄█▄▄█▄▄▄▄▄█▄▄█▄▄█▄▄▄▄▄█
//   ┍━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━ ━  ━┉   ┉     ┉
//   │ Copyright (c) JP Dillingham.
//   │ Copyright (c) 2026 John Narey.
//   │ Modified as part of Resonance, a modified version of slskd;
//   │ see the project repository for the nature of the changes.
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

namespace resonance.Core.API
{
    using System;
    using System.IdentityModel.Tokens.Jwt;
    using System.Linq;
    using System.Security.Claims;
    using System.Text.Json.Serialization;
    using Microsoft.AspNetCore.Authentication.JwtBearer;

    public class TokenResponse
    {
        public TokenResponse(JwtSecurityToken jwtSecurityToken, string refreshToken = null, Guid? sessionId = null)
        {
            JwtSecurityToken = jwtSecurityToken;
            RefreshToken = refreshToken;
            SessionId = sessionId;
        }

        /// <summary>
        ///     Gets the time at which the Access Token expires.
        /// </summary>
        public long Expires => ((DateTimeOffset)JwtSecurityToken.ValidTo).ToUnixTimeSeconds();

        /// <summary>
        ///     Gets the time at which the Access Token was issued.
        /// </summary>
        public long Issued => ((DateTimeOffset)JwtSecurityToken.ValidFrom).ToUnixTimeSeconds();

        /// <summary>
        ///     Gets the value of the Name claim from the Access Token.
        /// </summary>
        public string Name => JwtSecurityToken.Claims.SingleOrDefault(c => c.Type == ClaimTypes.Name)?.Value;

        /// <summary>
        ///     Gets the value of the Not Before claim from the Access Token.
        /// </summary>
        public long NotBefore => long.Parse(JwtSecurityToken.Claims.SingleOrDefault(c => c.Type == "nbf")?.Value ?? long.MaxValue.ToString());

        /// <summary>
        ///     Gets the opaque refresh token. Only present on login and token refresh responses.
        ///     Store securely (Keychain / Keystore) and use with POST /session/refresh to obtain
        ///     a new access token without re-entering credentials.
        /// </summary>
        public string RefreshToken { get; }

        /// <summary>
        ///     Gets the ID of the session created by this login. Use it to identify and revoke this specific session.
        /// </summary>
        public Guid? SessionId { get; }

        /// <summary>
        ///     Gets the Access Token string.
        /// </summary>
        public string Token => new JwtSecurityTokenHandler().WriteToken(JwtSecurityToken);

        /// <summary>
        ///     Gets the Token type.
        /// </summary>
        public string TokenType => JwtBearerDefaults.AuthenticationScheme;

        [JsonIgnore]
        private JwtSecurityToken JwtSecurityToken { get; }
    }
}