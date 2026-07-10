// <copyright file="BlockedUsersService.cs" company="John Narey">
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

namespace resonance.Users.Blocking;

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using System.Data.Common;
using System.Linq;
using Dapper;
using Npgsql;
using Serilog;

/// <summary>
///     Persists the user-curated list of blocked Soulseek users along with the
///     options controlling which interactions blocking disables. The list and
///     options are kept in an in-memory snapshot so that <see cref="IsBlocked(string, BlockedUserScope)"/>
///     is cheap enough to call from network hot paths.
/// </summary>
public class BlockedUsersService
{
    public BlockedUsersService(ConnectionStringDictionary connectionStrings)
    {
        ConnectionStrings = connectionStrings;
        UsePostgres = connectionStrings.UsePostgres;
        EnsureSchema();
        Reload();
    }

    private ConnectionStringDictionary ConnectionStrings { get; }
    private bool UsePostgres { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext<BlockedUsersService>();
    private object SyncRoot { get; } = new();

    private volatile Snapshot Current = new(ImmutableHashSet<string>.Empty.WithComparer(StringComparer.OrdinalIgnoreCase), new BlockedUserOptions());

    private string UsersTable => UsePostgres ? "blocked.\"Users\"" : "BlockedUsers";
    private string OptionsTable => UsePostgres ? "blocked.\"Options\"" : "BlockedUserOptions";

    /// <summary>
    ///     Gets a value indicating whether <paramref name="username"/> is blocked, regardless of scope.
    /// </summary>
    public bool IsBlocked(string username)
        => username is not null && Current.Usernames.Contains(username);

    /// <summary>
    ///     Gets a value indicating whether <paramref name="username"/> is blocked and the
    ///     specified <paramref name="scope"/> is enabled in the blocking options.
    /// </summary>
    public bool IsBlocked(string username, BlockedUserScope scope)
    {
        var snapshot = Current;

        if (username is null || !snapshot.Usernames.Contains(username))
        {
            return false;
        }

        return scope switch
        {
            BlockedUserScope.Transfers => snapshot.Options.BlockTransfers,
            BlockedUserScope.Browse => snapshot.Options.BlockBrowse,
            BlockedUserScope.SearchResponses => snapshot.Options.BlockSearchResponses,
            BlockedUserScope.PrivateMessages => snapshot.Options.BlockPrivateMessages,
            BlockedUserScope.RoomMessages => snapshot.Options.HideRoomMessages,
            BlockedUserScope.SearchResults => snapshot.Options.HideSearchResults,
            _ => true,
        };
    }

    public IReadOnlyList<BlockedUser> GetAll()
    {
        using var conn = CreateConnection();
        return conn.Query<BlockedUser>(
            $"SELECT \"Username\" AS {nameof(BlockedUser.Username)}, \"BlockedAt\" AS {nameof(BlockedUser.BlockedAt)}, \"Reason\" AS {nameof(BlockedUser.Reason)} FROM {UsersTable} ORDER BY \"BlockedAt\" DESC").ToList();
    }

    public BlockedUserOptions GetOptions() => Current.Options;

    /// <summary>
    ///     Adds <paramref name="username"/> to the block list (updating the reason if it is
    ///     already present) and returns the updated list.
    /// </summary>
    public IReadOnlyList<BlockedUser> Block(string username, string reason = null)
    {
        using var conn = CreateConnection();
        conn.Execute(
            $"DELETE FROM {UsersTable} WHERE LOWER(\"Username\") = LOWER(@Username)",
            new { Username = username });
        conn.Execute(
            $"INSERT INTO {UsersTable} (\"Username\", \"BlockedAt\", \"Reason\") VALUES (@Username, @BlockedAt, @Reason)",
            new { Username = username, BlockedAt = DateTime.UtcNow, Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim() });

        Log.Information("Blocked user {Username}", username);
        Reload();
        return GetAll();
    }

    /// <summary>
    ///     Removes <paramref name="username"/> from the block list, case-insensitively,
    ///     and returns the updated list.
    /// </summary>
    public IReadOnlyList<BlockedUser> Unblock(string username)
    {
        using var conn = CreateConnection();
        var removed = conn.Execute(
            $"DELETE FROM {UsersTable} WHERE LOWER(\"Username\") = LOWER(@Username)",
            new { Username = username });

        if (removed > 0)
        {
            Log.Information("Unblocked user {Username}", username);
        }

        Reload();
        return GetAll();
    }

    public BlockedUserOptions SetOptions(BlockedUserOptions options)
    {
        using var conn = CreateConnection();
        conn.Execute(
            $"UPDATE {OptionsTable} SET " +
            "\"BlockTransfers\" = @BlockTransfers, " +
            "\"BlockBrowse\" = @BlockBrowse, " +
            "\"BlockSearchResponses\" = @BlockSearchResponses, " +
            "\"BlockPrivateMessages\" = @BlockPrivateMessages, " +
            "\"HideRoomMessages\" = @HideRoomMessages, " +
            "\"HideSearchResults\" = @HideSearchResults " +
            "WHERE \"Id\" = 1",
            options);

        Log.Information("Updated blocked user options: {Options}", options.ToJson());
        Reload();
        return Current.Options;
    }

    private DbConnection CreateConnection() => new NpgsqlConnection(ConnectionStrings[Database.Preferences]);

    private void Reload()
    {
        lock (SyncRoot)
        {
            using var conn = CreateConnection();

            var usernames = conn.Query<string>($"SELECT \"Username\" FROM {UsersTable}")
                .ToImmutableHashSet(StringComparer.OrdinalIgnoreCase);

            var options = conn.QueryFirstOrDefault<BlockedUserOptions>(
                $"SELECT \"BlockTransfers\" AS {nameof(BlockedUserOptions.BlockTransfers)}, " +
                $"\"BlockBrowse\" AS {nameof(BlockedUserOptions.BlockBrowse)}, " +
                $"\"BlockSearchResponses\" AS {nameof(BlockedUserOptions.BlockSearchResponses)}, " +
                $"\"BlockPrivateMessages\" AS {nameof(BlockedUserOptions.BlockPrivateMessages)}, " +
                $"\"HideRoomMessages\" AS {nameof(BlockedUserOptions.HideRoomMessages)}, " +
                $"\"HideSearchResults\" AS {nameof(BlockedUserOptions.HideSearchResults)} " +
                $"FROM {OptionsTable} WHERE \"Id\" = 1") ?? new BlockedUserOptions();

            Current = new Snapshot(usernames, options);
        }
    }

    private void EnsureSchema()
    {
        using var conn = CreateConnection();

        if (UsePostgres)
        {
            conn.Execute("CREATE SCHEMA IF NOT EXISTS blocked");
        }

        conn.Execute($"CREATE TABLE IF NOT EXISTS {UsersTable} (\"Username\" TEXT PRIMARY KEY NOT NULL, \"BlockedAt\" TIMESTAMPTZ NOT NULL, \"Reason\" TEXT NULL)");
        conn.Execute(
            $"CREATE TABLE IF NOT EXISTS {OptionsTable} (" +
            "\"Id\" INTEGER PRIMARY KEY NOT NULL, " +
            "\"BlockTransfers\" BOOLEAN NOT NULL DEFAULT TRUE, " +
            "\"BlockBrowse\" BOOLEAN NOT NULL DEFAULT TRUE, " +
            "\"BlockSearchResponses\" BOOLEAN NOT NULL DEFAULT TRUE, " +
            "\"BlockPrivateMessages\" BOOLEAN NOT NULL DEFAULT TRUE, " +
            "\"HideRoomMessages\" BOOLEAN NOT NULL DEFAULT TRUE, " +
            "\"HideSearchResults\" BOOLEAN NOT NULL DEFAULT TRUE)");
        conn.Execute($"INSERT INTO {OptionsTable} (\"Id\") VALUES (1) ON CONFLICT DO NOTHING");
    }

    private sealed record Snapshot(ImmutableHashSet<string> Usernames, BlockedUserOptions Options);
}
