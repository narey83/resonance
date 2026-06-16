// <copyright file="YtDlpDbContext.cs" company="JP Dillingham">
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

namespace Resonance.Integrations.YtDlp.Data;

using System;
using Microsoft.EntityFrameworkCore;
using Resonance.Integrations.YtDlp.Types;

public class YtDlpDbContext : DbContext
{
    public YtDlpDbContext(DbContextOptions<YtDlpDbContext> options)
        : base(options)
    {
    }

    public DbSet<YtDlpJob> Jobs { get; set; }
    public DbSet<YtDlpTrack> Tracks { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<YtDlpJob>()
            .Property(e => e.State)
            .HasConversion<string>();

        modelBuilder.Entity<YtDlpJob>()
            .Property(e => e.RequestedAt)
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        modelBuilder.Entity<YtDlpJob>()
            .Property(e => e.StartedAt)
            .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

        modelBuilder.Entity<YtDlpJob>()
            .Property(e => e.CompletedAt)
            .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

        modelBuilder.Entity<YtDlpTrack>()
            .Property(e => e.State)
            .HasConversion<string>();

        modelBuilder.Entity<YtDlpTrack>()
            .Property(e => e.StartedAt)
            .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

        modelBuilder.Entity<YtDlpTrack>()
            .Property(e => e.CompletedAt)
            .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

        modelBuilder.Entity<YtDlpTrack>()
            .HasIndex(e => e.VideoId);

        modelBuilder.Entity<YtDlpTrack>()
            .HasIndex(e => e.JobId);
    }
}
