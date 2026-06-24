// <copyright file="PermissionService.cs" company="John Narey">
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
using Microsoft.EntityFrameworkCore;

public class PermissionService
{
    private readonly object @lock = new();

    public PermissionService(IDbContextFactory<UsersDbContext> contextFactory)
    {
        ContextFactory = contextFactory;
    }

    private IDbContextFactory<UsersDbContext> ContextFactory { get; }
    private Dictionary<(string Role, string Feature), bool> Cache { get; set; }

    public bool IsAllowed(string roleName, string featureKey)
    {
        EnsureCache();
        return Cache.TryGetValue((roleName, featureKey), out var allowed) && allowed;
    }

    public IEnumerable<CustomRole> GetRoles()
    {
        using var db = ContextFactory.CreateDbContext();
        return db.CustomRoles.OrderBy(r => r.Name).ToList();
    }

    public IEnumerable<FeaturePermission> GetMatrix()
    {
        using var db = ContextFactory.CreateDbContext();
        return db.FeaturePermissions.ToList();
    }

    public CustomRole CreateRole(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Role name cannot be empty");
        }

        using var db = ContextFactory.CreateDbContext();

        if (db.CustomRoles.Any(r => r.Name == name))
        {
            throw new InvalidOperationException($"A role named '{name}' already exists");
        }

        var role = new CustomRole { Name = name.Trim() };
        db.CustomRoles.Add(role);

        // new custom roles start with no access; admin configures from there
        foreach (var feature in Feature.All)
        {
            db.FeaturePermissions.Add(new FeaturePermission
            {
                RoleName = role.Name,
                FeatureKey = feature,
                Allowed = false,
            });
        }

        db.SaveChanges();
        InvalidateCache();
        return role;
    }

    public void DeleteRole(string name)
    {
        using var db = ContextFactory.CreateDbContext();
        var role = db.CustomRoles.FirstOrDefault(r => r.Name == name)
            ?? throw new NotFoundException($"Role '{name}' not found");

        if (role.IsBuiltIn)
        {
            throw new InvalidOperationException("Built-in roles cannot be deleted");
        }

        db.FeaturePermissions.RemoveRange(db.FeaturePermissions.Where(p => p.RoleName == name));
        db.CustomRoles.Remove(role);
        db.SaveChanges();
        InvalidateCache();
    }

    public void SetPermission(string roleName, string featureKey, bool allowed)
    {
        using var db = ContextFactory.CreateDbContext();

        if (!db.CustomRoles.Any(r => r.Name == roleName))
        {
            throw new NotFoundException($"Role '{roleName}' not found");
        }

        var perm = db.FeaturePermissions.FirstOrDefault(p => p.RoleName == roleName && p.FeatureKey == featureKey);
        if (perm is null)
        {
            db.FeaturePermissions.Add(new FeaturePermission { RoleName = roleName, FeatureKey = featureKey, Allowed = allowed });
        }
        else
        {
            perm.Allowed = allowed;
        }

        db.SaveChanges();
        InvalidateCache();
    }

    /// <summary>
    ///     Idempotent — ensures built-in roles and their default permissions exist.
    ///     Called at startup to recover from a fresh-install race where EnsureCreated
    ///     creates the tables before the migration can seed them.
    /// </summary>
    public void EnsureBuiltinRoles()
    {
        using var db = ContextFactory.CreateDbContext();
        var changed = false;

        foreach (var roleName in new[] { Role.Administrator.ToString(), Role.ReadWrite.ToString() })
        {
            var existing = db.CustomRoles.FirstOrDefault(r => r.Name == roleName);
            if (existing is null)
            {
                db.CustomRoles.Add(new CustomRole { Name = roleName, IsBuiltIn = true });
                changed = true;
            }
            else if (!existing.IsBuiltIn)
            {
                existing.IsBuiltIn = true;
                changed = true;
            }
        }

        // ReadWrite: ensure every feature has a permission row (default allow)
        foreach (var feature in Feature.All)
        {
            if (!db.FeaturePermissions.Any(p => p.RoleName == Role.ReadWrite.ToString() && p.FeatureKey == feature))
            {
                db.FeaturePermissions.Add(new FeaturePermission
                {
                    RoleName = Role.ReadWrite.ToString(),
                    FeatureKey = feature,
                    Allowed = true,
                });
                changed = true;
            }
        }

        if (changed)
        {
            db.SaveChanges();
            InvalidateCache();
        }
    }

    public void InvalidateCache()
    {
        lock (@lock)
        {
            Cache = null;
        }
    }

    private void EnsureCache()
    {
        if (Cache is not null)
        {
            return;
        }

        lock (@lock)
        {
            if (Cache is not null)
            {
                return;
            }

            using var db = ContextFactory.CreateDbContext();
            Cache = db.FeaturePermissions.ToDictionary(p => (p.RoleName, p.FeatureKey), p => p.Allowed);
        }
    }
}
