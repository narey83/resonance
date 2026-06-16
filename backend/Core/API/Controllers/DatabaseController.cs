// <copyright file="DatabaseController.cs" company="JP Dillingham">
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

namespace resonance.Core.API
{
    using System;
    using System.Collections.Generic;
    using System.IO;
    using System.Linq;
    using System.Text.RegularExpressions;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Data.Sqlite;

    [Route("api/v{version:apiVersion}/[controller]")]
    [ApiVersion("0")]
    [ApiController]
    [Produces("application/json")]
    [Consumes("application/json")]
    public class DatabaseController : ControllerBase
    {
        public DatabaseController(ConnectionStringDictionary connectionStrings)
        {
            ConnectionStrings = connectionStrings;
        }

        private ConnectionStringDictionary ConnectionStrings { get; }

        private static readonly Regex WritePattern = new(
            @"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private Dictionary<string, string> GetAllConnectionStrings()
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var db in Database.List)
            {
                dict[db.Name] = ConnectionStrings[db].Value;
            }

            var sharesDb = Path.Combine(Program.DataDirectory, "shares.local.db");
            if (System.IO.File.Exists(sharesDb))
            {
                dict["shares"] = $"Data Source={sharesDb};Cache=shared";
            }

            var musicDb = Path.Combine(Program.DataDirectory, "music.db");
            if (System.IO.File.Exists(musicDb))
            {
                dict["music"] = $"Data Source={musicDb};Cache=Shared";
            }

            return dict;
        }

        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult ListDatabases()
        {
            var names = GetAllConnectionStrings().Keys.OrderBy(k => k).ToList();
            return Ok(names);
        }

        [HttpGet("{name}/schema")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult GetSchema(string name)
        {
            var connStrings = GetAllConnectionStrings();
            if (!connStrings.TryGetValue(name, out var connStr))
            {
                return NotFound($"Database '{name}' not found");
            }

            try
            {
                var schema = new Dictionary<string, List<object>>();
                using var conn = new SqliteConnection(connStr);
                conn.Open();

                using var tableCmd = new SqliteCommand(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;", conn);
                using var tableReader = tableCmd.ExecuteReader();
                var tables = new List<string>();
                while (tableReader.Read())
                {
                    tables.Add(tableReader.GetString(0));
                }

                tableReader.Close();

                foreach (var table in tables)
                {
                    var cols = new List<object>();
                    using var colCmd = new SqliteCommand($"PRAGMA table_info(\"{table}\");", conn);
                    using var colReader = colCmd.ExecuteReader();
                    while (colReader.Read())
                    {
                        cols.Add(new
                        {
                            name = colReader.GetString(colReader.GetOrdinal("name")),
                            type = colReader.GetString(colReader.GetOrdinal("type")),
                            notNull = colReader.GetInt64(colReader.GetOrdinal("notnull")) > 0,
                            primaryKey = colReader.GetInt64(colReader.GetOrdinal("pk")) > 0,
                        });
                    }

                    schema[table] = cols;
                }

                return Ok(schema);
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        [HttpPost("{name}/query")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult Query(string name, [FromBody] QueryRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Sql))
            {
                return BadRequest("SQL is required");
            }

            var trimmed = request.Sql.Trim();
            if (!trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest("Only SELECT queries are allowed");
            }

            if (WritePattern.IsMatch(trimmed))
            {
                return BadRequest("Only SELECT queries are allowed");
            }

            var connStrings = GetAllConnectionStrings();
            if (!connStrings.TryGetValue(name, out var connStr))
            {
                return NotFound($"Database '{name}' not found");
            }

            try
            {
                using var conn = new SqliteConnection(connStr);
                conn.Open();
                using var cmd = new SqliteCommand(trimmed, conn);
                cmd.CommandTimeout = 10;

                using var reader = cmd.ExecuteReader();
                var columns = Enumerable.Range(0, reader.FieldCount)
                    .Select(i => reader.GetName(i))
                    .ToList();

                var rows = new List<List<object>>();
                var limit = request.Limit > 0 ? Math.Min(request.Limit, 5000) : 500;
                while (reader.Read() && rows.Count < limit)
                {
                    var row = new List<object>();
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        row.Add(reader.IsDBNull(i) ? null : reader.GetValue(i));
                    }

                    rows.Add(row);
                }

                return Ok(new { columns, rows });
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        public record QueryRequest(string Sql, int Limit = 500);
    }
}
