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

public class LogsDbContext : DbContext
{
    public LogsDbContext(DbContextOptions<LogsDbContext> options)
        : base(options)
    {
    }

    public DbSet<LogEntry> LogEntries { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        if (Database.IsNpgsql())
        {
            modelBuilder.HasDefaultSchema("logs");
        }

        modelBuilder.Entity<LogEntry>()
            .Property(e => e.Timestamp)
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        modelBuilder.Entity<LogEntry>().Property(e => e.Context).IsRequired(false);
        modelBuilder.Entity<LogEntry>().Property(e => e.SubContext).IsRequired(false);
        modelBuilder.Entity<LogEntry>().Property(e => e.Message).IsRequired(false);
        modelBuilder.Entity<LogEntry>().Property(e => e.Exception).IsRequired(false);

        modelBuilder.Entity<LogEntry>()
            .HasIndex(e => e.Timestamp);

        modelBuilder.Entity<LogEntry>()
            .HasIndex(e => new { e.Level, e.Timestamp });
    }
}

public class LogEntry
{
    public long Id { get; set; }
    public DateTime Timestamp { get; set; }
    public string Level { get; set; }
    public string? Context { get; set; }
    public string? SubContext { get; set; }
    public string? Message { get; set; }
    public string? Exception { get; set; }
}
