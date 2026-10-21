// <copyright file="YtDlpDbContext.cs" company="John Narey">
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

namespace Resonance.Integrations.YtDlp.Data;

using System;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using resonance.Common;
using Resonance.Integrations.YtDlp.Types;

public class YtDlpDbContext : DbContext
{
    public YtDlpDbContext(DbContextOptions<YtDlpDbContext> options)
        : base(options)
    {
    }

    public DbSet<YtDlpJob> Jobs { get; set; }
    public DbSet<YtDlpTrack> Tracks { get; set; }
    public DbSet<YtDlpSubscription> Subscriptions { get; set; }
    public DbSet<YtDlpEventRecord> Events { get; set; }

    public async System.Threading.Tasks.Task InitializeSchemaAsync(System.Threading.CancellationToken cancellationToken)
    {
        if (!Database.IsNpgsql())
        {
            resonance.SqliteSchema.Initialize(this);
            return;
        }
        // SubscriptionId was added after first release; EnsureCreated won't alter an existing table.
        await Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Jobs\" ADD COLUMN IF NOT EXISTS \"SubscriptionId\" uuid", cancellationToken);
        await Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Tracks\" ADD COLUMN IF NOT EXISTS \"ReportedDurationSeconds\" integer", cancellationToken);
        await Database.ExecuteSqlRawAsync(
            "ALTER TABLE ytdlp.\"Events\" ADD COLUMN IF NOT EXISTS \"TrackTitle\" text", cancellationToken);

    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        if (Database.IsNpgsql())
        {
            modelBuilder.HasDefaultSchema("ytdlp");
        }
        else
        {
            modelBuilder.Entity<YtDlpJob>().ToTable("YtDlpJobs");
            modelBuilder.Entity<YtDlpTrack>().ToTable("YtDlpTracks");
            modelBuilder.Entity<YtDlpSubscription>().ToTable("YtDlpSubscriptions");
            modelBuilder.Entity<YtDlpEventRecord>().ToTable("YtDlpEvents");
        }

        // Persist download output paths relative to the music root; resolve to absolute on read.
        var pathConverter = new ValueConverter<string, string>(
            v => MusicPath.ToRelative(v),
            v => MusicPath.ToAbsolute(v));

        modelBuilder.Entity<YtDlpJob>()
            .Property(e => e.OutputDirectory)
            .HasConversion(pathConverter);

        modelBuilder.Entity<YtDlpTrack>()
            .Property(e => e.FilePath)
            .HasConversion(pathConverter);

        modelBuilder.Entity<YtDlpSubscription>()
            .Property(e => e.OutputDirectoryOverride)
            .HasConversion(pathConverter);

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

        modelBuilder.Entity<YtDlpSubscription>()
            .Property(e => e.CreatedAt)
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        modelBuilder.Entity<YtDlpSubscription>()
            .Property(e => e.LastCheckedAt)
            .HasConversion(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : null);

        modelBuilder.Entity<YtDlpEventRecord>()
            .Property(e => e.Timestamp)
            .HasConversion(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

        // The Events pane always reads newest events per job, so index both the ordering key and
        // the per-job filter used by the "clear this job's log" action.
        modelBuilder.Entity<YtDlpEventRecord>()
            .HasIndex(e => e.Id);

        modelBuilder.Entity<YtDlpEventRecord>()
            .HasIndex(e => e.JobId);
    }
}
