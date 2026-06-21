// <copyright file="Z2026_05_29_PermissionsMigration.cs" company="JP Dillingham">
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

namespace resonance.Migrations;

using Microsoft.Data.Sqlite;
using Serilog;

/// <summary>
///     Creates CustomRoles and FeaturePermissions tables with default seed data.
/// </summary>
public class Z2026_05_29_PermissionsMigration : IMigration
{
    public Z2026_05_29_PermissionsMigration(ConnectionStringDictionary connectionStrings)
    {
        ConnectionString = connectionStrings[Database.Users];
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Database);
    private string ConnectionString { get; }

    public bool NeedsToBeApplied()
    {
        try
        {
            using var conn = new SqliteConnection(ConnectionString);
            conn.Open();

            // table existence check
            using var tableCmd = new SqliteCommand(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='CustomRoles';", conn);
            if ((long)tableCmd.ExecuteScalar() == 0)
            {
                return true;
            }

            // EnsureCreated may have created the table before this migration ran, leaving it empty
            using var rowCmd = new SqliteCommand("SELECT COUNT(*) FROM CustomRoles;", conn);
            return (long)rowCmd.ExecuteScalar() == 0;
        }
        catch
        {
            return false;
        }
    }

    public void Apply()
    {
        if (!NeedsToBeApplied())
        {
            Log.Information("> Migration {Name} is not necessary or has already been applied", nameof(Z2026_05_29_PermissionsMigration));
            return;
        }

        using var conn = new SqliteConnection(ConnectionString);
        conn.Open();

        using var createRoles = new SqliteCommand(@"
            CREATE TABLE IF NOT EXISTS CustomRoles (
                Name TEXT PRIMARY KEY NOT NULL,
                IsBuiltIn INTEGER NOT NULL DEFAULT 0,
                CreatedAt TEXT NOT NULL DEFAULT (datetime('now'))
            );", conn);
        createRoles.ExecuteNonQuery();

        using var createPerms = new SqliteCommand(@"
            CREATE TABLE IF NOT EXISTS FeaturePermissions (
                RoleName TEXT NOT NULL,
                FeatureKey TEXT NOT NULL,
                Allowed INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (RoleName, FeatureKey)
            );", conn);
        createPerms.ExecuteNonQuery();

        // seed built-in roles
        foreach (var role in new[] { "Administrator", "ReadWrite" })
        {
            using var ins = new SqliteCommand(
                "INSERT OR IGNORE INTO CustomRoles (Name, IsBuiltIn) VALUES (@name, 1);", conn);
            ins.Parameters.AddWithValue("@name", role);
            ins.ExecuteNonQuery();
        }

        // ReadWrite gets access to all features by default
        foreach (var feature in resonance.Authentication.Feature.All)
        {
            using var ins = new SqliteCommand(
                "INSERT OR IGNORE INTO FeaturePermissions (RoleName, FeatureKey, Allowed) VALUES ('ReadWrite', @f, 1);", conn);
            ins.Parameters.AddWithValue("@f", feature);
            ins.ExecuteNonQuery();
        }

        Log.Information("> Created CustomRoles and FeaturePermissions tables");
    }
}
