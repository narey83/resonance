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
using System.Net;
using Dapper;
using NetTools;
using Npgsql;
using Serilog;

/// <summary>
///     Persists the user-curated block lists — usernames, IP addresses/CIDR ranges and
///     locations — along with the options controlling which interactions blocking disables.
///     Everything is kept in an in-memory snapshot so <see cref="IsBlocked(string, IPAddress, BlockedUserScope)"/>
///     is cheap enough to call from network hot paths.
///     <para>
///     When the same-IP option is on, the IPs blocked users connect from are learned as they
///     appear at the network guards; a different username showing up from a learned IP is
///     auto-blocked (ban evasion via a fresh account).
///     </para>
/// </summary>
public class BlockedUsersService
{
    private volatile Snapshot current = Snapshot.Empty;

    public BlockedUsersService(ConnectionStringDictionary connectionStrings, resonance.Network.GeoService geoService = null)
    {
        ConnectionStrings = connectionStrings;
        UsePostgres = connectionStrings.UsePostgres;
        Geo = geoService;
        EnsureSchema();
        BackfillAllFromHistory();
        Reload();
    }

    /// <summary>
    ///     Raised when a new username is auto-blocked because it appeared from an IP a blocked
    ///     user had used (ban evasion). Arguments are the username and the IP. Used to alert
    ///     connected clients and refresh their block lists.
    /// </summary>
    public event Action<string, string> AutoBlocked;

    /// <summary>
    ///     Gets a value indicating whether the geo database is loaded; place blocking is inert without it.
    /// </summary>
    public bool GeoAvailable => Geo?.IsAvailable == true;

