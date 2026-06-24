// <copyright file="DatabaseMigrator.cs" company="John Narey">
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
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;
using Npgsql;
using NpgsqlTypes;
using Serilog;

/// <summary>
///     Migrates all data between SQLite and PostgreSQL in either direction.
///     Tables must already exist in the destination (created by normal DB init).
/// </summary>
public class DatabaseMigrator
{
    private const int BatchSize = 500;
    private static readonly HashSet<string> SkipTables = new(StringComparer.OrdinalIgnoreCase)
    {
        "__EFMigrationsHistory",
        "sqlite_sequence",
    };

    private ILogger Log { get; } = Serilog.Log.ForContext<DatabaseMigrator>();

    /// <summary>
    ///     Migrates all SQLite data to Postgres. Handles both the new single-file layout
    ///     (resonance.db) and the old per-database layout ({name}.db).
    /// </summary>
    public void MigrateToPostgres(string dataDirectory, string postgresConnectionString)
    {
        using var postgres = new NpgsqlConnection(postgresConnectionString);
        postgres.Open();

        var pgTables = ListAllPostgresTables(postgres);  // list of (schema, table, qualified)
        var pgColTypes = GetPostgresColumnTypes(postgres);

        // Prefer single-file layout; fall back to per-database files
        var singleFile = Path.Combine(dataDirectory, "resonance.db");
        IEnumerable<string> sqliteFiles = File.Exists(singleFile)
            ? [singleFile]
            : Directory.GetFiles(dataDirectory, "*.db")
                .Where(f => !f.Contains(Path.DirectorySeparatorChar + "backups" + Path.DirectorySeparatorChar));

        foreach (var file in sqliteFiles)
        {
            // Use the db file's base name (without extension) as a schema hint
            var schemaHint = Path.GetFileNameWithoutExtension(file).ToLowerInvariant();

            Log.Information("Migrating from {File}...", file);
            using var sqlite = new SqliteConnection($"Data Source={file}");
            sqlite.Open();

            // Retry tables that fail FK constraints — parent rows may not exist yet.
            // Run up to 5 passes so arbitrary FK chains resolve.
            var pending = ListSqliteTables(sqlite);
            for (int pass = 1; pass <= 5 && pending.Count > 0; pass++)
            {
                var retry = new List<string>();
                foreach (var table in pending)
                {
                    var qualifiedTable = ResolvePostgresTable(pgTables, table, schemaHint);
                    if (qualifiedTable == null)
                    {
                        Log.Warning("No Postgres table found for SQLite table '{Table}' (in {File}), skipping",
                            table, Path.GetFileName(file));
                        continue;
                    }

                    var result = CopySqliteToPostgres(sqlite, postgres, table, qualifiedTable,
                        pgColTypes.GetValueOrDefault(qualifiedTable, []));

                    if (result == CopyResult.FkViolation)
                    {
                        Log.Warning("FK violation on {Table}, will retry (pass {Pass})", table, pass);
                        retry.Add(table);
                    }

                    // SchemaMismatch: wrong table was matched; skip silently (warning already logged)
                }

                pending = retry;
            }

            if (pending.Count > 0)
            {
                Log.Error("Could not migrate tables after all passes: {Tables}", string.Join(", ", pending));
            }
        }

        ResetPostgresIdentitySequences(postgres);
        Log.Information("SQLite → PostgreSQL migration complete");
    }

    public void MigrateToSqlite(string sqliteFile, string postgresConnectionString)
    {
        Log.Information("Starting PostgreSQL → SQLite data migration to {File}", sqliteFile);

        using var postgres = new NpgsqlConnection(postgresConnectionString);
        postgres.Open();

        using var sqlite = new SqliteConnection($"Data Source={sqliteFile}");
        sqlite.Open();

        var pgTables = ListAllPostgresTables(postgres);

        foreach (var (_, tableName, qualifiedTable) in pgTables)
            CopyPostgresToSqlite(postgres, sqlite, qualifiedTable, tableName);

        Log.Information("PostgreSQL → SQLite migration complete");
    }

    private enum CopyResult
    {
        Ok,
        FkViolation,
        SchemaMismatch
    }

