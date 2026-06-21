// <copyright file="SessionController.cs" company="JP Dillingham">
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
    using System.Collections.Generic;
    using System.Linq;
    using System.Net;
    using System.Security.Claims;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using resonance.Authentication;
    using Serilog;

    /// <summary>
    ///     Session.
    /// </summary>
    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class SessionController : ControllerBase
    {
        public SessionController(
            SecurityService securityService,
            AppUserService userService,
            SessionService sessionService,
            LoginRateLimiter loginRateLimiter,
            IHubContext<ApplicationHub> hub)
        {
            Security = securityService;
            Users = userService;
            Sessions = sessionService;
            LoginAttempts = loginRateLimiter;
            Hub = hub;
        }

        private SecurityService Security { get; }
        private AppUserService Users { get; }
        private SessionService Sessions { get; }
        private LoginRateLimiter LoginAttempts { get; }
        private IHubContext<ApplicationHub> Hub { get; }
        private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Sessions.Auth);

        /// <summary>
        ///     Checks whether the provided authentication is valid.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(401)]
        public IActionResult Check()
        {
            return Ok();
        }

        /// <summary>
        ///     Returns whether an app account has been created yet.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("initialized")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(bool), 200)]
        public IActionResult Initialized()
        {
            return Ok(Users.IsInitialized());
        }

        /// <summary>
        ///     Creates the first app account. Only succeeds when no account exists yet.
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [Route("setup")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(TokenResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(409)]
        public IActionResult Setup([FromBody] LoginRequest request)
        {
            if (request == default || string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            {
                return BadRequest("Username and password are required");
            }

            if (Users.IsInitialized())
            {
                return Conflict("An account already exists");
            }

            var user = Users.Create(request.Username, request.Password, Role.Administrator);

            var (refreshToken, sessionId) = Sessions.CreateSession(user.Username, request.DeviceName, GetCallerIp(), request.ExistingSessionId);
            var jwt = Security.GenerateJwt(user.Username, user.Role, sessionId: sessionId);
            return Ok(new TokenResponse(jwt, refreshToken, sessionId));
        }

        /// <summary>
        ///     Logs in and returns a JWT access token and a refresh token.
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [Route("")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(TokenResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(401)]
        [ProducesResponseType(429)]
        public IActionResult Login([FromBody] LoginRequest login)
        {
            if (login == default || string.IsNullOrWhiteSpace(login.Username) || string.IsNullOrWhiteSpace(login.Password))
            {
                return BadRequest("Username and password are required");
            }

            var callerIp = GetCallerIp();

            if (LoginAttempts.IsBlocked(callerIp))
            {
                Log.Warning("Login attempt blocked for user {Username} from {IP}: too many failed attempts", login.Username, callerIp);
                return StatusCode(429, "Too many failed login attempts; try again later");
            }

            var user = Users.Authenticate(login.Username, login.Password);
            if (user is null)
            {
                LoginAttempts.RecordFailure(callerIp);
                Log.Warning("Login failed for user {Username} from {IP}", login.Username, callerIp);
                return Unauthorized();
            }

            LoginAttempts.RecordSuccess(callerIp);

            var (refreshToken, sessionId) = Sessions.CreateSession(user.Username, login.DeviceName, callerIp, login.ExistingSessionId);
            var jwt = Security.GenerateJwt(user.Username, user.Role, sessionId: sessionId);
            return Ok(new TokenResponse(jwt, refreshToken, sessionId));
        }

        private string GetCallerIp()
        {
            var ip = HttpContext.Connection.RemoteIpAddress;
            if (ip is not null && ip.IsIPv4MappedToIPv6)
            {
                ip = ip.MapToIPv4();
            }

            // Only trust X-Forwarded-For when the direct peer is the local machine (reverse proxy
            // or dev server on the same host); any remote client can set the header to an arbitrary value.
            var forwarded = Request.Headers["X-Forwarded-For"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(forwarded) && ip is not null && IPAddress.IsLoopback(ip))
            {
                return forwarded.Split(',')[0].Trim();
            }

            return ip?.ToString();
        }

        /// <summary>
        ///     Issues a new access token and rotates the refresh token.
        ///     The old refresh token is immediately invalidated; store the new one.
        ///     If a previously rotated token is presented, all sessions are revoked (theft detection).
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [Route("refresh")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(TokenResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(401)]
        public IActionResult Refresh([FromBody] RefreshRequest request)
        {
            if (request == default || string.IsNullOrWhiteSpace(request.RefreshToken))
            {
                return BadRequest("Refresh token is required");
            }

            try
            {
                var (username, newRefreshToken, sessionId) = Sessions.RotateRefreshToken(request.RefreshToken);
                var user = Users.Get(username);
                var role = user?.Role ?? Role.ReadWrite;
                var jwt = Security.GenerateJwt(username, role, sessionId: sessionId);
                return Ok(new TokenResponse(jwt, newRefreshToken, sessionId));
            }
            catch (UnauthorizedException ex)
            {
                Log.Warning("Token refresh failed: {Message}", ex.Message);
                return Unauthorized();
            }
        }

        /// <summary>
        ///     Logs out by revoking the supplied refresh token.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpDelete]
        [Route("")]
        [AllowAnonymous]
        [ProducesResponseType(200)]
        [ProducesResponseType(400)]
        public async Task<IActionResult> Logout([FromBody] LogoutRequest request)
        {
            if (request == default || string.IsNullOrWhiteSpace(request.RefreshToken))
            {
                return BadRequest("Refresh token is required");
            }

            var sessionId = Sessions.RevokeByToken(request.RefreshToken);
            if (sessionId.HasValue)
            {
                await Hub.BroadcastSessionRevokedAsync(sessionId.Value);
            }

            return Ok();
        }

        /// <summary>
        ///     Returns all active sessions for the authenticated user.
        /// </summary>
        /// <returns></returns>
        [HttpGet]
        [Route("sessions")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(IEnumerable<SessionInfo>), 200)]
        [ProducesResponseType(401)]
        public IActionResult GetSessions()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var sessions = Sessions.GetActiveSessions(username);

            var result = new List<SessionInfo>();
            foreach (var s in sessions)
            {
                result.Add(new SessionInfo
                {
                    Id = s.Id,
                    Username = s.Username,
                    DeviceName = s.DeviceName,
                    IpAddress = s.IpAddress,
                    CreatedAt = DateTime.SpecifyKind(s.CreatedAt, DateTimeKind.Utc),
                    LastUsedAt = DateTime.SpecifyKind(s.LastUsedAt, DateTimeKind.Utc),
                    ExpiresAt = DateTime.SpecifyKind(s.ExpiresAt, DateTimeKind.Utc),
                });
            }

            return Ok(result);
        }

        /// <summary>
        ///     Revokes all active sessions for the authenticated user (emergency logout everywhere).
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpDelete]
        [Route("sessions")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(401)]
        public async Task<IActionResult> RevokeAllSessions()
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            var revokedIds = Sessions.RevokeAll(username).ToArray();
            Log.Information("All sessions revoked for user {Username}", username);
            if (revokedIds.Length > 0)
            {
                await Hub.BroadcastSessionRevokedAsync(revokedIds);
            }

            return Ok();
        }

        /// <summary>
        ///     Revokes a specific session by ID for the authenticated user.
        /// </summary>
        /// <returns>A <see cref="Task"/> representing the asynchronous operation.</returns>
        [HttpDelete]
        [Route("sessions/{id:guid}")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(200)]
        [ProducesResponseType(401)]
        public async Task<IActionResult> RevokeSession([FromRoute] Guid id)
        {
            var username = User.FindFirstValue(ClaimTypes.Name);
            Sessions.RevokeById(username, id);
            await Hub.BroadcastSessionRevokedAsync(id);
            return Ok();
        }
    }

    public record RefreshRequest(string RefreshToken);
    public record LogoutRequest(string RefreshToken);

    public class SessionInfo
    {
        public Guid Id { get; set; }
        public string Username { get; set; }
        public string DeviceName { get; set; }
        public string IpAddress { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime LastUsedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
    }
}
