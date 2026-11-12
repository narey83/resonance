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
using System.Threading;
using Microsoft.EntityFrameworkCore;
using Serilog;

public sealed class SessionService : IDisposable
{
    private static readonly TimeSpan RotationGracePeriod = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(30);

    public SessionService(IDbContextFactory<UsersDbContext> contextFactory, OptionsAtStartup optionsAtStartup)
    {
        ContextFactory = contextFactory;
        Options = optionsAtStartup;

        // Reap expired/revoked/idle sessions on a timer, not just at startup, so orphaned rows (e.g.
        // one-off API logins that never refresh) don't accumulate in the table between restarts.
        CleanupTimer = new Timer(_ => SafeCleanup(), state: null, dueTime: CleanupInterval, period: CleanupInterval);
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Sessions.Auth);
    private Timer CleanupTimer { get; }
    private IDbContextFactory<UsersDbContext> ContextFactory { get; }
    private OptionsAtStartup Options { get; }

    // Session IDs revoked since this process started, so JWTs issued for them can be rejected
    // before they expire naturally. In-memory only: after a restart pre-existing JWTs can't be
    // checked, but they age out within the JWT TTL plus validation clock skew.
    private ConcurrentDictionary<Guid, DateTime> RevokedSessionCache { get; } = new();

    // Tokens rotated within the last RotationGracePeriod, keyed by the hash of the token that
    // was superseded. Concurrent or retried refresh requests routinely replay the same token
    // that was just rotated away (several API calls hit a 401 at once, or a refresh response is
    // lost and the client retries). Handing each replay back the identical replacement token —
    // rather than treating it as theft — keeps those benign duplicates from tearing down the
    // session. In-memory only; a replay after a restart simply falls through to a normal 401.
    private ConcurrentDictionary<string, GraceEntry> RecentlyRotated { get; } = new();

    // Serialises the read-rotate-write critical section so that concurrent replays of the same
    // token queue behind the first rotation and observe its grace-cache entry, instead of each
    // racing to rotate independently. Refreshes are infrequent, so a single lock is ample.
    private object RotationLock { get; } = new();

    // Serialises the supersede-check-then-insert in CreateSession, so two near-simultaneous
    // logins from the same device can't both pass the "any existing session for this device?"
    // check before either has inserted its row, leaving two live sessions for one device. Logins
    // are infrequent, so a single lock is ample (same reasoning as RotationLock).
    private object CreationLock { get; } = new();

    /// <summary>
    ///     Creates a new session for the given user and returns the opaque refresh token and session ID.
    ///     Only the SHA-256 hash of the token is stored; the plaintext is never persisted.
    ///     Any existing active session matching existingSessionId, deviceId, or (as a fallback for
    ///     older clients that don't send a deviceId) deviceName is revoked before creating the new one.
    /// </summary>
    /// <returns></returns>
    public (string RefreshToken, Guid SessionId) CreateSession(string username, string deviceName = null, string deviceId = null, string ipAddress = null, Guid? existingSessionId = null)
    {
        var token = GenerateToken();
        var ttlMs = Options.Web.Authentication.Jwt.RefreshTokenTtl;
        var session = new UserSession
        {
            Username = username,
            RefreshTokenHash = HashToken(token),
            DeviceName = deviceName,
            DeviceId = deviceId,
            IpAddress = ipAddress,
            ExpiresAt = DateTime.UtcNow.AddMilliseconds(ttlMs),
        };

        lock (CreationLock)
        {
            using var db = ContextFactory.CreateDbContext();

            // Revoke by explicit session ID first — survives device identity changes entirely.
            if (existingSessionId.HasValue)
            {
                var previous = db.Sessions.FirstOrDefault(s => s.Id == existingSessionId.Value && s.Username == username && !s.IsRevoked);
                if (previous is not null)
                {
                    previous.IsRevoked = true;
                    CacheRevocation(previous.Id);
                }
            }

            // Primary device match: the stable per-install ID (Android ID / iOS identifierForVendor),
            // not affected by app reinstalls or local storage being cleared.
            IEnumerable<UserSession> superseded = Enumerable.Empty<UserSession>();
            if (!string.IsNullOrWhiteSpace(deviceId))
            {
                superseded = db.Sessions
                    .Where(s => s.Username == username && s.DeviceId == deviceId && !s.IsRevoked && s.ExpiresAt > DateTime.UtcNow && s.Id != existingSessionId)
                    .ToList();
            }
            else if (!string.IsNullOrWhiteSpace(deviceName))
            {
                // Fallback for clients that haven't sent a deviceId yet: match by the free-text
                // device name, which is what the old duplicate-session behaviour was keyed on.
                superseded = db.Sessions
                    .Where(s => s.Username == username && s.DeviceName == deviceName && !s.IsRevoked && s.ExpiresAt > DateTime.UtcNow && s.Id != existingSessionId)
                    .ToList();
            }

            foreach (var s in superseded)
            {
                s.IsRevoked = true;
                CacheRevocation(s.Id);
            }

            db.Sessions.Add(session);
            db.SaveChanges();
        }

        return (token, session.Id);
    }

