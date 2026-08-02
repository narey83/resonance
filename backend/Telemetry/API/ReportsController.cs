// <copyright file="ReportsController.cs" company="JP Dillingham">
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

namespace resonance.Telemetry;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using resonance.Authentication;
using Serilog;
using Soulseek;

/// <summary>
///     Reports.
/// </summary>
[Route("api/v{version:apiVersion}/telemetry/[controller]")]
[Tags("Telemetry")]
[ApiVersion("0")]
[ApiController]
[Produces("application/json")]
public class ReportsController : ControllerBase
{
    /// <summary>
    ///     Initializes a new instance of the <see cref="ReportsController"/> class.
    /// </summary>
    public ReportsController(TelemetryService telemetryService)
    {
        Telemetry = telemetryService;
    }

    private TelemetryService Telemetry { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    /// <summary>
    ///     Gets a summary of all transfer activity over the specified timeframe, grouped by direction and final state.
    /// </summary>
    /// <param name="start">The start time of the window (default: 7 days ago).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="direction">An optional direction (Upload, Download) by which to filter records.</param>
    /// <param name="username">An optional username by which to filter records.</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/summary")]
    [Authorize(Policy = AuthPolicy.Any)]
    [ProducesResponseType(typeof(Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(403)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferSummary(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string direction = null,
        [FromQuery] string username = null)
    {
        // Anyone may fetch their own summary (e.g. the personal Overview
        // page); the global aggregate (no username) or another user's
        // summary remains Administrator-only.
        if (!IsAdminOrSelf(username))
        {
            return Forbid();
        }

        var now = DateTime.UtcNow;

        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        TransferDirection? transferDirection = null;

        if (!string.IsNullOrWhiteSpace(direction))
        {
            if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
            {
                return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
            }

            transferDirection = parsedDirection;
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferSummary(
                start: start.Value,
                end: end,
                direction: transferDirection,
                username: username));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer summary over {Start}-{End}: {Message}", start, end, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets a histogram of all transfer activity over the specified timeframe, aggregated into fixed size time intervals
    ///     and grouped by direction and final state.
    /// </summary>
    /// <param name="start">The start time of the window (default: 7 days ago).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="interval">The interval, in minutes (default: 60).</param>
    /// <param name="direction">An optional direction (Upload, Download) by which to filter records.</param>
    /// <param name="username">An optional username by which to filter records.</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/histogram")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(Dictionary<DateTime, Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferHistogram(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] int interval = 60,
        [FromQuery] string direction = null,
        [FromQuery] string username = null)
    {
        var now = DateTime.UtcNow;

        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        // clamp the start time to the earliest reasonable date to avoid returning a ton of empty intervals
        // and introducing performance issues client side
        if (start < Program.GenesisDateTime)
        {
            Log.Warning("A start time prior to the genesis date of the application was supplied; the start time has been adjusted to the genesis time {Genesis}", Program.GenesisDateTime);
            start = Program.GenesisDateTime;
        }

        if (interval < 1)
        {
            return BadRequest("Interval must be greater than or equal to 1");
        }

        var intervalTimeSpan = TimeSpan.FromMinutes(interval);

        TransferDirection? transferDirection = null;

        if (!string.IsNullOrWhiteSpace(direction))
        {
            if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
            {
                return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
            }

            transferDirection = parsedDirection;
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferHistogram(
                start: start.Value,
                end: end.Value,
                interval: intervalTimeSpan,
                direction: transferDirection,
                username: username));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer histogram over {Start}-{End}/{Interval}: {Message}", start, end, interval, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the top N user summaries by count, total bytes, or average speed.
    /// </summary>
    /// <param name="direction">The direction (Upload, Download).</param>
    /// <param name="start">The start time of the window (default: 12/30/2025).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="sortBy">The property by which to sort (Count, TotalBytes, AverageSpeed. Default: Count).</param>
    /// <param name="sortOrder">The sort order (ASC, DESC. Default: DESC).</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/leaderboard")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<TransferSummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferLeaderboard(
        [FromQuery] string direction,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string sortBy = "Count",
        [FromQuery] string sortOrder = "DESC",
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(direction))
        {
            return BadRequest("Direction is required");
        }

        if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
        {
            return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
        }

        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (!Enum.TryParse<LeaderboardSortBy>(sortBy, out var parsedSortBy))
        {
            return BadRequest($"Invalid sortBy; expected one of: {string.Join(", ", Enum.GetNames(typeof(LeaderboardSortBy)))}");
        }

        // An omitted query parameter binds as null rather than taking the C# default, and the
        // parse is case-sensitive, so both "no sortOrder" and "desc" were rejected outright.
        if (!Enum.TryParse<SortOrder>(string.IsNullOrWhiteSpace(sortOrder) ? nameof(SortOrder.DESC) : sortOrder, ignoreCase: true, out var parsedSortOrder))
        {
            return BadRequest($"Invalid sortOrder; expected one of: {string.Join(", ", Enum.GetNames(typeof(SortOrder)))}");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferLeaderboard(
                direction: parsedDirection,
                start: start.Value,
                end: end,
                sortBy: parsedSortBy,
                sortOrder: parsedSortOrder,
                limit: limit,
                offset: offset));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer leaderboard over {Start}-{End}: {Message}", start, end, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets detailed transfer activity for the specified user.
    /// </summary>
    /// <param name="username">The username of the user.</param>
    /// <param name="start">The start time of the summary window (default: 7 days ago).</param>
    /// <param name="end">The end time of the summary window (default: now).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/users/{username}")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(Dictionary<TransferDirection, UserDirectionTransferSummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetUserDetails(
        [FromRoute, UrlEncoded] string username,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        static UserDirectionTransferStatistics GetStatistics(Dictionary<TransferStates, TransferSummary> summary)
        {
            var totalTransfers = summary.Values.Sum(x => x.Count);
            var successful = summary.Where(x => x.Key == TransferStates.Succeeded).Sum(x => x.Value.Count);
            var errored = summary.Where(x => new[] { TransferStates.Errored, TransferStates.TimedOut, TransferStates.Rejected, TransferStates.Aborted }.Contains(x.Key)).Sum(x => x.Value.Count);
            var cancelled = summary.Where(x => x.Key == TransferStates.Cancelled).Sum(x => x.Value.Count);

            return new UserDirectionTransferStatistics
            {
                Total = totalTransfers,
                Successful = successful,
                Errored = errored,
                Cancelled = cancelled,
            };
        }

        try
        {
            var results = new Dictionary<TransferDirection, UserDirectionTransferSummary>();

            var summary = Telemetry.Reports.GetTransferSummary(start, end, username: username);

            results.Add(TransferDirection.Upload, new UserDirectionTransferSummary
            {
                Summary = summary[TransferDirection.Upload],
                Statistics = GetStatistics(summary[TransferDirection.Upload]),
                Exceptions = Telemetry.Reports.GetTransferExceptionsPareto(TransferDirection.Upload, start, end, username: username, limit: 25, offset: 0),
            });

            results.Add(TransferDirection.Download, new UserDirectionTransferSummary
            {
                Summary = summary[TransferDirection.Download],
                Statistics = GetStatistics(summary[TransferDirection.Download]),
                Exceptions = Telemetry.Reports.GetTransferExceptionsPareto(TransferDirection.Download, start, end, username: username, limit: 25, offset: 0),
            });

            return Ok(results);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching user details for {Username}: {Message}", username, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets a list of transfer exceptions by direction.
    /// </summary>
    /// <param name="direction">The direction.</param>
    /// <param name="start">The start time.</param>
    /// <param name="end">The end time.</param>
    /// <param name="username">An optional username by which to filter exceptions.</param>
    /// <param name="sortOrder">The sort order (ASC, DESC. Default: DESC).</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/exceptions")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<TransferExceptionDetail>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferExceptions(
        [FromQuery] string direction = null,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string username = null,
        [FromQuery] string sortOrder = "DESC",
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(direction))
        {
            return BadRequest("Direction is required");
        }

        if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
        {
            return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
        }

        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        // An omitted query parameter binds as null rather than taking the C# default, and the
        // parse is case-sensitive, so both "no sortOrder" and "desc" were rejected outright.
        if (!Enum.TryParse<SortOrder>(string.IsNullOrWhiteSpace(sortOrder) ? nameof(SortOrder.DESC) : sortOrder, ignoreCase: true, out var parsedSortOrder))
        {
            return BadRequest($"Invalid sortOrder; expected one of: {string.Join(", ", Enum.GetNames(typeof(SortOrder)))}");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferExceptions(
                direction: parsedDirection,
                start: start.Value,
                end: end.Value,
                username: username,
                sortOrder: parsedSortOrder,
                limit: limit,
                offset: offset));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer exceptions over {Start}-{End}: {Message}", start, end, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the top N exceptions by total count and direction.
    /// </summary>
    /// <param name="direction">The direction.</param>
    /// <param name="start">The start time.</param>
    /// <param name="end">The end time.</param>
    /// <param name="username">An optional username by which to filter exceptions.</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/exceptions/pareto")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<TransferExceptionSummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferExceptionsPareto(
        [FromQuery] string direction,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string username = null,
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(direction))
        {
            return BadRequest("Direction is required");
        }

        if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
        {
            return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
        }

        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferExceptionsPareto(
                direction: parsedDirection,
                start: start.Value,
                end: end.Value,
                limit: limit,
                offset: offset,
                username: username));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer exceptions over {Start}-{End}: {Message}", start, end, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets a paginated list of all users with aggregate transfer statistics.
    /// </summary>
    /// <param name="start">The start time of the window (default: genesis).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="username">An optional username prefix filter.</param>
    /// <param name="search">An optional username substring filter.</param>
    /// <param name="sortBy">The property by which to sort (UploadCount, DownloadCount, UploadBytes, DownloadBytes, Errors, LastSeen). Default: LastSeen.</param>
    /// <param name="sortOrder">The sort order (ASC, DESC. Default: DESC).</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/users")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<UserReportSummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetUserList(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string username = null,
        [FromQuery] string search = null,
        [FromQuery] string sortBy = "LastSeen",
        [FromQuery] string sortOrder = "DESC",
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (!Enum.TryParse<UserReportSortBy>(sortBy, ignoreCase: true, out var parsedSortBy))
        {
            return BadRequest($"Invalid sortBy; expected one of: {string.Join(", ", Enum.GetNames(typeof(UserReportSortBy)))}");
        }

        // An omitted query parameter binds as null rather than taking the C# default, and the
        // parse is case-sensitive, so both "no sortOrder" and "desc" were rejected outright.
        if (!Enum.TryParse<SortOrder>(string.IsNullOrWhiteSpace(sortOrder) ? nameof(SortOrder.DESC) : sortOrder, ignoreCase: true, out var parsedSortOrder))
        {
            return BadRequest($"Invalid sortOrder; expected one of: {string.Join(", ", Enum.GetNames(typeof(SortOrder)))}");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        var effectiveSearch = string.IsNullOrWhiteSpace(search)
            ? (string.IsNullOrWhiteSpace(username) ? null : username)
            : search;

        try
        {
            var (items, total) = Telemetry.Reports.GetUserList(
                start: start.Value,
                end: end,
                search: effectiveSearch,
                sortBy: parsedSortBy,
                sortOrder: parsedSortOrder,
                limit: limit,
                offset: offset);

            Response.Headers.Append("X-Total-Count", total.ToString());
            return Ok(items);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching user list: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets paginated individual transfer records for the specified user.
    /// </summary>
    /// <param name="username">The username of the user.</param>
    /// <param name="direction">An optional direction (Upload, Download) by which to filter.</param>
    /// <param name="start">The start time of the window (default: genesis).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="sortOrder">The sort order (ASC, DESC. Default: DESC).</param>
    /// <param name="search">An optional term matched against the filename (and its path).</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/users/{username}/transfers")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<UserTransferRecord>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetUserTransfers(
        [FromRoute, UrlEncoded] string username,
        [FromQuery] string direction = null,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string sortOrder = "DESC",
        [FromQuery] string search = null,
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        TransferDirection? transferDirection = null;

        if (!string.IsNullOrWhiteSpace(direction))
        {
            if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
            {
                return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
            }

            transferDirection = parsedDirection;
        }

        // An omitted query parameter binds as null rather than taking the C# default, and the
        // parse is case-sensitive, so both "no sortOrder" and "desc" were rejected outright.
        if (!Enum.TryParse<SortOrder>(string.IsNullOrWhiteSpace(sortOrder) ? nameof(SortOrder.DESC) : sortOrder, ignoreCase: true, out var parsedSortOrder))
        {
            return BadRequest($"Invalid sortOrder; expected one of: {string.Join(", ", Enum.GetNames(typeof(SortOrder)))}");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            var (items, total) = Telemetry.Reports.GetUserTransfers(
                username: username,
                direction: transferDirection,
                start: start.Value,
                end: end,
                sortOrder: parsedSortOrder,
                search: search,
                limit: limit,
                offset: offset);

            Response.Headers.Append("X-Total-Count", total.ToString());
            return Ok(items);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfers for {Username}: {Message}", username, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets a paginated page of finished transfers across all users.
    /// </summary>
    /// <param name="direction">The transfer direction to limit results to.</param>
    /// <param name="state">An optional term matched against the state description (e.g. Succeeded, Errored).</param>
    /// <param name="start">The start time of the window (default: genesis).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="sortOrder">The sort order, by end time.</param>
    /// <param name="search">An optional term matched against the filename or the peer's username.</param>
    /// <param name="limit">The number of records to return (Default: 50).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/history")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<UserTransferRecord>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferHistory(
        [FromQuery] string direction = null,
        [FromQuery] string state = null,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string sortOrder = "DESC",
        [FromQuery] string search = null,
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0)
    {
        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        TransferDirection? transferDirection = null;

        if (!string.IsNullOrWhiteSpace(direction))
        {
            if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsedDirection))
            {
                return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
            }

            transferDirection = parsedDirection;
        }

        // An omitted query parameter binds as null rather than taking the C# default, and the
        // parse is case-sensitive, so both "no sortOrder" and "desc" were rejected outright.
        if (!Enum.TryParse<SortOrder>(string.IsNullOrWhiteSpace(sortOrder) ? nameof(SortOrder.DESC) : sortOrder, ignoreCase: true, out var parsedSortOrder))
        {
            return BadRequest($"Invalid sortOrder; expected one of: {string.Join(", ", Enum.GetNames(typeof(SortOrder)))}");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            var (items, total, totalBytes) = Telemetry.Reports.GetTransferHistory(
                direction: transferDirection,
                state: state,
                start: start.Value,
                end: end,
                sortOrder: parsedSortOrder,
                search: search,
                limit: limit,
                offset: offset);

            // Same convention the other paginated report endpoints use; the byte total rides
            // alongside so the page can show a volume for the current filter without a second call.
            Response.Headers.Append("X-Total-Count", total.ToString());
            Response.Headers.Append("X-Total-Bytes", totalBytes.ToString());
            return Ok(items);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer history: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets paginated browse event timestamps for the specified user.
    /// </summary>
    /// <param name="username">The username of the user.</param>
    /// <param name="start">The start time of the window (default: genesis).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="limit">The number of records to return (Default: 50).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/users/{username}/browse")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<DateTime>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetUserBrowseEvents(
        [FromRoute, UrlEncoded] string username,
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            var (timestamps, total) = Telemetry.Reports.GetUserBrowseEvents(
                username: username,
                start: start.Value,
                end: end,
                limit: limit,
                offset: offset);

            Response.Headers.Append("X-Total-Count", total.ToString());
            return Ok(timestamps);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching browse events for {Username}: {Message}", username, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the top N most-downloaded individual files (uploaded from this server).
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/files")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<TransferFileSummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTopFiles(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] int limit = 10,
        [FromQuery] int offset = 0)
    {
        start ??= Program.GenesisDateTime;
        end ??= DateTime.UtcNow;

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetTopFiles(start, end, limit, offset));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching top files: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the top N most frequently downloaded directories by total count and distinct users.
    /// </summary>
    /// <param name="start">The start time of the window (default: 12/30/2025).</param>
    /// <param name="end">The end time of the window (default: now).</param>
    /// <param name="username">An optional username by which to filter records.</param>
    /// <param name="limit">The number of records to return (Default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns></returns>
    /// <response code="200">The request completed successfully.</response>
    /// <response code="400">Bad request.</response>
    /// <response code="500">An error occurred.</response>
    [HttpGet("transfers/directories")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<TransferDirectorySummary>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetTransferDirectoryFrequency(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string username = null,
        [FromQuery] int limit = 25,
        [FromQuery] int offset = 0)
    {
        start ??= Program.GenesisDateTime;
        end ??= DateTime.MaxValue;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        if (offset < 0)
        {
            return BadRequest("Offset must be greater than or equal to zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetTransferDirectoryFrequency(
                start: start,
                end: end,
                username: username,
                limit: limit,
                offset: offset));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching transfer directories over {Start}-{End}: {Message}", start, end, ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    [HttpGet("transfers/users/{username}/network")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(UserNetworkInfo), 200)]
    [ProducesResponseType(404)]
    public IActionResult GetUserNetworkInfo([FromRoute, UrlEncoded] string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest("Username is required");
        }

        var info = Telemetry.Reports.GetUserNetworkInfo(username);
        if (info == null)
        {
            return NotFound();
        }

        return Ok(info);
    }

    /// <summary>Returns browse and chat event counts for a batch of usernames.</summary>
    /// <returns></returns>
    [HttpPost("users/event-counts")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(Dictionary<string, UserEventCounts>), 200)]
    public IActionResult GetUserEventCounts([FromBody] string[] usernames, [FromQuery] string start)
    {
        if (usernames == null || usernames.Length == 0)
        {
            return Ok(new Dictionary<string, UserEventCounts>());
        }

        var since = DateTime.TryParse(start, out var dt) ? dt : DateTime.UtcNow.AddDays(-365);
        return Ok(Telemetry.Reports.GetUserEventCounts(usernames, since));
    }

    /// <summary>
    ///     Gets a day-of-week by hour-of-day (UTC) heatmap of successful transfer activity.
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/heatmap")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<HeatmapCell>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetActivityHeatmap(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] string direction = null)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        TransferDirection? transferDirection = null;
        if (!string.IsNullOrWhiteSpace(direction))
        {
            if (!Enum.TryParse<TransferDirection>(direction, ignoreCase: true, out var parsed))
            {
                return BadRequest($"Invalid direction; expected one of: {string.Join(", ", Enum.GetNames(typeof(TransferDirection)))}");
            }

            transferDirection = parsed;
        }

        try
        {
            return Ok(Telemetry.Reports.GetActivityHeatmap(start, end, transferDirection));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching activity heatmap: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the top countries by upload volume plus VPN usage among active peers.
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/geography")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(GeographyReport), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetGeography(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null,
        [FromQuery] int limit = 10)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        if (limit <= 0)
        {
            return BadRequest("Limit must be greater than zero");
        }

        try
        {
            return Ok(Telemetry.Reports.GetGeography(start, end, limit));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching geography report: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the distribution of terminal download transfers by number of attempts.
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/retries")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(List<RetryBucket>), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetRetryFunnel(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        try
        {
            return Ok(Telemetry.Reports.GetRetryFunnel(start, end));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching retry funnel: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets distribution statistics for how long peers waited in the upload queue.
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/queue-wait")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(QueueWaitStats), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetQueueWaitStats(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        try
        {
            return Ok(Telemetry.Reports.GetQueueWaitStats(start, end));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching queue wait stats: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the count of new versus returning peers active within the window.
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/peers")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(PeerRetention), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetPeerRetention(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        try
        {
            return Ok(Telemetry.Reports.GetPeerRetention(start, end));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching peer retention: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets the number of distinct shared files that have ever been uploaded (catalog reach).
    /// </summary>
    /// <returns></returns>
    [HttpGet("transfers/coverage")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(CoverageReport), 200)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetCatalogCoverage()
    {
        try
        {
            return Ok(Telemetry.Reports.GetCatalogCoverage());
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching catalog coverage: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Gets counts of social / discovery events (browses, private messages, room messages, mentions).
    /// </summary>
    /// <returns></returns>
    [HttpGet("social")]
    [Authorize(Policy = AuthPolicy.Any, Roles = AuthRole.AdministratorOnly)]
    [ProducesResponseType(typeof(SocialActivity), 200)]
    [ProducesResponseType(typeof(string), 400)]
    [ProducesResponseType(typeof(string), 500)]
    public IActionResult GetSocialActivity(
        [FromQuery] DateTime? start = null,
        [FromQuery] DateTime? end = null)
    {
        var now = DateTime.UtcNow;
        start ??= now.AddDays(-7);
        end ??= now;

        if (start >= end)
        {
            return BadRequest("End time must be later than start time");
        }

        try
        {
            return Ok(Telemetry.Reports.GetSocialActivity(start, end));
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching social activity: {Message}", ex.Message);
            return StatusCode(500, ex.Message);
        }
    }

    /// <summary>
    ///     Returns true if the caller is an Administrator, or if <paramref name="username"/> is their own.
    ///     A blank/null <paramref name="username"/> (i.e. a global, all-users query) is only permitted for
    ///     Administrators.
    /// </summary>
    private bool IsAdminOrSelf(string username)
    {
        var callerRole = User.FindFirstValue(ClaimTypes.Role);
        if (callerRole == Role.Administrator.ToString())
        {
            return true;
        }

        var callerName = User.FindFirstValue(ClaimTypes.Name);
        return !string.IsNullOrWhiteSpace(username) && callerName == username;
    }
}

public record UserNetworkInfo
{
    public string IpAddress { get; init; }
    public string Country { get; init; }
    public string City { get; init; }
    public int? IsVpn { get; init; }
    public DateTime? EndedAt { get; init; }
}
