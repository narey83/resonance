// <copyright file="DatabaseController.cs" company="JP Dillingham">
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

namespace resonance.Core.API
{
    using System;
    using System.Collections.Generic;
    using System.Data.Common;
    using System.IO;
    using System.Linq;
    using System.Text.RegularExpressions;
    using Asp.Versioning;
    using Microsoft.AspNetCore.Authorization;
    using Microsoft.AspNetCore.Mvc;
    using Microsoft.Data.Sqlite;
    using Npgsql;

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
            @"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|GRANT|REVOKE|COPY|VACUUM)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>
        ///     Describes the physical location of a logical database exposed by the viewer.
        /// </summary>
        /// <remarks>
        ///     For SQLite each logical database is a standalone file. For PostgreSQL every module shares a single
        ///     connection string and is separated by a per-module schema (see <c>HasDefaultSchema</c> on each DbContext).
        /// </remarks>
        private sealed record DbSource(string ConnectionString, bool IsPostgres, string Schema);

        // Maps a logical database to its PostgreSQL schema. Most schemas match the database name, but a few
        // diverge (see each DbContext's HasDefaultSchema call). Keep this in sync with those.
        private static string PostgresSchema(Database db) => db.Name switch
        {
            "resonance-users" => "users",
            "library-activity" => "library_activity",
            _ => db.Name, // search, transfers, messaging, events, preferences, ytdlp, logs, music, waveform, mixtapes
        };

        private Dictionary<string, DbSource> GetAllSources()
        {
            var dict = new Dictionary<string, DbSource>(StringComparer.OrdinalIgnoreCase);
            foreach (var db in Database.List)
            {
                dict[db.Name] = new DbSource(
                    ConnectionString: ConnectionStrings[db].Value,
                    IsPostgres: ConnectionStrings.UsePostgres,
                    Schema: ConnectionStrings.UsePostgres ? PostgresSchema(db) : null);
            }

            // shares and music are always standalone SQLite files, even when the app is configured for PostgreSQL.
            var sharesDb = Path.Combine(Program.DataDirectory, "shares.local.db");
            if (System.IO.File.Exists(sharesDb))
            {
                dict["shares"] = new DbSource($"Data Source={sharesDb};Cache=shared", IsPostgres: false, Schema: null);
            }

            var musicDb = Path.Combine(Program.DataDirectory, "music.db");
            if (System.IO.File.Exists(musicDb))
            {
                dict["music"] = new DbSource($"Data Source={musicDb};Cache=Shared", IsPostgres: false, Schema: null);
            }

            return dict;
        }

        private static DbConnection OpenConnection(DbSource source)
        {
            DbConnection conn = source.IsPostgres
                ? new NpgsqlConnection(source.ConnectionString)
                : new SqliteConnection(source.ConnectionString);
            conn.Open();

            // Scope unqualified table names (used by the viewer's generated queries) to the module's schema.
            if (source.IsPostgres && !string.IsNullOrEmpty(source.Schema))
            {
                using var setCmd = conn.CreateCommand();
                setCmd.CommandText = $"SET search_path TO \"{source.Schema}\"";
                setCmd.ExecuteNonQuery();
            }

            return conn;
        }

        [HttpGet]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult ListDatabases()
        {
            var names = GetAllSources().Keys.OrderBy(k => k).ToList();
            return Ok(names);
        }

        [HttpGet("{name}/schema")]
        [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
        public IActionResult GetSchema(string name)
        {
            var sources = GetAllSources();
            if (!sources.TryGetValue(name, out var source))
            {
                return NotFound($"Database '{name}' not found");
            }

            try
            {
                using var conn = OpenConnection(source);
                var schema = source.IsPostgres
                    ? GetPostgresSchema(conn, source.Schema)
                    : GetSqliteSchema(conn);
                return Ok(schema);
            }
            catch (Exception ex)
            {
                return StatusCode(500, ex.Message);
            }
        }

        private static Dictionary<string, List<object>> GetSqliteSchema(DbConnection conn)
        {
            var schema = new Dictionary<string, List<object>>();

            using var tableCmd = conn.CreateCommand();
            tableCmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;";
            var tables = new List<string>();
            using (var tableReader = tableCmd.ExecuteReader())
            {
                while (tableReader.Read())
                {
                    tables.Add(tableReader.GetString(0));
                }
            }

            foreach (var table in tables)
            {
                var cols = new List<object>();
                using var colCmd = conn.CreateCommand();
                colCmd.CommandText = $"PRAGMA table_info(\"{table}\");";
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

            return schema;
        }

        private static Dictionary<string, List<object>> GetPostgresSchema(DbConnection conn, string schemaName)
        {
            // Pull every column for the schema in one pass, flagging primary keys via the constraint catalog.
            var schema = new Dictionary<string, List<object>>();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    c.table_name,
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    (pk.column_name IS NOT NULL) AS is_pk
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT kcu.table_name, kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                        AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = @schema
                ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
                WHERE c.table_schema = @schema
                ORDER BY c.table_name, c.ordinal_position;
                """;
            var schemaParam = cmd.CreateParameter();
            schemaParam.ParameterName = "@schema";
            schemaParam.Value = schemaName;
            cmd.Parameters.Add(schemaParam);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var table = reader.GetString(reader.GetOrdinal("table_name"));
                if (!schema.TryGetValue(table, out var cols))
                {
                    cols = new List<object>();
                    schema[table] = cols;
                }

                cols.Add(new
                {
                    name = reader.GetString(reader.GetOrdinal("column_name")),
                    type = reader.GetString(reader.GetOrdinal("data_type")),
                    notNull = string.Equals(reader.GetString(reader.GetOrdinal("is_nullable")), "NO", StringComparison.OrdinalIgnoreCase),
                    primaryKey = reader.GetBoolean(reader.GetOrdinal("is_pk")),
                });
            }

            return schema;
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
            if (!(trimmed.StartsWith("SELECT", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("WITH", StringComparison.OrdinalIgnoreCase)))
            {
                return BadRequest("Only SELECT queries are allowed");
            }

            if (WritePattern.IsMatch(trimmed))
            {
                return BadRequest("Only SELECT queries are allowed");
            }

            var sources = GetAllSources();
            if (!sources.TryGetValue(name, out var source))
            {
                return NotFound($"Database '{name}' not found");
            }

            try
            {
                using var conn = OpenConnection(source);
                using var cmd = conn.CreateCommand();
                cmd.CommandText = trimmed;
                cmd.CommandTimeout = 10;

                using var reader = cmd.ExecuteReader();
                var columns = Enumerable.Range(0, reader.FieldCount)
                    .Select(reader.GetName)
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