    private ConnectionStringDictionary ConnectionStrings { get; }
    private bool UsePostgres { get; }
    private resonance.Network.GeoService Geo { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", resonance.Logs.Users);
    private object SyncRoot { get; } = new();

    private string UsersTable => UsePostgres ? "blocked.\"Users\"" : "BlockedUsers";
    private string OptionsTable => UsePostgres ? "blocked.\"Options\"" : "BlockedUserOptions";
    private string IpsTable => UsePostgres ? "blocked.\"Ips\"" : "BlockedIps";
    private string PlacesTable => UsePostgres ? "blocked.\"Places\"" : "BlockedPlaces";
    private string UserIpsTable => UsePostgres ? "blocked.\"UserIps\"" : "BlockedUserIps";

    /// <summary>
    ///     Gets a value indicating whether <paramref name="username"/> is blocked, regardless of scope.
    /// </summary>
    /// <returns>A value indicating whether the user is blocked.</returns>
    public bool IsBlocked(string username)
        => username is not null && current.Usernames.Contains(username);

    /// <summary>
    ///     Gets a value indicating whether <paramref name="username"/> is blocked and the
    ///     specified <paramref name="scope"/> is enabled in the blocking options.
    /// </summary>
    /// <returns>A value indicating whether the user is blocked within the given scope.</returns>
    public bool IsBlocked(string username, BlockedUserScope scope)
        => IsBlocked(username, ipAddress: null, scope);

    /// <summary>
    ///     Gets a value indicating whether the specified <paramref name="username"/> and/or
    ///     <paramref name="ipAddress"/> are blocked and the specified <paramref name="scope"/>
    ///     is enabled. An IP is blocked when it was learned from a blocked user (same-IP), when
    ///     it falls in a blocked address/CIDR range, or when it resolves to a blocked location.
    /// </summary>
    /// <returns>A value indicating whether the user or IP address is blocked within the given scope.</returns>
    public bool IsBlocked(string username, IPAddress ipAddress, BlockedUserScope scope)
    {
        var snapshot = current;

        if (!ScopeEnabled(snapshot.Options, scope))
        {
            return false;
        }

        if (username is not null && snapshot.Usernames.Contains(username))
        {
            // learn the IP so a fresh account from the same address is caught
            if (ipAddress is not null && snapshot.Options.BlockSameIp)
            {
                NoteBlockedUserIp(username, ipAddress);
            }

            return true;
        }

        if (ipAddress is null)
        {
            return false;
        }

        if (snapshot.Options.BlockSameIp && snapshot.BlockedUserIps.Contains(ipAddress.ToString()))
        {
            AutoBlock(username, ipAddress);
            return true;
        }

        if (snapshot.IpRanges.Any(range => range.Contains(ipAddress)))
        {
            return true;
        }

        return IsPlaceBlocked(snapshot, ipAddress);
    }

    public IReadOnlyList<BlockedUser> GetAll()
    {
        using var conn = CreateConnection();
        var users = conn.Query<BlockedUser>(
            $"SELECT \"Username\" AS {nameof(BlockedUser.Username)}, \"BlockedAt\" AS {nameof(BlockedUser.BlockedAt)}, \"Reason\" AS {nameof(BlockedUser.Reason)} FROM {UsersTable} ORDER BY \"BlockedAt\" DESC").ToList();

        // attach the IPs learned from each blocked user (most recently seen first)
        var ipsByUser = conn.Query<(string Username, string Ip)>(
                $"SELECT \"Username\", \"Ip\" FROM {UserIpsTable} ORDER BY \"LastSeen\" DESC")
            .GroupBy(r => r.Username, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(r => r.Ip).ToList(), StringComparer.OrdinalIgnoreCase);

        foreach (var user in users)
        {
            user.Ips = ipsByUser.TryGetValue(user.Username, out var ips) ? ips : [];

            // resolve a location from the first known IP that the geo database recognises
            if (Geo?.IsAvailable == true)
            {
                foreach (var ip in user.Ips)
                {
                    var geo = Geo.Lookup(ip);
                    if (geo is not null && (!string.IsNullOrWhiteSpace(geo.Country) || !string.IsNullOrWhiteSpace(geo.City)))
                    {
                        user.Country = geo.Country;
                        user.City = geo.City;
                        break;
                    }
                }
            }
        }

        return users;
    }

    public IReadOnlyList<BlockedIp> GetIps()
    {
        using var conn = CreateConnection();
        return conn.Query<BlockedIp>(
            $"SELECT \"Cidr\" AS {nameof(BlockedIp.Cidr)}, \"BlockedAt\" AS {nameof(BlockedIp.BlockedAt)}, \"Reason\" AS {nameof(BlockedIp.Reason)} FROM {IpsTable} ORDER BY \"BlockedAt\" DESC").ToList();
    }

    public IReadOnlyList<BlockedPlace> GetPlaces()
    {
        using var conn = CreateConnection();
        return conn.Query<BlockedPlace>(
            $"SELECT \"Id\" AS {nameof(BlockedPlace.Id)}, \"Country\" AS {nameof(BlockedPlace.Country)}, \"City\" AS {nameof(BlockedPlace.City)}, \"BlockedAt\" AS {nameof(BlockedPlace.BlockedAt)}, \"Reason\" AS {nameof(BlockedPlace.Reason)} FROM {PlacesTable} ORDER BY \"BlockedAt\" DESC").ToList();
    }

    public BlockedUserOptions GetOptions() => current.Options;

    /// <summary>
    ///     Adds <paramref name="username"/> to the block list (updating the reason if it is
    ///     already present) and returns the updated list.
    /// </summary>
    /// <returns>The updated list of blocked users.</returns>
    public IReadOnlyList<BlockedUser> Block(string username, string reason = null)
    {
        using (var conn = CreateConnection())
        {
            conn.Execute(
                $"DELETE FROM {UsersTable} WHERE LOWER(\"Username\") = LOWER(@Username)",
                new { Username = username });
            conn.Execute(
                $"INSERT INTO {UsersTable} (\"Username\", \"BlockedAt\", \"Reason\") VALUES (@Username, @BlockedAt, @Reason)",
                new { Username = username, BlockedAt = DateTime.UtcNow, Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim() });
        }

        Log.Information("Blocked user {Username}", username);
        BackfillFromHistory(username);
        Reload();
        return GetAll();
    }

    /// <summary>
    ///     Removes <paramref name="username"/> from the block list, case-insensitively, along
    ///     with any IPs learned from them, and returns the updated list.
    /// </summary>
    /// <returns>The updated list of blocked users.</returns>
    public IReadOnlyList<BlockedUser> Unblock(string username)
    {
        using (var conn = CreateConnection())
        {
            var removed = conn.Execute(
                $"DELETE FROM {UsersTable} WHERE LOWER(\"Username\") = LOWER(@Username)",
                new { Username = username });
            conn.Execute(
                $"DELETE FROM {UserIpsTable} WHERE LOWER(\"Username\") = LOWER(@Username)",
                new { Username = username });

            if (removed > 0)
            {
                Log.Information("Unblocked user {Username}", username);
            }
        }

        Reload();
        return GetAll();
    }

    /// <summary>
    ///     Adds an address or CIDR range to the block list and returns the updated list.
    /// </summary>
    /// <returns>The updated list of blocked IP addresses.</returns>
    /// <exception cref="ArgumentException">Thrown when the address or range can't be parsed.</exception>
    public IReadOnlyList<BlockedIp> BlockIp(string cidr, string reason = null)
    {
        cidr = cidr?.Trim();

        try
        {
            _ = IPAddressRange.Parse(cidr);
        }
        catch (Exception ex)
        {
            throw new ArgumentException($"'{cidr}' is not a valid IP address or CIDR range", ex);
        }

        using (var conn = CreateConnection())
        {
            conn.Execute($"DELETE FROM {IpsTable} WHERE \"Cidr\" = @Cidr", new { Cidr = cidr });
            conn.Execute(
                $"INSERT INTO {IpsTable} (\"Cidr\", \"BlockedAt\", \"Reason\") VALUES (@Cidr, @BlockedAt, @Reason)",
                new { Cidr = cidr, BlockedAt = DateTime.UtcNow, Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim() });
        }

        Log.Information("Blocked IP {Cidr}", cidr);
        Reload();
        return GetIps();
    }

    /// <summary>
    ///     Removes an address or CIDR range from the block list and returns the updated list.
    /// </summary>
    /// <returns>The updated list of blocked IP addresses.</returns>
    public IReadOnlyList<BlockedIp> UnblockIp(string cidr)
    {
        using (var conn = CreateConnection())
        {
            conn.Execute($"DELETE FROM {IpsTable} WHERE \"Cidr\" = @Cidr", new { Cidr = cidr?.Trim() });
        }

        Reload();
        return GetIps();
    }

    /// <summary>
    ///     Adds a location to the block list and returns the updated list. Country matches the
    ///     geo database's country name or two-letter ISO code; a city narrows the rule to that
    ///     city only.
    /// </summary>
    /// <returns>The updated list of blocked places.</returns>
    public IReadOnlyList<BlockedPlace> BlockPlace(string country, string city = null, string reason = null)
    {
        if (string.IsNullOrWhiteSpace(country))
        {
            throw new ArgumentException("Country is required");
        }

        using (var conn = CreateConnection())
        {
            conn.Execute(
                $"INSERT INTO {PlacesTable} (\"Country\", \"City\", \"BlockedAt\", \"Reason\") VALUES (@Country, @City, @BlockedAt, @Reason)",
                new
                {
                    Country = country.Trim(),
                    City = string.IsNullOrWhiteSpace(city) ? null : city.Trim(),
                    BlockedAt = DateTime.UtcNow,
                    Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
                });
        }

        Log.Information("Blocked place {Country}{City}", country, string.IsNullOrWhiteSpace(city) ? string.Empty : $"/{city}");
        Reload();
        return GetPlaces();
    }

    /// <summary>
    ///     Removes a location from the block list and returns the updated list.
    /// </summary>
    /// <returns>The updated list of blocked places.</returns>
    public IReadOnlyList<BlockedPlace> UnblockPlace(int id)
    {
        using (var conn = CreateConnection())
        {
            conn.Execute($"DELETE FROM {PlacesTable} WHERE \"Id\" = @Id", new { Id = id });
        }

        Reload();
        return GetPlaces();
    }

    public BlockedUserOptions SetOptions(BlockedUserOptions options)
    {
        using (var conn = CreateConnection())
        {
            conn.Execute(
                $"UPDATE {OptionsTable} SET " +
                "\"BlockTransfers\" = @BlockTransfers, " +
                "\"BlockBrowse\" = @BlockBrowse, " +
                "\"BlockSearchResponses\" = @BlockSearchResponses, " +
                "\"BlockPrivateMessages\" = @BlockPrivateMessages, " +
                "\"HideRoomMessages\" = @HideRoomMessages, " +
                "\"HideSearchResults\" = @HideSearchResults, " +
                "\"BlockSameIp\" = @BlockSameIp " +
                "WHERE \"Id\" = 1",
                options);
        }

        Log.Information("Updated blocked user options: {Options}", options.ToJson());
        Reload();
        return current.Options;
    }

    private static bool ScopeEnabled(BlockedUserOptions options, BlockedUserScope scope) => scope switch
    {
        BlockedUserScope.Transfers => options.BlockTransfers,
        BlockedUserScope.Browse => options.BlockBrowse,
        BlockedUserScope.SearchResponses => options.BlockSearchResponses,
        BlockedUserScope.PrivateMessages => options.BlockPrivateMessages,
        BlockedUserScope.RoomMessages => options.HideRoomMessages,
        BlockedUserScope.SearchResults => options.HideSearchResults,
        _ => true,
    };

    private bool IsPlaceBlocked(Snapshot snapshot, IPAddress ipAddress)
    {
        if (snapshot.Places.Count == 0 || Geo?.IsAvailable != true)
        {
            return false;
        }

        var geo = Geo.Lookup(ipAddress.ToString());

        // some IPs resolve with no country and/or no city; an unknown location never matches
        if (geo is null)
        {
            return false;
        }

        foreach (var place in snapshot.Places)
        {
            var countryMatches =
                Matches(place.Country, geo.Country) || Matches(place.Country, geo.CountryCode);

            if (!countryMatches)
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(place.City) || Matches(place.City, geo.City))
            {
                return true;
            }
        }

        return false;

        static bool Matches(string rule, string actual)
            => !string.IsNullOrWhiteSpace(actual) && string.Equals(rule, actual, StringComparison.OrdinalIgnoreCase);
    }

