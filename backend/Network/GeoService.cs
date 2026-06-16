// <copyright file="GeoService.cs" company="JP Dillingham">
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

namespace resonance.Network;

using System;
using System.IO;
using MaxMind.GeoIP2;
using Serilog;

public sealed class GeoService : IDisposable
{
    private DatabaseReader? reader;

    public bool IsAvailable => reader != null;

    public void Load(string path)
    {
        if (!File.Exists(path))
        {
            Log.Information("GeoLite2 database not found at {Path} — falling back to ip-api.com", path);
            return;
        }

        try
        {
            reader?.Dispose();
            reader = new DatabaseReader(path);
            Log.Information("Loaded GeoLite2 database from {Path}", path);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load GeoLite2 database from {Path}", path);
        }
    }

    public GeoResult? Lookup(string ip)
    {
        if (reader == null)
        {
            return null;
        }

        try
        {
            if (!reader.TryCity(ip, out var city))
            {
                return null;
            }

            return new GeoResult(
                Lat: city.Location.Latitude,
                Lon: city.Location.Longitude,
                Country: city.Country.Name,
                CountryCode: city.Country.IsoCode,
                City: city.City.Name);
        }
        catch
        {
            return null;
        }
    }

    public void Dispose() => reader?.Dispose();
}

public sealed record GeoResult(double? Lat, double? Lon, string? Country, string? CountryCode, string? City);