    // ── SQLite → Postgres ──────────────────────────────────────────────────────
    private CopyResult CopySqliteToPostgres(
        SqliteConnection sqlite,
        NpgsqlConnection postgres,
        string srcTable,
        string dstTable,
        Dictionary<string, string> pgColTypes)
    {
        var columns = GetSqliteColumns(sqlite, srcTable);
        if (columns.Count == 0)
        {
            return CopyResult.Ok;
        }

        var count = CountRows(sqlite, $"\"{srcTable}\"");
        if (count == 0)
        {
            Log.Debug("Table {Table} empty, skipping", srcTable);
            return CopyResult.Ok;
        }

        Log.Information("Migrating {Table} → {Dst} ({Count} rows)...", srcTable, dstTable, count);

        var colList = string.Join(", ", columns.Select(c => $"\"{c}\""));
        var paramList = string.Join(", ", columns.Select(c => $"@p_{c}"));
        var sql = $"INSERT INTO {dstTable} ({colList}) VALUES ({paramList}) ON CONFLICT DO NOTHING";

        using var srcCmd = sqlite.CreateCommand();
        srcCmd.CommandText = $"SELECT {colList} FROM \"{srcTable}\"";

        using var reader = srcCmd.ExecuteReader();

        var tx = postgres.BeginTransaction();
        long inserted = 0, batch = 0;

        try
        {
            while (reader.Read())
            {
                using var dstCmd = new NpgsqlCommand(sql, postgres, tx);

                for (int i = 0; i < columns.Count; i++)
                {
                    var col = columns[i];
                    var raw = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    var pgType = pgColTypes.GetValueOrDefault(col);
                    dstCmd.Parameters.Add(MakePostgresParam($"p_{col}", raw, pgType));
                }

                dstCmd.ExecuteNonQuery();
                inserted++;

                if (++batch >= BatchSize)
                {
                    tx.Commit();
                    tx.Dispose();
                    tx = postgres.BeginTransaction();
                    batch = 0;
                }
            }

            tx.Commit();
            tx.Dispose();
            Log.Information("  → {Count} rows inserted into {Dst}", inserted, dstTable);
            return CopyResult.Ok;
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "23503") // FK violation
        {
            try
            {
                tx.Rollback();
            }
            catch
            {
            }

            tx.Dispose();
            return CopyResult.FkViolation;
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "42703") // column does not exist
        {
            try
            {
                tx.Rollback();
            }
            catch
            {
            }

            tx.Dispose();
            Log.Warning("Column mismatch migrating {Table} → {Dst} (wrong schema match?): {Msg}", srcTable, dstTable, ex.MessageText);
            return CopyResult.SchemaMismatch;
        }
        catch
        {
            try
            {
                tx.Rollback();
            }
            catch
            {
            }

            tx.Dispose();
            throw;
        }
    }

    // ── Postgres → SQLite ──────────────────────────────────────────────────────
    private void CopyPostgresToSqlite(
        NpgsqlConnection postgres,
        SqliteConnection sqlite,
        string srcQualified,
        string dstTable)
    {
        var columns = GetPostgresColumns(postgres, srcQualified);
        if (columns.Count == 0)
        {
            return;
        }

        var count = CountRows(postgres, srcQualified);
        if (count == 0)
        {
            Log.Debug("Table {Table} empty, skipping", srcQualified);
            return;
        }

        Log.Information("Migrating {Src} → {Dst} ({Count} rows)...", srcQualified, dstTable, count);

        var colList = string.Join(", ", columns.Select(c => $"\"{c}\""));
        var paramList = string.Join(", ", columns.Select(c => $"@p_{c}"));
        var sql = $"INSERT OR REPLACE INTO \"{dstTable}\" ({colList}) VALUES ({paramList})";

        using var srcCmd = postgres.CreateCommand();
        srcCmd.CommandText = $"SELECT {colList} FROM {srcQualified}";

        using var reader = srcCmd.ExecuteReader();

        using var tx = sqlite.BeginTransaction();
        long inserted = 0, batch = 0;

        while (reader.Read())
        {
            using var dstCmd = sqlite.CreateCommand();
            dstCmd.Transaction = tx;
            dstCmd.CommandText = sql;

            for (int i = 0; i < columns.Count; i++)
            {
                var col = columns[i];
                var raw = reader.IsDBNull(i) ? null : reader.GetValue(i);
                dstCmd.Parameters.AddWithValue($"@p_{col}", ToSqliteValue(raw) ?? DBNull.Value);
            }

            dstCmd.ExecuteNonQuery();
            inserted++;

            if (++batch >= BatchSize)
            {
                tx.Commit();
                batch = 0;
            }
        }

        tx.Commit();
        Log.Information("  → {Count} rows inserted into {Dst}", inserted, dstTable);
    }

    // ── Schema discovery ───────────────────────────────────────────────────────
    private static List<string> ListSqliteTables(SqliteConnection conn)
    {
        var tables = new List<string>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var name = r.GetString(0);
            if (!SkipTables.Contains(name))
            {
                tables.Add(name);
            }
        }

