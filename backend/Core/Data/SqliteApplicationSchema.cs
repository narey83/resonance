// <copyright file="SqliteApplicationSchema.cs" company="John Narey">
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
using Microsoft.EntityFrameworkCore;

/// <summary>Initializes the SQLite schema without running application workers or connecting to Soulseek.</summary>
public static class SqliteApplicationSchema
{
    public static void Initialize(RuntimeDatabase database)
    {
        if (database.UsePostgres)
        {
            throw new ArgumentException("SQLite initialization requires Sqlite provider.");
        }

        database.InitializeDirectory();
        var types = new[]
        {
            typeof(Search.SearchDbContext), typeof(Transfers.TransfersDbContext),
            typeof(Messaging.MessagingDbContext), typeof(Events.EventsDbContext),
            typeof(Authentication.UsersDbContext), typeof(MusicLibrary.Activity.LibraryActivityDbContext),
            typeof(Resonance.Integrations.YtDlp.Data.YtDlpDbContext), typeof(Core.LogStore.LogsDbContext),
        };
        foreach (var type in types)
        {
            var builder = (DbContextOptionsBuilder)Activator.CreateInstance(typeof(DbContextOptionsBuilder<>).MakeGenericType(type));
            database.Configure(builder);
            using var context = (DbContext)Activator.CreateInstance(type, builder.Options);
            SqliteSchema.Initialize(context);
        }

        _ = new Core.Settings.SettingsService(database.ConnectionString, false);
        new MusicLibrary.MusicRepository(database.ConnectionString, false).Initialize();
        new Mixtapes.MixtapeRepository(database.ConnectionString, false).Initialize();
        _ = new Analysis.AnalysisStore(database.ConnectionString, false);
        _ = new MusicLibrary.ArtworkStore(database.ConnectionString, false);
        var connections = new ConnectionStringDictionary(Database.List.ToDictionary(d => d, _ => (ConnectionString)database.ConnectionString), false);
        _ = new Core.Preferences.PreferencesService(connections);
        new TransferNetworkInfoStore(connections).Initialize();
    }
}
