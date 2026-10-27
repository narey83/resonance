// <copyright file="TransferNetworkInfoStore.cs" company="John Narey">
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
using System.Threading.Tasks;
using Dapper;

public sealed class TransferNetworkInfoStore
{
    private readonly ConnectionStringDictionary connections;
    public TransferNetworkInfoStore(ConnectionStringDictionary connections) => this.connections = connections;
    private string Table => connections.UsePostgres ? "transfers.\"TransferNetworkInfo\"" : "TransferNetworkInfo";

    public void Initialize()
    {
        if (connections.UsePostgres)
        {
            return; // Existing PostgreSQL DDL and trigram index remain in startup.
        }

        using var connection = connections.CreateConnection(Database.Transfers);
        connection.Execute("""
            CREATE TABLE IF NOT EXISTS TransferNetworkInfo (
              Username TEXT PRIMARY KEY, IpAddress TEXT NOT NULL, Country TEXT, City TEXT,
              IsVpn INTEGER NOT NULL DEFAULT 0, Lat REAL, Lon REAL, LastSeen TEXT NOT NULL);
            """);
    }

    public System.Collections.Generic.IReadOnlyList<(string Username, string IpAddress)> GetPeerAddresses(System.Collections.Generic.IEnumerable<string> usernames)
    {
        using var connection = connections.CreateConnection(Database.Transfers);
        return System.Linq.Enumerable.ToList(connection.Query<(string Username, string IpAddress)>(
            $"SELECT \"Username\",\"IpAddress\" FROM {Table} WHERE \"Username\" IN @names AND \"IpAddress\" IS NOT NULL AND \"IpAddress\" <> ''",
            new { names = usernames }));
    }

    public Task UpsertAsync(string username, string ip, string country, string city, bool isVpn, double? lat, double? lon)
    {
        return SaveAsync();
        async Task SaveAsync()
        {
            using var connection = connections.CreateConnection(Database.Transfers);
            await connection.ExecuteAsync($"""
                INSERT INTO {Table} ("Username","IpAddress","Country","City","IsVpn","Lat","Lon","LastSeen")
                VALUES (@username,@ip,@country,@city,@vpn,@lat,@lon,@seen)
                ON CONFLICT("Username") DO UPDATE SET "IpAddress"=excluded."IpAddress", "Country"=excluded."Country",
                "City"=excluded."City", "IsVpn"=excluded."IsVpn", "Lat"=excluded."Lat", "Lon"=excluded."Lon", "LastSeen"=excluded."LastSeen"
                """, new { username, ip, country, city, vpn = isVpn ? 1 : 0, lat, lon, seen = DateTime.UtcNow });
        }
    }
}
