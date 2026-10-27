// <copyright file="SettingsService.cs" company="John Narey">
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

namespace resonance.Core.Settings;

using System.Collections.Generic;
using System.Data.Common;
using Dapper;
using Npgsql;
using Serilog;

/// <summary>
///     Persists application configuration as flattened key/value rows in the database, replacing the
///     legacy YAML configuration file as the canonical settings store.
/// </summary>
/// <remarks>
///     Keys are the same colon-delimited, normalized keys the configuration stack produces
///     (e.g. <c>resonance:soulseek:username</c>, arrays as <c>resonance:shares:directories:0</c>), so the
///     values bind to <c>Options</c> with no additional mapping.
/// </remarks>
public class SettingsService
{
    public SettingsService(string connectionString, bool usePostgres = true)
    {
        ConnectionString = connectionString;
        UsePostgres = usePostgres;
        EnsureSchema();
    }

    private bool UsePostgres { get; }
    private string T => UsePostgres ? "settings.\"Setting\"" : "Setting";

    private string ConnectionString { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Settings);

    /// <summary>
    ///     Returns every stored setting as a flattened key/value map.
    /// </summary>
    /// <returns>The flattened key/value pairs.</returns>
    public Dictionary<string, string> GetAll()
    {
        using var conn = CreateConnection();
        var rows = conn.Query<(string Key, string Value)>($"SELECT \"Key\", \"Value\" FROM {T}");
        var result = new Dictionary<string, string>();
        foreach (var (key, value) in rows)
        {
            result[key] = value;
        }

        return result;
    }

    /// <summary>
    ///     Returns a value indicating whether the settings table has no rows (i.e. the app has never been seeded).
    /// </summary>
    /// <returns>True if the settings table is empty; otherwise false.</returns>
    public bool IsEmpty()
    {
        using var conn = CreateConnection();
        return conn.ExecuteScalar<long>($"SELECT COUNT(*) FROM {T}") == 0;
    }

    /// <summary>
    ///     Upserts each non-null value and deletes keys whose value is null, in a single transaction.
    /// </summary>
    /// <param name="updates">The keys and values to persist. A null value deletes the key.</param>
    public void SetMany(IReadOnlyDictionary<string, string> updates)
    {
        if (updates is null || updates.Count == 0)
        {
            return;
        }

        using var conn = CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();

        foreach (var (key, value) in updates)
        {
            if (value is null)
            {
                conn.Execute($"DELETE FROM {T} WHERE \"Key\" = @Key", new { Key = key }, tx);
            }
            else
            {
                conn.Execute(
                    $"INSERT INTO {T} (\"Key\", \"Value\") VALUES (@Key, @Value) " +
                    "ON CONFLICT(\"Key\") DO UPDATE SET \"Value\" = excluded.\"Value\"",
                    new { Key = key, Value = value },
                    tx);
            }
        }

        tx.Commit();
    }

    /// <summary>
    ///     Replaces the entire contents of the settings table with the given key/value map, in a single
    ///     transaction. Used when the whole configuration document is saved from the UI.
    /// </summary>
    /// <param name="values">The complete set of settings to store.</param>
    public void Replace(IReadOnlyDictionary<string, string> values)
    {
        using var conn = CreateConnection();
        conn.Open();
        using var tx = conn.BeginTransaction();

        conn.Execute($"DELETE FROM {T}", transaction: tx);

        foreach (var (key, value) in values)
        {
            if (value is null)
            {
                continue;
            }

            conn.Execute(
                $"INSERT INTO {T} (\"Key\", \"Value\") VALUES (@Key, @Value)",
                new { Key = key, Value = value },
                tx);
        }

        tx.Commit();
    }

    private DbConnection CreateConnection() => UsePostgres ? new NpgsqlConnection(ConnectionString) : new Microsoft.Data.Sqlite.SqliteConnection(ConnectionString);

    private void EnsureSchema()
    {
        using var conn = CreateConnection();
        if (UsePostgres)
        {
            conn.Execute("CREATE SCHEMA IF NOT EXISTS settings");
        }

        conn.Execute($"CREATE TABLE IF NOT EXISTS {T} (\"Key\" TEXT PRIMARY KEY NOT NULL, \"Value\" TEXT NOT NULL)");
    }
}