    // remembers an IP a blocked user connected from, so a fresh username from the same
    // address is caught. Called from network hot paths; exits O(1) once the IP is known.
    private void NoteBlockedUserIp(string username, IPAddress ipAddress)
    {
        var ip = ipAddress.ToString();

        if (current.BlockedUserIps.Contains(ip))
        {
            return;
        }

        lock (SyncRoot)
        {
            if (current.BlockedUserIps.Contains(ip))
            {
                return;
            }

            try
            {
                using var conn = CreateConnection();
                conn.Execute(
                    $"INSERT INTO {UserIpsTable} (\"Username\", \"Ip\", \"LastSeen\") VALUES (@Username, @Ip, @LastSeen) ON CONFLICT (\"Username\", \"Ip\") DO UPDATE SET \"LastSeen\" = @LastSeen",
                    new { Username = username, Ip = ip, LastSeen = DateTime.UtcNow });

                current = current with { BlockedUserIps = current.BlockedUserIps.Add(ip) };
                Log.Information("Learned IP {IP} from blocked user {Username}", ip, username);
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to record IP {IP} for blocked user {Username}: {Message}", ip, username, ex.Message);
            }
        }
    }

    // a username we've never seen appeared from an IP a blocked user used — block it too
    private void AutoBlock(string username, IPAddress ipAddress)
    {
        if (string.IsNullOrWhiteSpace(username) || current.Usernames.Contains(username))
        {
            return;
        }

        try
        {
            Block(username, $"Auto-blocked: same IP ({ipAddress}) as a blocked user");

            // Record the address they were caught on against the new account. NoteBlockedUserIp
            // would skip it (it dedupes on the global known-IP set, and this IP is already known
            // from the account that seeded it), so insert the (username, ip) row directly — that's
            // why this IP would otherwise be missing from the new user's "known IPs".
            try
            {
                using var conn = CreateConnection();
                conn.Execute(
                    $"INSERT INTO {UserIpsTable} (\"Username\", \"Ip\", \"LastSeen\") VALUES (@Username, @Ip, @LastSeen) ON CONFLICT (\"Username\", \"Ip\") DO NOTHING",
                    new { Username = username, Ip = ipAddress.ToString(), LastSeen = DateTime.UtcNow });
                Reload();
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to record triggering IP {IP} for auto-blocked {Username}: {Message}", ipAddress, username, ex.Message);
            }

            Log.Warning("Auto-blocked user {Username} — same IP ({IP}) as a blocked user", username, ipAddress);
            AutoBlocked?.Invoke(username, ipAddress.ToString());
        }
        catch (Exception ex)
        {
            Log.Warning("Failed to auto-block user {Username}: {Message}", username, ex.Message);
        }
    }

