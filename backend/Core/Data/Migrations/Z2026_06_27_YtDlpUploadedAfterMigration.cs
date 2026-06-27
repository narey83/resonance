// <copyright file="Z2026_06_27_YtDlpUploadedAfterMigration.cs" company="John Narey">
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

namespace resonance.Migrations;

using System;
using System.Linq;
using Microsoft.Data.Sqlite;
using Serilog;

/// <summary>
///     Adds the UploadedAfterOverride column to the yt-dlp Jobs and Subscriptions tables.
/// </summary>
public class Z2026_06_27_YtDlpUploadedAfterMigration : IMigration
{
    public Z2026_06_27_YtDlpUploadedAfterMigration(ConnectionStringDictionary connectionStrings)
    {
        ConnectionString = connectionStrings[Database.YtDlp];
    }

    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Database);
    private string ConnectionString { get; }

    public bool NeedsToBeApplied()
    {
        var schema = SchemaInspector.GetDatabaseSchema(ConnectionString);

        // A table that doesn't exist yet (fresh DB) is built by EnsureCreated with the column already present.
        return ColumnMissing(schema, "Jobs") || ColumnMissing(schema, "Subscriptions");
    }

    public void Apply()
    {
        if (!NeedsToBeApplied())
        {
            Log.Information("> Migration {Name} is not necessary or has already been applied", nameof(Z2026_06_27_YtDlpUploadedAfterMigration));
            return;
        }

        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();

        using var transaction = connection.BeginTransaction();

        try
        {
            var schema = SchemaInspector.GetDatabaseSchema(ConnectionString);

            foreach (var table in new[] { "Jobs", "Subscriptions" })
            {
                if (!ColumnMissing(schema, table))
                {
                    continue;
                }

                Log.Information("> Adding UploadedAfterOverride column to the yt-dlp {Table} table...", table);

                using var command = new SqliteCommand(
                    $"ALTER TABLE {table} ADD COLUMN UploadedAfterOverride TEXT NULL;",
                    connection,
                    transaction);

                command.ExecuteNonQuery();
            }

            transaction.Commit();
            Log.Information("> Done!");
        }
        catch (Exception)
        {
            transaction.Rollback();
            throw;
        }
    }

    // True only when the table exists but lacks the column (a missing table is left to EnsureCreated).
    private static bool ColumnMissing(System.Collections.Generic.Dictionary<string, System.Collections.Generic.IEnumerable<SchemaInspector.ColumnInfo>> schema, string table)
        => schema.TryGetValue(table, out var columns) && !columns.Any(c => c.Name == "UploadedAfterOverride");
}
