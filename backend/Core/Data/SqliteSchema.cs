// <copyright file="SqliteSchema.cs" company="John Narey">
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

namespace resonance;

using System;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

/// <summary>SQLite-only, transactional schema versions for the existing independent EF contexts.</summary>
public static class SqliteSchema
{
    public static void Initialize(DbContext context)
    {
        if (!context.Database.IsSqlite())
        {
            throw new ArgumentException("SQLite schema initializer requires SQLite.");
        }

        var name = context.GetType().Name;
        var requiredVersion = name == nameof(Transfers.TransfersDbContext) ? 3 : 1;
        context.Database.OpenConnection();

        // WAL readers can check a current schema while background services are writing.
        // Only an actual schema change needs to compete for SQLite's single writer.
        var hasVersions = context.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS Value FROM sqlite_master WHERE type='table' AND name='__ResonanceSchema'").Single() > 0;
        if (hasVersions)
        {
            var current = context.Database.SqlQuery<int>($"SELECT Version AS Value FROM __ResonanceSchema WHERE Context = {name}").ToList();
            if (current.Count > 0 && current[0] >= requiredVersion)
            {
                return;
            }
        }

        using var transaction = context.Database.BeginTransaction();
        context.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS __ResonanceSchema (Context TEXT PRIMARY KEY, Version INTEGER NOT NULL)");
        var version = context.Database.SqlQuery<int>($"SELECT Version AS Value FROM __ResonanceSchema WHERE Context = {name}")
            .ToList();
        if (version.Count == 0)
        {
            // Generate from the SQLite model only. PostgreSQL DDL is never replayed here.
            var script = context.Database.GenerateCreateScript();
            script = Regex.Replace(script, @"\bCREATE TABLE\b", "CREATE TABLE IF NOT EXISTS");
            script = Regex.Replace(script, @"\bCREATE (UNIQUE )?INDEX\b", "CREATE $1INDEX IF NOT EXISTS");
            context.Database.ExecuteSqlRaw(script);
            context.Database.ExecuteSqlInterpolated($"INSERT INTO __ResonanceSchema(Context,Version) VALUES ({name},{requiredVersion})");
        }

        if (version.Count != 0 && version[0] < requiredVersion)
        {
            context.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_Transfers_ReportWindow ON Transfers(EndedAt, State, Direction) WHERE EndedAt IS NOT NULL");
            context.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_Transfers_Overview ON Transfers(Direction, State, EndedAt, Username, BytesTransferred, StartOffset, AverageSpeed) WHERE EndedAt IS NOT NULL");

            // Legacy sampled statistics understated direction cardinality and made
            // the planner prefer full-history scans over the reporting date index.
            foreach (var (indexName, analyzeSql) in new[]
            {
                ("IX_Transfers_Overview", "ANALYZE IX_Transfers_Overview"),
                ("IX_Transfers_ReportWindow", "ANALYZE IX_Transfers_ReportWindow"),
                ("IDX_Transfers_State", "ANALYZE IDX_Transfers_State"),
                ("IDX_Transfers_Direction", "ANALYZE IDX_Transfers_Direction"),
                ("IX_Transfers_ListDirectionRemovedCompletionTime", "ANALYZE IX_Transfers_ListDirectionRemovedCompletionTime"),
            })
            {
                if (context.Database.SqlQuery<int>($"SELECT COUNT(*) AS Value FROM sqlite_master WHERE type='index' AND name={indexName}").Single() > 0)
                {
                    context.Database.ExecuteSqlRaw(analyzeSql);
                }
            }

            context.Database.ExecuteSqlInterpolated($"UPDATE __ResonanceSchema SET Version={requiredVersion} WHERE Context={name}");
        }

        transaction.Commit();
    }
}
