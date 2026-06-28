// <copyright file="ShareRepositoryFactory.cs" company="JP Dillingham">
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

using System;
using System.IO;
using Microsoft.Extensions.Options;

namespace resonance.Shares
{
    /// <summary>
    ///     Persistent storage of a shared file cache. Produces a PostgreSQL-backed repository when
    ///     opted in via shares.use_postgres (and database.type is postgresql); SQLite otherwise.
    /// </summary>
    public class SqliteShareRepositoryFactory : IShareRepositoryFactory
    {
        public SqliteShareRepositoryFactory(IOptionsMonitor<Options> optionsMonitor)
        {
            var options = optionsMonitor.CurrentValue;
            UsePostgres = options.Shares.UsePostgres
                && options.Database.Type.Equals("postgresql", StringComparison.OrdinalIgnoreCase);
            PostgresConnectionString = options.Database.ConnectionString;
        }

        private bool UsePostgres { get; }

        private string PostgresConnectionString { get; }

        /// <summary>
        ///     Create a repository for the specified <paramref name="name"/>.
        /// </summary>
        /// <param name="name">The name of the agent.</param>
        /// <returns>The created repository.</returns>
        public IShareRepository CreateFromHost(string name)
        {
            if (UsePostgres)
            {
                return new PostgresShareRepository(PostgresConnectionString, host: name);
            }

            var file = Path.Combine(Program.DataDirectory, $"shares.{name}.db");

            // Private cache (not Cache=shared): with shared cache SQLite uses table-level locks that
            // raise SQLITE_LOCKED ("database table is locked") for readers the moment a scan writes —
            // breaking concurrent searches and metadata lookups. WAL + private cache lets readers and
            // a single writer run concurrently instead.
            return new SqliteShareRepository($"Data Source={file}");
        }

        /// <summary>
        ///     Create a repository for the specified <paramref name="filename"/>.
        /// </summary>
        /// <param name="filename">The fully qualified path of the filename.</param>
        /// <param name="pooling">A value indicating whether pooling should be enabled.</param>
        /// <returns>The created repository.</returns>
        public IShareRepository CreateFromFile(string filename, bool pooling = false)
            => new SqliteShareRepository($"Data Source={filename};Pooling={pooling}");
    }
}