    /// <summary>
    ///     Validates a refresh token and rotates it in place: the existing session record is updated
    ///     with a new token hash, keeping the same session ID. Returns the username, the new refresh
    ///     token, and the stable session ID.
    ///     Throws UnauthorizedException if the token is unknown, revoked, or expired.
    ///     A token that was rotated away within the last <see cref="RotationGracePeriod"/> is treated
    ///     as a benign concurrent/retried request and handed back the same replacement token. Only a
    ///     replay outside that window counts as reuse, and then just the affected session is revoked.
    /// </summary>
    /// <returns></returns>
    public (string Username, string NewRefreshToken, Guid SessionId) RotateRefreshToken(string refreshToken)
    {
        var hash = HashToken(refreshToken);

        // Serialise so concurrent replays of the same token queue behind the first rotation and
        // then observe its grace-cache entry rather than each racing to rotate independently.
        lock (RotationLock)
        {
            PruneGraceCache();

            // Concurrent/retried refresh: this exact token was rotated moments ago. Hand back the
            // identical replacement instead of tripping reuse detection, so the duplicate request
            // succeeds transparently and the session is left intact.
            if (RecentlyRotated.TryGetValue(hash, out var grace))
            {
                if (IsJwtRevoked(grace.SessionId))
                {
                    RecentlyRotated.TryRemove(hash, out _);
                    throw new RefreshTokenRejectedException("Session has been revoked", grace.Username, grace.SessionId);
                }

                Log.Debug("Refresh token replayed within grace window for user {Username}; reissuing same token", grace.Username);
                return (grace.Username, grace.NewToken, grace.SessionId);
            }

            using var db = ContextFactory.CreateDbContext();
            var session = db.Sessions.FirstOrDefault(s => s.RefreshTokenHash == hash);

            if (session is null)
            {
                // Not a current token for any session — check whether it's a rotated-away token being
                // replayed outside the grace window. Revoke only that session (a genuinely stale or
                // stolen token stops working) rather than logging the user out everywhere.
                var replayed = db.Sessions.FirstOrDefault(s => s.PreviousTokenHash == hash && !s.IsRevoked);
                if (replayed is not null)
                {
                    replayed.IsRevoked = true;
                    db.SaveChanges();
                    CacheRevocation(replayed.Id);

                    throw new RefreshTokenRejectedException("Refresh token reuse detected; affected session revoked", replayed);
                }

                throw new RefreshTokenRejectedException("Invalid refresh token");
            }

            if (session.IsRevoked)
            {
                // A revoked token was presented — could be an old token after logout or a superseded session.
                throw new RefreshTokenRejectedException("Refresh token has been revoked", session);
            }

            if (session.ExpiresAt < DateTime.UtcNow)
            {
                throw new RefreshTokenRejectedException("Refresh token has expired", session);
            }

            // Idle timeout: a live client refreshes within each JWT TTL window. A session whose token
            // hasn't been used within the idle window is dead (e.g. a one-off credential/API login) —
            // revoke it rather than silently reviving it, so it can't linger for the full refresh TTL.
            if (session.LastUsedAt < DateTime.UtcNow.AddMilliseconds(-Options.Web.Authentication.Jwt.IdleTimeout))
            {
                session.IsRevoked = true;
                db.SaveChanges();
                CacheRevocation(session.Id);
                throw new RefreshTokenRejectedException("Session has expired due to inactivity; session revoked", session);
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

            // Remember the just-superseded token so a concurrent or retried replay of it within the
            // grace window is answered with this same replacement instead of a reuse error.
            RecentlyRotated[hash] = new GraceEntry(newToken, session.Id, session.Username, DateTime.UtcNow);

            return (session.Username, newToken, session.Id);
        }
    }

    /// <summary>
    ///     Revokes the session identified by the given refresh token (logout).
    ///     Returns the session ID if found, otherwise null.
    /// </summary>
    /// <returns></returns>
    public Guid? RevokeByToken(string refreshToken)
    {
        lock (RotationLock)
        {
            var hash = HashToken(refreshToken);
            using var db = ContextFactory.CreateDbContext();
            var session = db.Sessions.FirstOrDefault(s =>
                (s.RefreshTokenHash == hash || s.PreviousTokenHash == hash) && !s.IsRevoked);

            if (session is null)
            {
                return null;
            }

            session.IsRevoked = true;
            db.SaveChanges();
            CacheRevocation(session.Id);
            return session.Id;
        }
    }

    /// <summary>
    ///     Revokes a specific session by its ID, scoped to the given username.
    /// </summary>
    /// <returns>Whether an owned active session was revoked.</returns>
    public bool RevokeById(string username, Guid sessionId)
    {
        using var db = ContextFactory.CreateDbContext();
        var session = db.Sessions.FirstOrDefault(s => s.Id == sessionId && s.Username == username && !s.IsRevoked);

        if (session is not null)
        {
            session.IsRevoked = true;
            db.SaveChanges();
            CacheRevocation(session.Id);
            return true;
        }

        return false;
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
    ///     Returns true for a revoked, missing, expired or no-longer-authorised session.
    ///     Used to reject JWTs bound to a revoked session before the JWT expires naturally.
    /// </summary>
    /// <returns></returns>
    public bool IsJwtRevoked(Guid sessionId, string username = null, string role = null)
    {
        PruneRevocationCache();
        if (RevokedSessionCache.ContainsKey(sessionId))
        {
            return true;
        }

        using var db = ContextFactory.CreateDbContext();
        var valid = from session in db.Sessions.AsNoTracking()
                    join user in db.Users.AsNoTracking() on session.Username equals user.Username
                    where session.Id == sessionId && !session.IsRevoked && session.ExpiresAt > DateTime.UtcNow
                    select new { session.Username, user.Role };
        var record = valid.FirstOrDefault();
        return record == null || (username != null && record.Username != username)
            || (role != null && record.Role.ToString() != role);
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
    ///     Validates the current refresh credential for the device's read-only background alert feed.
    ///     An active poll extends the idle clock, but not the refresh credential's absolute expiry.
    /// </summary>
    /// <returns>The current account role, or null if the credential is inactive.</returns>
    public string? GetCurrentRefreshTokenRole(string refreshToken)
    {
        if (string.IsNullOrWhiteSpace(refreshToken) || refreshToken.Length > 512)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var hash = HashToken(refreshToken);
        var idleCutoff = now.AddMilliseconds(-Options.Web.Authentication.Jwt.IdleTimeout);
        using var db = ContextFactory.CreateDbContext();
        var record = (from session in db.Sessions
                      join user in db.Users on session.Username equals user.Username
                      where session.RefreshTokenHash == hash && !session.IsRevoked &&
                          session.ExpiresAt > now && session.LastUsedAt > idleCutoff
                      select new { Session = session, user.Role }).FirstOrDefault();
        if (record is null)
        {
            return null;
        }

        if (record.Session.LastUsedAt < now.AddMinutes(-5))
        {
            record.Session.LastUsedAt = now;
            db.SaveChanges();
        }

        return record.Role.ToString();
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

    public void Dispose()
    {
        CleanupTimer?.Dispose();
        GC.SuppressFinalize(this);
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

    // Timer callback wrapper: cleanup runs on a background thread, so swallow and log any failure
    // rather than letting it escape onto the thread pool and crash the process.
    private void SafeCleanup()
    {
        try
        {
            CleanupExpiredSessions();
        }
        catch (Exception ex)
        {
            Log.Warning("Periodic session cleanup failed: {Message}", ex.Message);
        }
    }

    private void CacheRevocation(Guid sessionId)
    {
        RevokedSessionCache[sessionId] = DateTime.UtcNow;
        HubSecurityConnections.AbortSession(sessionId);
    }

    // Drops grace-cache entries older than the grace period. Called under RotationLock.
    private void PruneGraceCache()
    {
        var cutoff = DateTime.UtcNow - RotationGracePeriod;

        foreach (var entry in RecentlyRotated.Where(e => e.Value.RotatedAt < cutoff).ToList())
        {
            RecentlyRotated.TryRemove(entry.Key, out _);
        }
    }

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

    private readonly record struct GraceEntry(string NewToken, Guid SessionId, string Username, DateTime RotatedAt);
}
