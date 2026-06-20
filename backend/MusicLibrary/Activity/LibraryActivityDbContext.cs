// <copyright file="LibraryActivityDbContext.cs" company="JP Dillingham">
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

namespace resonance.MusicLibrary.Activity;

using Microsoft.EntityFrameworkCore;

public class LovedTrack
{
    public required string Path { get; init; }
    public required string Username { get; init; }
    public required long LovedAt { get; init; }
    public required string Title { get; init; }
    public required string Artist { get; init; }
    public required string Folder { get; init; }
}

public class PlayRecord
{
    public required string Id { get; init; }
    public required string Path { get; init; }
    public required string Username { get; init; }
    public required long PlayedAt { get; init; }
    public required string Title { get; init; }
    public required string Artist { get; init; }
    public required string Folder { get; init; }
    public string Source { get; init; } = string.Empty;
}

public class LibraryActivityDbContext : DbContext
{
    public LibraryActivityDbContext(DbContextOptions<LibraryActivityDbContext> options)
        : base(options)
    {
    }

    public DbSet<LovedTrack> LovedTracks { get; set; }
    public DbSet<PlayRecord> PlayHistory { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        if (Database.IsNpgsql())
            modelBuilder.HasDefaultSchema("library_activity");

        modelBuilder.Entity<LovedTrack>()
            .HasKey(e => new { e.Path, e.Username });

        modelBuilder.Entity<PlayRecord>()
            .HasKey(e => e.Id);

        modelBuilder.Entity<PlayRecord>()
            .HasIndex(e => new { e.Username, e.PlayedAt });
    }
}
