// <copyright file="AppUserService.cs" company="John Narey">
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
using System.Security.Cryptography;
using Microsoft.AspNetCore.Cryptography.KeyDerivation;
using Microsoft.EntityFrameworkCore;

public class AppUserService
{
    public AppUserService(IDbContextFactory<UsersDbContext> contextFactory)
    {
        ContextFactory = contextFactory;
        using var db = ContextFactory.CreateDbContext();
        db.Database.EnsureCreated();
    }

    private IDbContextFactory<UsersDbContext> ContextFactory { get; }

    public bool IsInitialized()
    {
        using var db = ContextFactory.CreateDbContext();
        return db.Users.Any();
    }

    public AppUser Create(string username, string password, Role role = Role.ReadWrite, string fullName = null)
    {
        using var db = ContextFactory.CreateDbContext();

        if (db.Users.Any(u => u.Username == username))
        {
            throw new InvalidOperationException($"A user with the name '{username}' already exists");
        }

        var user = new AppUser
        {
            Username = username,
            PasswordHash = HashPassword(password),
            Role = role,
            FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim(),
        };

        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }

    /// <summary>Returns the authenticated user, or null if credentials are invalid.</summary>
    /// <returns></returns>
    public AppUser? Authenticate(string username, string password)
    {
        using var db = ContextFactory.CreateDbContext();
        var user = db.Users.FirstOrDefault(u => u.Username == username);

        // Constant-time on the missing-user path: verify against a fixed dummy hash so an unknown
        // username costs the same PBKDF2 work as a known one. Otherwise the early return leaks which
        // usernames exist via response timing (user enumeration).
        if (user is null)
        {
            VerifyPassword(password, DummyHash);
            return null;
        }

        if (!VerifyPassword(password, user.PasswordHash))
        {
            return null;
        }

        // Transparently upgrade legacy / lower-cost hashes to the current parameters on successful login.
        if (NeedsRehash(user.PasswordHash))
        {
            user.PasswordHash = HashPassword(password);
            db.SaveChanges();
        }

        return user;
    }

    public IEnumerable<AppUser> GetAll()
    {
        using var db = ContextFactory.CreateDbContext();
        return db.Users.OrderBy(u => u.Username).ToList();
    }

    public AppUser? Get(string username)
    {
        using var db = ContextFactory.CreateDbContext();
        return db.Users.FirstOrDefault(u => u.Username == username);
    }

    public void UpdatePassword(string username, string newPassword)
    {
        using var db = ContextFactory.CreateDbContext();
        var user = db.Users.FirstOrDefault(u => u.Username == username)
            ?? throw new NotFoundException($"User '{username}' not found");

        user.PasswordHash = HashPassword(newPassword);
        db.SaveChanges();
    }

    public string UpdateUsername(string oldUsername, string newUsername)
    {
        if (string.IsNullOrWhiteSpace(newUsername))
        {
            throw new ArgumentException("Username cannot be empty");
        }

        using var db = ContextFactory.CreateDbContext();

        if (db.Users.Any(u => u.Username == newUsername && u.Username != oldUsername))
        {
            throw new InvalidOperationException($"A user with the name '{newUsername}' already exists");
        }

        var user = db.Users.FirstOrDefault(u => u.Username == oldUsername)
            ?? throw new NotFoundException($"User '{oldUsername}' not found");

        user.Username = newUsername;
        db.SaveChanges();
        return newUsername;
    }

    public void UpdateFullName(string username, string? fullName)
    {
        using var db = ContextFactory.CreateDbContext();
        var user = db.Users.FirstOrDefault(u => u.Username == username)
            ?? throw new NotFoundException($"User '{username}' not found");

        user.FullName = string.IsNullOrWhiteSpace(fullName) ? null : fullName.Trim();
        db.SaveChanges();
    }

    public void UpdateRole(string username, Role role)
    {
        using var db = ContextFactory.CreateDbContext();
        var user = db.Users.FirstOrDefault(u => u.Username == username)
            ?? throw new NotFoundException($"User '{username}' not found");

        user.Role = role;
        db.SaveChanges();
    }

    public void Delete(string username)
    {
        using var db = ContextFactory.CreateDbContext();
        var user = db.Users.FirstOrDefault(u => u.Username == username)
            ?? throw new NotFoundException($"User '{username}' not found");

        var adminCount = db.Users.Count(u => u.Role == Role.Administrator);
        if (user.Role == Role.Administrator && adminCount <= 1)
        {
            throw new InvalidOperationException("Cannot delete the last administrator account");
        }

        db.Users.Remove(user);
        db.SaveChanges();
    }

    // OWASP guidance for PBKDF2-HMAC-SHA256 is >= 600k iterations. Legacy hashes were produced at 100k
    // and don't record their cost, so they're recognised by the older "salt:hash" format and verified at
    // the legacy count, then rehashed to the current parameters on the next successful login.
    private const int CurrentIterations = 600_000;
    private const int LegacyIterations = 100_000;
    private const string HashPrefix = "pbkdf2-sha256";

    // A pre-computed hash of a throwaway password, used only to spend equivalent PBKDF2 time on the
    // unknown-user path so authentication is constant-time regardless of whether the account exists.
    private static readonly string DummyHash = HashPassword("resonance-dummy-password-for-constant-time");

    private static string HashPassword(string password)
    {
        var salt = new byte[16];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(salt);

        var hash = KeyDerivation.Pbkdf2(
            password,
            salt,
            KeyDerivationPrf.HMACSHA256,
            iterationCount: CurrentIterations,
            numBytesRequested: 32);

        // Versioned format so the iteration count travels with the hash and can be raised again later.
        return $"{HashPrefix}${CurrentIterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        if (!TryParseHash(storedHash, out var iterations, out var salt, out var expectedHash))
        {
            return false;
        }

        var actualHash = KeyDerivation.Pbkdf2(
            password,
            salt,
            KeyDerivationPrf.HMACSHA256,
            iterationCount: iterations,
            numBytesRequested: expectedHash.Length);

        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }

    // Parses both the versioned "pbkdf2-sha256$<iters>$<salt>$<hash>" format and the legacy "salt:hash"
    // format (implicitly 100k iterations).
    private static bool TryParseHash(string storedHash, out int iterations, out byte[] salt, out byte[] hash)
    {
        iterations = 0;
        salt = null;
        hash = null;

        if (string.IsNullOrEmpty(storedHash))
        {
            return false;
        }

        try
        {
            if (storedHash.StartsWith(HashPrefix + "$", StringComparison.Ordinal))
            {
                var parts = storedHash.Split('$');
                if (parts.Length != 4 || !int.TryParse(parts[1], out iterations) || iterations <= 0)
                {
                    return false;
                }

                salt = Convert.FromBase64String(parts[2]);
                hash = Convert.FromBase64String(parts[3]);
                return true;
            }

            var legacy = storedHash.Split(':');
            if (legacy.Length != 2)
            {
                return false;
            }

            iterations = LegacyIterations;
            salt = Convert.FromBase64String(legacy[0]);
            hash = Convert.FromBase64String(legacy[1]);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    // True when the stored hash isn't in the current format at the current cost, so a successful login
    // should opportunistically re-hash the password with the up-to-date parameters.
    private static bool NeedsRehash(string storedHash)
        => !TryParseHash(storedHash, out var iterations, out _, out _) || iterations < CurrentIterations;
}
