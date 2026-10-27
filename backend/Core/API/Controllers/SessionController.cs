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
    using System.Text.Json.Serialization;
    using System.Threading.Tasks;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.AspNetCore.SignalR;
    using Microsoft.Extensions.Options;
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
            MobilePairingService mobilePairingService,
            IOptionsSnapshot<resonance.Options> optionsSnapshot,
            IHubContext<ApplicationHub> hub)
        {
            Security = securityService;
            Users = userService;
            Sessions = sessionService;
            LoginAttempts = loginRateLimiter;
            Pairing = mobilePairingService;
            OptionsSnapshot = optionsSnapshot;
            Hub = hub;
        }

        private SecurityService Security { get; }
        private AppUserService Users { get; }
        private SessionService Sessions { get; }
        private LoginRateLimiter LoginAttempts { get; }
        private MobilePairingService Pairing { get; }
        private IOptionsSnapshot<resonance.Options> OptionsSnapshot { get; }
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

            var (refreshToken, sessionId) = Sessions.CreateSession(user.Username, request.DeviceName, request.DeviceId, GetCallerIp(), request.ExistingSessionId);
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
            if (login == default)
            {
                return BadRequest("Username and password are required");
            }

            var (token, error) = IssueToken(login.Username, login.Password, login.DeviceName, login.DeviceId, login.ExistingSessionId);
            return error ?? Ok(token);
        }

        /// <summary>
        ///     OAuth2 password-grant token endpoint, consumed by the Swagger UI "Authorize" dialog so it can
        ///     prompt for a username and password directly. Returns an OAuth2-shaped token response.
        /// </summary>
        /// <returns></returns>
        [HttpPost]
        [Route("token")]
        [AllowAnonymous]
        [Consumes("application/x-www-form-urlencoded")]
        [ProducesResponseType(typeof(OAuthTokenResponse), 200)]
        [ProducesResponseType(400)]
        [ProducesResponseType(401)]
        [ProducesResponseType(429)]
        public IActionResult Token([FromForm] OAuthTokenRequest request)
        {
            var (token, error) = IssueToken(request?.Username, request?.Password, deviceName: "Swagger UI", deviceId: null, existingSessionId: null);
            if (error is not null)
            {
                return error;
            }

            return Ok(new OAuthTokenResponse
            {
                AccessToken = token.Token,
                TokenType = "Bearer",
                ExpiresIn = token.Expires - DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                RefreshToken = token.RefreshToken,
            });
        }

        /// <summary>
        ///     Issues a short-lived, single-use code that a phone can redeem for a session by
        ///     scanning the QR code the web UI renders from it.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The code was issued.</response>
        /// <response code="403">Mobile pairing is disabled.</response>
        [HttpPost]
        [Route("pair")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(PairingResponse), 200)]
        [ProducesResponseType(403)]
        public IActionResult CreatePairing()
        {
            if (!OptionsSnapshot.Value.Web.MobilePairing)
            {
                return Forbid();
            }

            var username = HttpContext.User.Identity?.Name;

            if (string.IsNullOrWhiteSpace(username))
            {
                return Unauthorized();
            }

            // One live code per user: showing a new QR should retire the previous one, so a stale
            // screenshot or a still-open browser tab can't be redeemed later.
            Pairing.RevokeFor(username);

            var (code, expiresAt) = Pairing.Create(username);

            Log.Information("Issued a mobile pairing code for {Username} from {IP}", username, GetCallerIp());
            return Ok(new PairingResponse(code, expiresAt, (int)MobilePairingService.Lifetime.TotalSeconds));
        }

        /// <summary>
        ///     Reports whether a pairing code has been redeemed, so the page showing its QR can stop
        ///     showing it and say which device picked it up.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The status was returned.</response>
        /// <response code="404">The code is unknown or has aged out.</response>
        [HttpGet]
        [Route("pair/status")]
        [Authorize(Policy = AuthPolicy.Any)]
        [ProducesResponseType(typeof(MobilePairingService.PairingStatus), 200)]
        [ProducesResponseType(404)]
        public IActionResult GetPairingStatus([FromQuery] string code)
        {
            var status = Pairing.Status(code);

            return status is null ? NotFound() : Ok(status);
        }

        /// <summary>
        ///     Redeems a pairing code for a session.
        /// </summary>
        /// <returns></returns>
        /// <response code="200">The code was redeemed and a session issued.</response>
        /// <response code="401">The code is unknown, already used or expired.</response>
        /// <response code="403">Mobile pairing is disabled.</response>
        [HttpPost]
        [Route("pair/redeem")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(TokenResponse), 200)]
        [ProducesResponseType(401)]
        [ProducesResponseType(403)]
        [ProducesResponseType(429)]
        public IActionResult RedeemPairing([FromBody] RedeemPairingRequest request)
        {
            if (!OptionsSnapshot.Value.Web.MobilePairing)
            {
                return Forbid();
            }

            var callerIp = GetCallerIp();

            // Redemption is anonymous by necessity, so it is rate limited exactly like a login;
            // otherwise it is an unauthenticated endpoint that hands out sessions to whoever
            // guesses hardest.
            if (LoginAttempts.IsBlocked(callerIp))
            {
                return StatusCode(429, "Too many failed attempts; try again later");
            }

            var username = Pairing.Redeem(request?.Code, request?.DeviceName);

            if (username is null)
            {
                LoginAttempts.RecordFailure(callerIp);
                Log.Warning("Mobile pairing redemption failed from {IP}", callerIp);
                return Unauthorized();
            }

            var user = Users.Get(username);

            if (user is null)
            {
                Log.Warning("Mobile pairing code redeemed for unknown user {Username}", username);
                return Unauthorized();
            }

            LoginAttempts.RecordSuccess(callerIp);

            var (refreshToken, sessionId) = Sessions.CreateSession(
                user.Username,
                string.IsNullOrWhiteSpace(request.DeviceName) ? "Mobile (paired)" : request.DeviceName,
                request.DeviceId,
                callerIp,
                existingSessionId: null);

            var jwt = Security.GenerateJwt(user.Username, user.Role, sessionId: sessionId);

            Log.Information("Mobile pairing completed for {Username} from {IP}", user.Username, callerIp);
            return Ok(new TokenResponse(jwt, refreshToken, sessionId));
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
                if (user is null)
                {
                    return Unauthorized();
                }

                var role = user.Role;
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
                    DeviceId = s.DeviceId,
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

        private (TokenResponse Token, IActionResult Error) IssueToken(string username, string password, string deviceName, string deviceId, Guid? existingSessionId)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            {
                return (null, BadRequest("Username and password are required"));
            }

            var callerIp = GetCallerIp();

            if (LoginAttempts.IsBlocked(callerIp))
            {
                Log.Warning("Login attempt blocked for user {Username} from {IP}: too many failed attempts", username, callerIp);
                return (null, StatusCode(429, "Too many failed login attempts; try again later"));
            }

            var user = Users.Authenticate(username, password);
            if (user is null)
            {
                LoginAttempts.RecordFailure(callerIp);
                Log.Warning("Login failed for user {Username} from {IP}", username, callerIp);
                return (null, Unauthorized());
            }

            LoginAttempts.RecordSuccess(callerIp);

            var (refreshToken, sessionId) = Sessions.CreateSession(user.Username, deviceName, deviceId, callerIp, existingSessionId);
            var jwt = Security.GenerateJwt(user.Username, user.Role, sessionId: sessionId);
            Log.Information("Login succeeded for user {Username} from {IP}", user.Username, callerIp);
            return (new TokenResponse(jwt, refreshToken, sessionId), null);
        }

        private string GetCallerIp()
        {
            // UseForwardedHeaders (configured in Program.cs, trusting only the private proxy network)
            // has already resolved RemoteIpAddress to the genuine client, so read it directly rather
            // than re-parsing X-Forwarded-For — which any client can spoof when read unconditionally.
            var ip = HttpContext.Connection.RemoteIpAddress;
            if (ip is not null && ip.IsIPv4MappedToIPv6)
            {
                ip = ip.MapToIPv4();
            }

            return ip?.ToString();
        }
    }

    public record RefreshRequest(string RefreshToken);

    /// <summary>
    ///     A freshly issued mobile pairing code. `expiresIn` lets the UI count down without
    ///     depending on the browser clock agreeing with the server's.
    /// </summary>
    public record PairingResponse(string Code, DateTime ExpiresAtUtc, int ExpiresIn);

    /// <summary>
    ///     A request to exchange a pairing code for a session.
    /// </summary>
    public record RedeemPairingRequest(string Code, string DeviceName, string DeviceId);
    public record LogoutRequest(string RefreshToken);

    /// <summary>
    ///     Form body for the OAuth2 password-grant token endpoint (sent by the Swagger UI Authorize dialog).
    /// </summary>
    public class OAuthTokenRequest
    {
        [FromForm(Name = "grant_type")]
        public string GrantType { get; set; }

        [FromForm(Name = "username")]
        public string Username { get; set; }

        [FromForm(Name = "password")]
        public string Password { get; set; }
    }

    /// <summary>
    ///     OAuth2-shaped token response expected by the Swagger UI Authorize dialog.
    /// </summary>
    public class OAuthTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; set; }

        [JsonPropertyName("token_type")]
        public string TokenType { get; set; }

        [JsonPropertyName("expires_in")]
        public long ExpiresIn { get; set; }

        [JsonPropertyName("refresh_token")]
        public string RefreshToken { get; set; }
    }

    public class SessionInfo
    {
        public Guid Id { get; set; }
        public string Username { get; set; }
        public string DeviceName { get; set; }
        public string DeviceId { get; set; }
        public string IpAddress { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime LastUsedAt { get; set; }
        public DateTime ExpiresAt { get; set; }
    }
}