        return tables;
    }

    // Returns: list of (schema, table, "schema"."table")
    private static List<(string Schema, string Table, string Qualified)> ListAllPostgresTables(NpgsqlConnection conn)
    {
        var list = new List<(string, string, string)>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
            """;
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var schema = r.GetString(0);
            var table = r.GetString(1);
            if (!SkipTables.Contains(table))
            {
                list.Add((schema, table, $"\"{schema}\".\"{table}\""));
            }
        }

        return list;
    }

    // Resolves the best Postgres table for a given SQLite table name.
    // Prefers a schema whose name matches the source file's base name (e.g. music.db → music schema).
    private static string ResolvePostgresTable(
        List<(string Schema, string Table, string Qualified)> pgTables,
        string sqliteTable,
        string schemaHint)
    {
        var matches = pgTables
            .Where(t => t.Table.Equals(sqliteTable, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (matches.Count == 0)
        {
            return null;
        }

        if (matches.Count == 1)
        {
            return matches[0].Qualified;
        }

        // Multiple schemas have a table with this name — prefer the one matching the source file
        var preferred = matches.FirstOrDefault(t => t.Schema.Equals(schemaHint, StringComparison.OrdinalIgnoreCase));
        return preferred.Qualified ?? matches[0].Qualified;
    }

    // Returns: "schema"."table" → (column_name → pg data_type)
    private static Dictionary<string, Dictionary<string, string>> GetPostgresColumnTypes(NpgsqlConnection conn)
    {
        var result = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT table_schema, table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
            """;
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var key = $"\"{r.GetString(0)}\".\"{r.GetString(1)}\"";
            if (!result.TryGetValue(key, out var cols))
            {
                result[key] = cols = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }

            cols[r.GetString(2)] = r.GetString(3);
        }

        return result;
    }

    private static List<string> GetSqliteColumns(SqliteConnection conn, string table)
    {
        var cols = new List<string>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info(\"{table}\")";
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            cols.Add(r.GetString(1));
        }

        return cols;
    }

    private static List<string> GetPostgresColumns(NpgsqlConnection conn, string qualifiedTable)
    {
        var parts = qualifiedTable.Replace("\"", string.Empty).Split('.');
        var cols = new List<string>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = @s AND table_name = @t
            ORDER BY ordinal_position
            """;
        cmd.Parameters.AddWithValue("s", parts[0]);
        cmd.Parameters.AddWithValue("t", parts[1]);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            cols.Add(r.GetString(0));
        }

        return cols;
    }

    // ── Type conversion ────────────────────────────────────────────────────────
    private static NpgsqlParameter MakePostgresParam(string name, object raw, string pgType)
    {
        if (raw == null)
        {
            return new NpgsqlParameter(name, DBNull.Value);
        }

        try
        {
            if (pgType != null)
            {
                if (pgType is "uuid" && raw is string uuidStr)
                {
                    return new NpgsqlParameter(name, Guid.Parse(uuidStr));
                }

                if (pgType is "boolean")
                {
                    var b = raw switch
                    {
                        long l => l != 0,
                        int i => i != 0,
                        bool bv => bv,
                        string s => s is "1" or "true" or "True",
                        _ => false,
                    };
                    return new NpgsqlParameter(name, b);
                }

                if (pgType is "timestamp with time zone" or "timestamp without time zone" or "date"
                    && raw is string tsStr && DateTime.TryParse(tsStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
                {
                    return new NpgsqlParameter(name, DateTime.SpecifyKind(dt, DateTimeKind.Utc));
                }

                if (pgType is "jsonb" or "json" && raw is string jsonStr)
                {
                    return new NpgsqlParameter(name, jsonStr) { NpgsqlDbType = NpgsqlDbType.Jsonb };
                }
            }
        }
        catch (Exception ex)
        {
            Serilog.Log.Warning("Type conversion failed for param {Name} (pgType={PgType}, value={Value}): {Ex}",
                name, pgType, raw, ex.Message);
            return new NpgsqlParameter(name, DBNull.Value);
        }

        return new NpgsqlParameter(name, raw);
    }

    private static object ToSqliteValue(object val) => val switch
    {
        Guid g => g.ToString(),
        bool b => b ? 1L : 0L,
        DateTime dt => dt.ToString("O"),
        DateTimeOffset dto => dto.UtcDateTime.ToString("O"),
        _ => val,
    };

    // ── Helpers ────────────────────────────────────────────────────────────────
    private static long CountRows(IDbConnection conn, string table)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM {table}";
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    // After inserting rows with explicit IDs, identity sequences may still be at 1.
    // Reset each to MAX(id) so the next insert doesn't collide.
    private void ResetPostgresIdentitySequences(NpgsqlConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT table_schema, table_name, column_name
            FROM information_schema.columns
            WHERE is_identity = 'YES'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            """;

        var identityCols = new List<(string Schema, string Table, string Column)>();
        using (var r = cmd.ExecuteReader())
        {
            while (r.Read())
            {
                identityCols.Add((r.GetString(0), r.GetString(1), r.GetString(2)));
            }
        }

        foreach (var (schema, table, column) in identityCols)
        {
            using var maxCmd = conn.CreateCommand();
            maxCmd.CommandText = $"SELECT COALESCE(MAX(\"{column}\"), 0) FROM \"{schema}\".\"{table}\"";
            var maxVal = Convert.ToInt64(maxCmd.ExecuteScalar());
            if (maxVal <= 0)
            {
                continue;
            }

            using var restartCmd = conn.CreateCommand();
            restartCmd.CommandText = $"ALTER TABLE \"{schema}\".\"{table}\" ALTER COLUMN \"{column}\" RESTART WITH {maxVal + 1}";
            restartCmd.ExecuteNonQuery();
            Log.Debug("Reset identity sequence for {Schema}.{Table}.{Column} to {Next}", schema, table, column, maxVal + 1);
        }

        Log.Information("Identity sequences reset");
    }
}
