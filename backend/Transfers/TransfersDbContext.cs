// <copyright file="TransfersDbContext.cs" company="JP Dillingham">
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

namespace resonance.Transfers
{
    using System;
    using Microsoft.EntityFrameworkCore;
    using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

    public class TransfersDbContext : DbContext
    {
        public TransfersDbContext(DbContextOptions<TransfersDbContext> options)
            : base(options)
        {
        }

        public DbSet<Transfer> Transfers { get; set; }

        public override int SaveChanges(bool acceptAllChangesOnSuccess)
        {
            // this is absolutely NOT IDEAL and will accellerate the move away from EF
            foreach (var entry in ChangeTracker.Entries<Transfer>())
            {
                if (entry.State == EntityState.Added || entry.State == EntityState.Modified)
                {
                    entry.Entity.StateDescription = entry.Entity.State.ToString();
                }
            }

            return base.SaveChanges(acceptAllChangesOnSuccess);
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            if (Database.IsNpgsql())
            {
                modelBuilder.HasDefaultSchema("transfers");
            }

            modelBuilder
                .Entity<Transfer>()
                .Property(e => e.StartedAt)
                .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

            modelBuilder
                .Entity<Transfer>()
                .Property(e => e.EndedAt)
                .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

            modelBuilder
                .Entity<Transfer>()
                .Property(d => d.Direction)
                .HasConversion(new EnumToStringConverter<Soulseek.TransferDirection>());

            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => t.Direction)
                .HasDatabaseName("IDX_Transfers_Direction");

            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => t.State)
                .HasDatabaseName("IDX_Transfers_State");

            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => t.Removed)
                .HasDatabaseName("IDX_Transfers_Removed");

            modelBuilder
                .Entity<Transfer>()
                .Property(e => e.Attempts)
                .HasDefaultValue(0); // force EF to match the migration

            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => t.BatchId)
                .HasDatabaseName("IDX_Transfers_BatchId");

            // walks the retry chain backwards from a terminal transfer to its prior failed attempt(s)
            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => t.RetryOfId)
                .HasDatabaseName("IDX_Transfers_RetryOfId");

            // covers the check for existing records when enqueueing uploads and downloads
            modelBuilder
                .Entity<Transfer>()
                .HasIndex(t => new { t.Username, t.Filename })
                .HasDatabaseName("IDX_Transfers_UsernameFilename");

            // covers the GetUserStatistics method that backs limit checks
            // check every so often with EXPLAIN to make sure it's being shown as a covering index
            modelBuilder
                .Entity<Transfer>()
                .HasIndex(e => new { e.Username, e.Direction, e.EndedAt, e.StartedAt, e.State, e.Size })
                .HasDatabaseName("IDX_Transfers_UserUploadStatistics");

            // covers the analytics/reports queries (ReportsService), which all filter on EndedAt
            // and aggregate the included columns; INCLUDE keeps the scans index-only so they never
            // touch the (Filename-heavy, much larger) heap
            modelBuilder
                .Entity<Transfer>()
                .HasIndex(e => e.EndedAt)
                .HasDatabaseName("IDX_Transfers_Reports")
                .HasFilter("\"EndedAt\" IS NOT NULL")
                .IncludeProperties(e => new { e.Direction, e.State, e.StateDescription, e.Size, e.Username, e.AverageSpeed, e.StartedAt, e.EnqueuedAt });

            // covers the user report search, which resolves usernames with a leading-wildcard
            // ILIKE; the btree indexes above are all useless for that, leaving a scan of every
            // row. Postgres only: SQLite has no trigram support, and its LIKE is already
            // case-insensitive. Depends on the pg_trgm extension created during startup.
            if (Database.IsNpgsql())
            {
                modelBuilder
                    .Entity<Transfer>()
                    .HasIndex(e => e.Username)
                    .HasDatabaseName("IDX_Transfers_UsernameTrgm")
                    .HasMethod("gin")
                    .HasOperators("gin_trgm_ops");

                // No matching trigram index on Filename, deliberately. Building one over this table
                // exceeded the 30s schema-init command timeout and so never completed, and it would
                // have to be maintained on every completed transfer — the highest-write path there
                // is. Measured without it: the history page's default seven-day window filters
                // filenames in ~1s off IDX_Transfers_Reports, and an unbounded all-time search takes
                // ~4.4s. That's an acceptable price for a query nobody runs by default.
            }
        }
    }
}