    // Seeds a blocked user's known IPs from the historical peer network-info table
    // (transfers.TransferNetworkInfo), which records the IP each user was last seen on.
    // Lets same-IP evasion detection work against addresses a blocked user used before
    // they were blocked, and populates the "known IPs" shown in the UI.
    private void BackfillFromHistory(string username)
    {
        try
        {
            using var transfers = new NpgsqlConnection(ConnectionStrings[Database.Transfers]);
            var networkTable = UsePostgres ? "transfers.\"TransferNetworkInfo\"" : "TransferNetworkInfo";
            var rows = transfers.Query<(string Ip, DateTime LastSeen)>(
                $"SELECT \"IpAddress\", \"LastSeen\" FROM {networkTable} WHERE LOWER(\"Username\") = LOWER(@Username) AND \"IpAddress\" IS NOT NULL AND \"IpAddress\" <> ''",
                new { Username = username }).ToList();

            if (rows.Count == 0)
            {
                return;
            }

            using var conn = CreateConnection();
            foreach (var (ip, lastSeen) in rows)
            {
                conn.Execute(
                    $"INSERT INTO {UserIpsTable} (\"Username\", \"Ip\", \"LastSeen\") VALUES (@Username, @Ip, @LastSeen) ON CONFLICT (\"Username\", \"Ip\") DO NOTHING",
                    new { Username = username, Ip = ip, LastSeen = lastSeen });
            }

            Log.Debug("Backfilled {Count} historical IP(s) for blocked user {Username}", rows.Count, username);
        }
        catch (Exception ex)
        {
            Log.Warning("Failed to backfill historical IPs for {Username}: {Message}", username, ex.Message);
        }
    }

