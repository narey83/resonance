// <copyright file="PreferencesService.cs" company="John Narey">
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

namespace resonance.Core.Preferences;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Text.Json;
using Dapper;
using Npgsql;
using Serilog;

public class PreferencesService
{
    public PreferencesService(ConnectionStringDictionary connectionStrings)
    {
        ConnectionStrings = connectionStrings;
        UsePostgres = connectionStrings.UsePostgres;
        EnsureSchema();
    }

    private ConnectionStringDictionary ConnectionStrings { get; }
    private bool UsePostgres { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext<PreferencesService>();

    private DbConnection CreateConnection() => new NpgsqlConnection(ConnectionStrings[Database.Preferences]);

    private string T => UsePostgres ? "preferences.\"Preferences\"" : "Preferences";

    public Dictionary<string, JsonElement> GetAll()
    {
        using var conn = CreateConnection();
        var rows = conn.Query<(string Key, string Value)>($"SELECT \"Key\", \"Value\" FROM {T}");
        var result = new Dictionary<string, JsonElement>();
        foreach (var (key, value) in rows)
        {
            try
            {
                var element = JsonDocument.Parse(value).RootElement.Clone();

                // Verify the element can be re-serialized — JSON text from JS may contain lone
                // surrogates (e.g. \uD83D) which parse fine but fail on .NET's JSON writer.
                using var probe = new System.IO.MemoryStream();
                using var writer = new System.Text.Json.Utf8JsonWriter(probe);
                element.WriteTo(writer);
                result[key] = element;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Skipping malformed preference {Key}", key);
            }
        }

        return result;
    }

    public void Patch(Dictionary<string, JsonElement> updates)
    {
        using var conn = CreateConnection();
        foreach (var (key, value) in updates)
        {
            var raw = value.GetRawText();
            try
            {
                using var probe = new System.IO.MemoryStream();
                using var writer = new System.Text.Json.Utf8JsonWriter(probe);
                value.WriteTo(writer);
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Rejecting preference {Key} — value contains invalid JSON (lone surrogate?)", key);
                continue;
            }

            conn.Execute(
                $"INSERT INTO {T} (\"Key\", \"Value\") VALUES (@Key, @Value) " +
                "ON CONFLICT(\"Key\") DO UPDATE SET \"Value\" = excluded.\"Value\"",
                new { Key = key, Value = raw });
        }
    }

    private void EnsureSchema()
    {
        using var conn = CreateConnection();
        if (UsePostgres)
        {
            conn.Execute("CREATE SCHEMA IF NOT EXISTS preferences");
        }

        conn.Execute($"CREATE TABLE IF NOT EXISTS {T} (\"Key\" TEXT PRIMARY KEY NOT NULL, \"Value\" TEXT NOT NULL)");
    }
}
