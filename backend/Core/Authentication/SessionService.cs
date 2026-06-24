// <copyright file="SessionService.cs" company="John Narey">
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
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Serilog;

public class SessionService
{
    public SessionService(IDbContextFactory<UsersDbContext> contextFactory, OptionsAtStartup optionsAtStartup)
    {
        ContextFactory = contextFactory;
        Options = optionsAtStartup;
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Sessions.Auth);
    private IDbContextFactory<UsersDbContext> ContextFactory { get; }
    private OptionsAtStartup Options { get; }

    // Session IDs revoked since this process started, so JWTs issued for them can be rejected
    // before they expire naturally. In-memory only: after a restart pre-existing JWTs can't be
    // checked, but they age out within the JWT TTL plus validation clock skew.
    private ConcurrentDictionary<Guid, DateTime> RevokedSessionCache { get; } = new();

    /// <summary>
    ///     Creates a new session for the given user and returns the opaque refresh token and session ID.
    ///     Only the SHA-256 hash of the token is stored; the plaintext is never persisted.
    ///     Any existing active session for the same (username, deviceName) or matching existingSessionId is revoked before creating the new one.
    /// </summary>
    /// <returns></returns>
    public (string RefreshToken, Guid SessionId) CreateSession(string username, string deviceName = null, string ipAddress = null, Guid? existingSessionId = null)
    {
        var token = GenerateToken();
        var ttlMs = Options.Web.Authentication.Jwt.RefreshTokenTtl;
        var session = new UserSession
        {
            Username = username,
            RefreshTokenHash = HashToken(token),
            DeviceName = deviceName,
            IpAddress = ipAddress,
            ExpiresAt = DateTime.UtcNow.AddMilliseconds(ttlMs),
        };

        using var db = ContextFactory.CreateDbContext();

        // Revoke by explicit session ID first — survives device name changes (e.g. localStorage cleared, app reinstall)
        if (existingSessionId.HasValue)
        {
            var previous = db.Sessions.FirstOrDefault(s => s.Id == existingSessionId.Value && s.Username == username && !s.IsRevoked);
            if (previous is not null)
            {
                previous.IsRevoked = true;
                CacheRevocation(previous.Id);
            }
        }

        // Belt-and-suspenders: also revoke by device name in case the session ID wasn't stored
        if (!string.IsNullOrWhiteSpace(deviceName))
        {
            var superseded = db.Sessions
                .Where(s => s.Username == username && s.DeviceName == deviceName && !s.IsRevoked && s.ExpiresAt > DateTime.UtcNow && s.Id != existingSessionId)
                .ToList();
            superseded.ForEach(s =>
            {
                s.IsRevoked = true;
                CacheRevocation(s.Id);
            });
        }

        db.Sessions.Add(session);
        db.SaveChanges();

        return (token, session.Id);
    }

    /// <summary>
    ///     Validates a refresh token and rotates it in place: the existing session record is updated
    ///     with a new token hash, keeping the same session ID. Returns the username, the new refresh
    ///     token, and the stable session ID.
    ///     Throws UnauthorizedException if the token is unknown, revoked, or expired.
    ///     If a previously rotated token is presented, all of the user's sessions are revoked
    ///     (theft detection): a replayed old token means either an attacker or the legitimate
    ///     client holds a stale copy, and it's impossible to tell which party got the new one.
    /// </summary>
    /// <returns></returns>
    public (string Username, string NewRefreshToken, Guid SessionId) RotateRefreshToken(string refreshToken)
    {
        var hash = HashToken(refreshToken);

        using var db = ContextFactory.CreateDbContext();
        var session = db.Sessions.FirstOrDefault(s => s.RefreshTokenHash == hash);

        if (session is null)
        {
            // not a current token for any session — check whether it's a rotated-away token being replayed
            var replayed = db.Sessions.FirstOrDefault(s => s.PreviousTokenHash == hash);
            if (replayed is not null)
            {
                Log.Warning("Previously rotated refresh token replayed for user {Username}; revoking all sessions (possible token theft)", replayed.Username);
                foreach (var id in RevokeAllSessions(replayed.Username, db))
                {
                    CacheRevocation(id);
                }

                throw new UnauthorizedException("Refresh token reuse detected");
            }

            throw new UnauthorizedException("Invalid refresh token");
        }

        if (session.IsRevoked)
        {
            // A revoked token was presented — could be an old token after logout or a superseded session.
            Log.Warning("Revoked refresh token presented for user {Username}", session.Username);
            throw new UnauthorizedException("Refresh token has been revoked");
        }

        if (session.ExpiresAt < DateTime.UtcNow)
        {
            throw new UnauthorizedException("Refresh token has expired");
        }

        // Idle timeout: a live client refreshes within each JWT TTL window. A session whose token
        // hasn't been used within the idle window is dead (e.g. a one-off credential/API login) —
        // revoke it rather than silently reviving it, so it can't linger for the full refresh TTL.
        if (session.LastUsedAt < DateTime.UtcNow.AddMilliseconds(-Options.Web.Authentication.Jwt.IdleTimeout))
        {
            session.IsRevoked = true;
            db.SaveChanges();
            CacheRevocation(session.Id);
            Log.Warning("Idle refresh token presented for user {Username}; session revoked", session.Username);
            throw new UnauthorizedException("Session has expired due to inactivity");
        }

        // Update the session in place — same ID, new token hash, sliding expiry.
        // The old hash is retained so a replay of the rotated-away token can be detected above.
        var newToken = GenerateToken();
        var ttlMs = Options.Web.Authentication.Jwt.RefreshTokenTtl;
        session.PreviousTokenHash = session.RefreshTokenHash;
        session.RefreshTokenHash = HashToken(newToken);
        session.LastUsedAt = DateTime.UtcNow;
        session.ExpiresAt = DateTime.UtcNow.AddMilliseconds(ttlMs);
        db.SaveChanges();

        return (session.Username, newToken, session.Id);
    }

