// <copyright file="AppUserService.cs" company="JP Dillingham">
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
        if (user is null || !VerifyPassword(password, user.PasswordHash))
        {
            return null;
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

    private static string HashPassword(string password)
    {
        var salt = new byte[16];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(salt);

        var hash = KeyDerivation.Pbkdf2(
            password,
            salt,
            KeyDerivationPrf.HMACSHA256,
            iterationCount: 100_000,
            numBytesRequested: 32);

        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPassword(string password, string storedHash)
    {
        var parts = storedHash.Split(':');
        if (parts.Length != 2)
        {
            return false;
        }

        var salt = Convert.FromBase64String(parts[0]);
        var expectedHash = Convert.FromBase64String(parts[1]);

        var actualHash = KeyDerivation.Pbkdf2(
            password,
            salt,
            KeyDerivationPrf.HMACSHA256,
            iterationCount: 100_000,
            numBytesRequested: 32);

        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
}
