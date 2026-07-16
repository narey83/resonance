// <copyright file="BrowseHistoryService.cs" company="John Narey">
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

namespace resonance.Core.BrowseHistory;

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Text.Json;
using Dapper;
using Npgsql;
using Serilog;

/// <summary>
///     Persists the list of users whose shares have been browsed, most recent first,
///     shared by every connected client (web and mobile).
/// </summary>
public class BrowseHistoryService
{
    public const int MaxEntries = 25;

    public BrowseHistoryService(ConnectionStringDictionary connectionStrings)
    {
        ConnectionStrings = connectionStrings;
        UsePostgres = connectionStrings.UsePostgres;
        EnsureSchema();
        MigrateLegacyPreference();
    }

    private ConnectionStringDictionary ConnectionStrings { get; }
    private bool UsePostgres { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext<BrowseHistoryService>();

    private string T => UsePostgres ? "browse.\"History\"" : "BrowseHistory";

    public IReadOnlyList<string> GetAll()
    {
        using var conn = CreateConnection();
        return conn.Query<string>(
            $"SELECT \"Username\" FROM {T} ORDER BY \"BrowsedAt\" DESC LIMIT @Limit",
            new { Limit = MaxEntries }).ToList();
    }

    /// <summary>
    ///     Adds <paramref name="username"/> to the history (or bumps it to the top),
    ///     trimming the list to <see cref="MaxEntries"/>. Returns the updated list.
    /// </summary>
    /// <returns>The updated browse history.</returns>
    public IReadOnlyList<string> Add(string username)
    {
        using var conn = CreateConnection();
        conn.Execute(
            $"DELETE FROM {T} WHERE LOWER(\"Username\") = LOWER(@Username)",
            new { Username = username });
        conn.Execute(
            $"INSERT INTO {T} (\"Username\", \"BrowsedAt\") VALUES (@Username, @BrowsedAt)",
            new { Username = username, BrowsedAt = DateTime.UtcNow });
        conn.Execute(
            $"DELETE FROM {T} WHERE \"Username\" NOT IN (SELECT \"Username\" FROM {T} ORDER BY \"BrowsedAt\" DESC LIMIT @Limit)",
            new { Limit = MaxEntries });

        return GetAll();
    }

    /// <summary>
    ///     Removes <paramref name="username"/> from the history, case-insensitively.
    ///     Returns the updated list.
    /// </summary>
    /// <returns>The updated browse history.</returns>
    public IReadOnlyList<string> Remove(string username)
    {
        using var conn = CreateConnection();
        conn.Execute(
            $"DELETE FROM {T} WHERE LOWER(\"Username\") = LOWER(@Username)",
            new { Username = username });

        return GetAll();
    }

    private DbConnection CreateConnection() => new NpgsqlConnection(ConnectionStrings[Database.Preferences]);

    /// <summary>
    ///     One-time seed from the legacy client-side preference: browse history used
    ///     to live in the 'resonance-browse-history' key that web clients synced via
    ///     the preferences API. If the history table is empty and that key holds a
    ///     list, adopt it so existing users keep their history after the upgrade.
    /// </summary>
    private void MigrateLegacyPreference()
    {
        if (!UsePostgres)
        {
            return;
        }

        try
        {
            using var conn = CreateConnection();
            var count = conn.ExecuteScalar<long>($"SELECT COUNT(*) FROM {T}");
            if (count > 0)
            {
                return;
            }

            var raw = conn.QueryFirstOrDefault<string>(
                "SELECT \"Value\" FROM preferences.\"Preferences\" WHERE \"Key\" = 'resonance-browse-history'");
            if (string.IsNullOrWhiteSpace(raw))
            {
                return;
            }

            var usernames = JsonSerializer.Deserialize<List<string>>(raw) ?? [];
            var timestamp = DateTime.UtcNow;
            foreach (var username in usernames.Where(u => !string.IsNullOrWhiteSpace(u)).Take(MaxEntries))
            {
                conn.Execute(
                    $"INSERT INTO {T} (\"Username\", \"BrowsedAt\") VALUES (@Username, @BrowsedAt) ON CONFLICT DO NOTHING",
                    new { Username = username.Trim(), BrowsedAt = timestamp });

                // Preserve the legacy list's most-recent-first ordering.
                timestamp = timestamp.AddSeconds(-1);
            }

            Log.Information("Migrated {Count} browse history entries from legacy preference", usernames.Count);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to migrate legacy browse history preference");
        }
    }

    private void EnsureSchema()
    {
        using var conn = CreateConnection();
        if (UsePostgres)
        {
            conn.Execute("CREATE SCHEMA IF NOT EXISTS browse");
        }

        conn.Execute($"CREATE TABLE IF NOT EXISTS {T} (\"Username\" TEXT PRIMARY KEY NOT NULL, \"BrowsedAt\" TIMESTAMPTZ NOT NULL)");
    }
}
