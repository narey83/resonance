// <copyright file="NetworkController.cs" company="JP Dillingham">
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

namespace resonance.Network;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using resonance.Core.API;

[Route("api/v{version:apiVersion}/[controller]")]
[ApiVersion("0")]
[ApiController]
[Produces("application/json")]
public class NetworkController : ControllerBase
{
    private static readonly MemoryCache Cache = new(new MemoryCacheOptions());
    private const string CacheKey = "network_info";

    public NetworkController(IHttpClientFactory httpClientFactory, GeoService geoService)
    {
        HttpClientFactory = httpClientFactory;
        GeoService = geoService;
    }

    private IHttpClientFactory HttpClientFactory { get; }
    private GeoService GeoService { get; }

    [HttpGet("info")]
    [Authorize(Policy = AuthPolicy.Any)]
    public async Task<IActionResult> GetInfo()
    {
        if (Cache.TryGetValue(CacheKey, out NetworkInfo cached))
        {
            return Ok(cached);
        }

        try
        {
            var info = await FetchIpInfo(string.Empty);
            Cache.Set(CacheKey, info, TimeSpan.FromMinutes(5));
            return Ok(info);
        }
        catch
        {
            return StatusCode(502, "IP lookup unavailable");
        }
    }

    [HttpGet("lookup")]
    [Authorize(Policy = AuthPolicy.Any)]
    public async Task<IActionResult> Lookup([FromQuery] string ip)
    {
        if (string.IsNullOrWhiteSpace(ip))
        {
            return BadRequest("ip is required");
        }

        var cacheKey = $"ip:{ip}";
        if (Cache.TryGetValue(cacheKey, out NetworkInfo cached))
        {
            return Ok(cached);
        }

        // Try local GeoLite2 DB first — instant, no rate limits
        var geo = GeoService.Lookup(ip);
        if (geo != null)
        {
            var localInfo = new NetworkInfo(ip, geo.Country, geo.CountryCode, geo.City, null, false, geo.Lat, geo.Lon);
            Cache.Set(cacheKey, localInfo, TimeSpan.FromMinutes(30));
            return Ok(localInfo);
        }

        try
        {
            var info = await FetchIpInfo(ip);
            Cache.Set(cacheKey, info, TimeSpan.FromMinutes(30));
            return Ok(info);
        }
        catch
        {
            return StatusCode(502, "IP lookup unavailable");
        }
    }

    /// <summary>Resolve many IPs at once using the local GeoLite2 database.</summary>
    /// <returns></returns>
    [HttpPost("batch")]
    [Authorize(Policy = AuthPolicy.Any)]
    public IActionResult Batch([FromBody] string[] ips)
    {
        if (ips == null || ips.Length == 0)
        {
            return Ok(new Dictionary<string, object>());
        }

        var result = new Dictionary<string, object>();
        foreach (var ip in ips.Distinct().Take(2000))
        {
            var geo = GeoService.Lookup(ip);
            if (geo?.Lat != null && geo?.Lon != null)
            {
                result[ip] = new { lat = geo.Lat, lon = geo.Lon, country = geo.Country, city = geo.City };
            }
        }

        return Ok(result);
    }

    private async Task<NetworkInfo> FetchIpInfo(string ip)
    {
        using var http = HttpClientFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(5);
        var target = string.IsNullOrEmpty(ip) ? string.Empty : $"/{ip}";
        var json = await http.GetStringAsync($"http://ip-api.com/json{target}?fields=status,query,country,countryCode,city,isp,proxy,hosting,lat,lon");
        var result = JsonSerializer.Deserialize<IpApiResponse>(json);

        if (result?.Status != "success")
        {
            throw new InvalidOperationException("IP lookup failed");
        }

        return new NetworkInfo(
            Ip: result.Query,
            Country: result.Country,
            CountryCode: result.CountryCode,
            City: result.City,
            Isp: result.Isp,
            IsVpn: result.Proxy || result.Hosting,
            Lat: result.Lat,
            Lon: result.Lon);
    }

    private sealed record IpApiResponse(
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("query")] string Query,
        [property: JsonPropertyName("country")] string Country,
        [property: JsonPropertyName("countryCode")] string CountryCode,
        [property: JsonPropertyName("city")] string City,
        [property: JsonPropertyName("isp")] string Isp,
        [property: JsonPropertyName("proxy")] bool Proxy,
        [property: JsonPropertyName("hosting")] bool Hosting,
        [property: JsonPropertyName("lat")] double? Lat,
        [property: JsonPropertyName("lon")] double? Lon);
}

public sealed record NetworkInfo(
    string Ip,
    string? Country,
    string? CountryCode,
    string? City,
    string? Isp,
    bool IsVpn,
    double? Lat,
    double? Lon);
