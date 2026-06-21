// <copyright file="Z2026_06_02_LibraryActivityUsernameMigration.cs" company="JP Dillingham">
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

using System;
using System.Linq;
using Microsoft.Data.Sqlite;
using Serilog;

public class Z2026_06_02_LibraryActivityUsernameMigration : IMigration
{
    public Z2026_06_02_LibraryActivityUsernameMigration(ConnectionStringDictionary connectionStrings)
    {
        ConnectionString = connectionStrings[Database.LibraryActivity];
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Database);
    private string ConnectionString { get; }

    public bool NeedsToBeApplied()
    {
        var schema = SchemaInspector.GetDatabaseSchema(ConnectionString);
        return schema.ContainsKey("LovedTracks") &&
               !schema["LovedTracks"].Any(c => c.Name == "Username");
    }

    public void Apply()
    {
        if (!NeedsToBeApplied())
        {
            Log.Information("> Migration {Name} is not necessary or has already been applied", nameof(Z2026_06_02_LibraryActivityUsernameMigration));
            return;
        }

        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();

        using var transaction = connection.BeginTransaction();

        try
        {
            Log.Information("> Recreating LovedTracks with Username column...");

            using var loved = new SqliteCommand(@"
                CREATE TABLE LovedTracks_new (
                    Path TEXT NOT NULL,
                    Username TEXT NOT NULL DEFAULT '',
                    LovedAt INTEGER NOT NULL,
                    PRIMARY KEY (Path, Username)
                );
                INSERT INTO LovedTracks_new SELECT Path, '', LovedAt FROM LovedTracks;
                DROP TABLE LovedTracks;
                ALTER TABLE LovedTracks_new RENAME TO LovedTracks;
                CREATE INDEX IF NOT EXISTS IX_LovedTracks_Username ON LovedTracks(Username);",
                connection, transaction);
            loved.ExecuteNonQuery();

            Log.Information("> Recreating PlayHistory with Username column...");

            using var plays = new SqliteCommand(@"
                CREATE TABLE PlayHistory_new (
                    Id TEXT NOT NULL PRIMARY KEY,
                    Path TEXT NOT NULL,
                    Username TEXT NOT NULL DEFAULT '',
                    PlayedAt INTEGER NOT NULL
                );
                INSERT INTO PlayHistory_new SELECT Id, Path, '', PlayedAt FROM PlayHistory;
                DROP TABLE PlayHistory;
                ALTER TABLE PlayHistory_new RENAME TO PlayHistory;
                CREATE INDEX IF NOT EXISTS IX_PlayHistory_Path ON PlayHistory(Path);
                CREATE INDEX IF NOT EXISTS IX_PlayHistory_Username ON PlayHistory(Username);
                CREATE INDEX IF NOT EXISTS IX_PlayHistory_Username_PlayedAt ON PlayHistory(Username, PlayedAt);",
                connection, transaction);
            plays.ExecuteNonQuery();

            transaction.Commit();
            Log.Information("> Done!");
        }
        catch (Exception)
        {
            transaction.Rollback();
            throw;
        }
    }
}