    // One-time seed: give every already-blocked user their historical IPs (from before this
    // feature existed). ON CONFLICT DO NOTHING makes re-running harmless.
    private void BackfillAllFromHistory()
    {
        try
        {
            List<string> usernames;
            using (var conn = CreateConnection())
            {
                usernames = conn.Query<string>($"SELECT \"Username\" FROM {UsersTable}").ToList();
            }

            foreach (var username in usernames)
            {
                BackfillFromHistory(username);
            }
        }
        catch (Exception ex)
        {
            Log.Warning("Failed to backfill historical IPs for blocked users: {Message}", ex.Message);
        }
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
                $"\"HideSearchResults\" AS {nameof(BlockedUserOptions.HideSearchResults)}, " +
                $"\"BlockSameIp\" AS {nameof(BlockedUserOptions.BlockSameIp)} " +
                $"FROM {OptionsTable} WHERE \"Id\" = 1") ?? new BlockedUserOptions();

            var blockedUserIps = conn.Query<string>($"SELECT DISTINCT \"Ip\" FROM {UserIpsTable}")
                .ToImmutableHashSet(StringComparer.Ordinal);

            var ipRanges = conn.Query<string>($"SELECT \"Cidr\" FROM {IpsTable}")
                .Select(cidr =>
                {
                    try
                    {
                        return IPAddressRange.Parse(cidr);
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Ignoring unparseable blocked IP range '{Cidr}': {Message}", cidr, ex.Message);
                        return null;
                    }
                })
                .Where(range => range is not null)
                .ToList();

            var places = conn.Query<BlockedPlace>(
                $"SELECT \"Id\" AS {nameof(BlockedPlace.Id)}, \"Country\" AS {nameof(BlockedPlace.Country)}, \"City\" AS {nameof(BlockedPlace.City)} FROM {PlacesTable}").ToList();

            current = new Snapshot(usernames, options, blockedUserIps, ipRanges, places);
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
        conn.Execute($"ALTER TABLE {OptionsTable} ADD COLUMN IF NOT EXISTS \"BlockSameIp\" BOOLEAN NOT NULL DEFAULT TRUE");

        conn.Execute($"CREATE TABLE IF NOT EXISTS {IpsTable} (\"Cidr\" TEXT PRIMARY KEY NOT NULL, \"BlockedAt\" TIMESTAMPTZ NOT NULL, \"Reason\" TEXT NULL)");
        conn.Execute(
            $"CREATE TABLE IF NOT EXISTS {PlacesTable} (" +
            "\"Id\" INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY, " +
            "\"Country\" TEXT NOT NULL, " +
            "\"City\" TEXT NULL, " +
            "\"BlockedAt\" TIMESTAMPTZ NOT NULL, " +
            "\"Reason\" TEXT NULL)");
        conn.Execute($"CREATE TABLE IF NOT EXISTS {UserIpsTable} (\"Username\" TEXT NOT NULL, \"Ip\" TEXT NOT NULL, \"LastSeen\" TIMESTAMPTZ NOT NULL, PRIMARY KEY (\"Username\", \"Ip\"))");
    }

    private sealed record Snapshot(
        ImmutableHashSet<string> Usernames,
        BlockedUserOptions Options,
        ImmutableHashSet<string> BlockedUserIps,
        IReadOnlyList<IPAddressRange> IpRanges,
        IReadOnlyList<BlockedPlace> Places)
    {
        public static Snapshot Empty { get; } = new(
            ImmutableHashSet<string>.Empty.WithComparer(StringComparer.OrdinalIgnoreCase),
            new BlockedUserOptions(),
            ImmutableHashSet<string>.Empty,
            [],
            []);
    }
}
