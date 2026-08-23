// <copyright file="LogsDbContext.cs" company="John Narey">
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

namespace resonance.Core.LogStore;

using System;
using Microsoft.EntityFrameworkCore;

/// <summary>
///     A single persisted application log event.
/// </summary>
public class LogEntry
{
    public long Id { get; set; }

    public DateTime Timestamp { get; set; }

    public string Level { get; set; }

    public string? SourceContext { get; set; }

    public string? SubContext { get; set; }

    public string? Message { get; set; }

    public string? Exception { get; set; }

    /// <summary>
    ///     Any Serilog structured properties beyond <see cref="SourceContext"/>/<see cref="SubContext"/>,
    ///     as a JSON object. Null for a plain templated message with nothing else attached.
    /// </summary>
    public string? Properties { get; set; }
}

/// <summary>
///     EF Core context over <c>logs."LogEntries"</c>. Used for querying and for batched inserts
///     (<see cref="LogPersistenceService"/>) -- the *physical* table (native Postgres range
///     partitioning by month) is created and maintained by <see cref="LogsSchemaInitializer"/> via
///     raw DDL, not by <c>Database.EnsureCreated()</c>, since partitioning can't be expressed
///     through EF's model. This context's model still declares the shape (columns, the composite
///     primary key Postgres requires on a partitioned table's constraints) so LINQ queries and
///     inserts translate correctly, and so the model is usable standalone against SQLite in tests.
/// </summary>
public class LogsDbContext : DbContext
{
    public LogsDbContext(DbContextOptions<LogsDbContext> options)
        : base(options)
    {
    }

    public DbSet<LogEntry> Entries { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        if (Database.IsNpgsql())
        {
            modelBuilder.HasDefaultSchema("logs");
        }

        var entry = modelBuilder.Entity<LogEntry>();

        entry.ToTable("LogEntries");

        // Postgres requires a partitioned table's primary key to include the partitioning column
        // (Timestamp); Id alone is still effectively unique in practice since it's a single
        // GENERATED ALWAYS AS IDENTITY sequence shared by the whole partitioned table, not one
        // per partition.
        entry.HasKey(e => new { e.Id, e.Timestamp });

        entry.Property(e => e.Timestamp)
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc))
            .IsRequired();

        entry.Property(e => e.Level).HasMaxLength(20).IsRequired();
        entry.Property(e => e.SourceContext).HasMaxLength(200);
        entry.Property(e => e.SubContext).HasMaxLength(200);

        if (Database.IsNpgsql())
        {
            // The parent table, its indexes (which Postgres auto-propagates to every partition,
            // present and future), and the monthly partitions themselves are all created by
            // LogsSchemaInitializer via raw DDL -- not through this model. Id still needs to be
            // configured as a real Postgres identity column so EF omits it on INSERT and reads the
            // generated value back via RETURNING, matching what the DDL actually creates.
            entry.Property(e => e.Id).UseIdentityAlwaysColumn();
            entry.Property(e => e.Properties).HasColumnType("jsonb");
        }
    }
}