    /// <summary>
    ///     Revokes the session identified by the given refresh token (logout).
    ///     Returns the session ID if found, otherwise null.
    /// </summary>
    /// <returns></returns>
    public Guid? RevokeByToken(string refreshToken)
    {
        var hash = HashToken(refreshToken);

        using var db = ContextFactory.CreateDbContext();
        var session = db.Sessions.FirstOrDefault(s => s.RefreshTokenHash == hash && !s.IsRevoked);

        if (session is not null)
        {
            session.IsRevoked = true;
            db.SaveChanges();
            CacheRevocation(session.Id);
            return session.Id;
        }

        return null;
    }

    /// <summary>
    ///     Revokes a specific session by its ID, scoped to the given username.
    /// </summary>
    public void RevokeById(string username, Guid sessionId)
    {
        using var db = ContextFactory.CreateDbContext();
        var session = db.Sessions.FirstOrDefault(s => s.Id == sessionId && s.Username == username && !s.IsRevoked);

        if (session is not null)
        {
            session.IsRevoked = true;
            db.SaveChanges();
            CacheRevocation(session.Id);
        }
    }

    /// <summary>
    ///     Revokes all active sessions for the given user and returns their IDs.
    /// </summary>
    /// <returns></returns>
    public IEnumerable<Guid> RevokeAll(string username)
    {
        using var db = ContextFactory.CreateDbContext();
        var ids = RevokeAllSessions(username, db).ToList();
        ids.ForEach(CacheRevocation);
        return ids;
    }

    /// <summary>
    ///     Returns true if the given session has been revoked since this process started.
    ///     Used to reject JWTs bound to a revoked session before the JWT expires naturally.
    /// </summary>
    /// <returns></returns>
    public bool IsJwtRevoked(Guid sessionId)
    {
        PruneRevocationCache();
        return RevokedSessionCache.ContainsKey(sessionId);
    }

    /// <summary>
    ///     Returns all live sessions for the given user: non-revoked, non-expired, and used within the
    ///     idle-timeout window. A live client silently refreshes its JWT within each TTL window, so a
    ///     session idle beyond the configured <c>Jwt.IdleTimeout</c> is effectively dead and excluded.
    /// </summary>
    /// <returns></returns>
    public IEnumerable<UserSession> GetActiveSessions(string username)
    {
        var idleCutoff = DateTime.UtcNow.AddMilliseconds(-Options.Web.Authentication.Jwt.IdleTimeout);

        using var db = ContextFactory.CreateDbContext();
        return db.Sessions
            .Where(s => s.Username == username && !s.IsRevoked && s.ExpiresAt > DateTime.UtcNow && s.LastUsedAt > idleCutoff)
            .OrderByDescending(s => s.LastUsedAt)
            .ToList();
    }

    /// <summary>
    ///     Deletes all expired, revoked, and idle sessions from the database.
    ///     Called once on startup to keep the table lean.
    /// </summary>
    public void CleanupExpiredSessions()
    {
        var idleCutoff = DateTime.UtcNow.AddMilliseconds(-Options.Web.Authentication.Jwt.IdleTimeout);

        using var db = ContextFactory.CreateDbContext();
        var stale = db.Sessions
            .Where(s => s.IsRevoked || s.ExpiresAt < DateTime.UtcNow || s.LastUsedAt < idleCutoff)
            .ToList();

        if (stale.Count > 0)
        {
            db.Sessions.RemoveRange(stale);
            db.SaveChanges();
            Log.Information("Cleaned up {Count} expired or revoked session(s)", stale.Count);
        }
    }

    private static IEnumerable<Guid> RevokeAllSessions(string username, UsersDbContext db)
    {
        var sessions = db.Sessions.Where(s => s.Username == username && !s.IsRevoked).ToList();
        sessions.ForEach(s => s.IsRevoked = true);
        db.SaveChanges();
        return sessions.Select(s => s.Id).ToList();
    }

    private static string GenerateToken()
    {
        var bytes = new byte[32];
        RandomNumberGenerator.Fill(bytes);
        return Convert.ToBase64String(bytes);
    }

    private static string HashToken(string token)
        => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private void CacheRevocation(Guid sessionId) => RevokedSessionCache[sessionId] = DateTime.UtcNow;

    private void PruneRevocationCache()
    {
        // entries only need to outlive the longest JWT (access token TTL) plus the bearer validation clock skew (5 minutes)
        var retention = TimeSpan.FromMilliseconds(Options.Web.Authentication.Jwt.Ttl) + TimeSpan.FromMinutes(5);
        var cutoff = DateTime.UtcNow - retention;

        foreach (var entry in RevokedSessionCache.Where(e => e.Value < cutoff).ToList())
        {
            RevokedSessionCache.TryRemove(entry.Key, out _);
        }
    }
}
