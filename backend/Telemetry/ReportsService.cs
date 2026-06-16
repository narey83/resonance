// <copyright file="ReportsService.cs" company="JP Dillingham">
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

namespace resonance.Telemetry;

using System;
using System.Collections.Generic;
using System.Linq;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Caching.Memory;
using resonance.Transfers;
using Serilog;
using Soulseek;

/// <summary>
///     Reports.
/// </summary>
public class ReportsService
{
    /// <summary>
    ///     Initializes a new instance of the <see cref="ReportsService"/> class.
    /// </summary>
    public ReportsService(ConnectionStringDictionary connectionStringDictionary, IMemoryCache cache)
    {
        ConnectionStrings = connectionStringDictionary;
        Cache = cache;
    }

    private ConnectionStringDictionary ConnectionStrings { get; }
    private IMemoryCache Cache { get; }
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    // Truncate timestamps to the nearest minute so requests within the same window share a cache key.
    private static DateTime Bucket(DateTime t) =>
        new DateTime(t.Ticks / TimeSpan.TicksPerMinute * TimeSpan.TicksPerMinute, t.Kind);

    /// <summary>
    ///     Returns a summary of all transfer data grouped by direction and final transfer state. Includes only
    ///     completed transfers.
    /// </summary>
    /// <param name="start">The optional start time of the summary window.</param>
    /// <param name="end">The optional end time of the summary window.</param>
    /// <param name="direction">The optional direction (Upload or Download) for the summary.</param>
    /// <param name="username">The optional username by which to filter results.</param>
    /// <returns>A nested dictionary keyed by direction and state and containing summary information.</returns>
    /// <exception cref="ArgumentException">Thrown if end time is not later than start time.</exception>
    public Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>> GetTransferSummary(
        DateTime? start = null,
        DateTime? end = null,
        TransferDirection? direction = null,
        string username = null)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:summary:{Bucket(start.Value):O}:{Bucket(end.Value):O}:{direction}:{username}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var dict = new Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>()
            {
                { TransferDirection.Download, new Dictionary<TransferStates, TransferSummary>() },
                { TransferDirection.Upload, new Dictionary<TransferStates, TransferSummary>() },
            };

            var sql = @$"
                SELECT
                    Direction,
                    StateDescription,
                    SUM(Size) AS TotalBytes,
                    COUNT(*) AS Count,
                    COUNT(DISTINCT Username) AS DistinctUsers,
                    AVG(AverageSpeed) AS AverageSpeed,
                    AVG(strftime('%s', StartedAt) - strftime('%s', EnqueuedAt)) AS AverageWait,
                    AVG(strftime('%s', EndedAt) - strftime('%s', StartedAt)) AS AverageDuration
                FROM Transfers
                WHERE EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                    AND State IN ({string.Join(", ", TransferStateCategories.Completed.Select(s => (int)s))})
                    {(direction is not null ? "AND Direction = @Direction" : string.Empty)}
                    {(username is not null ? "AND Username = @Username" : string.Empty)}
                GROUP BY Direction, StateDescription
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

            var param = new
            {
                Direction = direction?.ToString(),
                Username = username,
                Start = start,
                End = end,
            };

            var results = connection.Query<TransferSummaryRow>(sql, param);

            foreach (var result in results)
            {
                var record = new TransferSummary
                {
                    TotalBytes = result.TotalBytes,
                    Count = result.Count,
                    DistinctUsers = result.DistinctUsers,
                    AverageSpeed = result.AverageSpeed,
                    AverageWait = result.AverageWait,
                    AverageDuration = result.AverageDuration,
                };

                dict[result.Direction].Add(result.StateDescription & ~TransferStates.Completed, record);
            }

            return dict;
        });
    }

    /// <summary>
    ///     Returns a histogram of all transfer data, aggregated into fixed size time intervals and grouped by
    ///     direction and final transfer state. Includes only completed transfers.
    /// </summary>
    /// <param name="start">The start time of the histogram window.</param>
    /// <param name="end">The end time of the histogram window.</param>
    /// <param name="interval">The interval for the histogram.</param>
    /// <param name="direction">The optional direction (Upload or Download) by which to filter results.</param>
    /// <param name="username">The optional username by which to filter results.</param>
    /// <returns>A nested dictionary keyed by direction and state and containing summary information.</returns>
    /// <exception cref="ArgumentException">Thrown if end time is not later than start time.</exception>
    public Dictionary<DateTime, Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>> GetTransferHistogram(
        DateTime start,
        DateTime end,
        TimeSpan interval,
        TransferDirection? direction = null,
        string username = null)
    {
        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:histogram:{Bucket(start):O}:{Bucket(end):O}:{(int)interval.TotalSeconds}:{direction}:{username}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var dict = new Dictionary<DateTime, Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>>();

            // fill the dictionary with gapless intervals and empty dictionaries
            var currentInterval = new DateTime(start.Ticks / interval.Ticks * interval.Ticks, DateTimeKind.Utc);

            while (currentInterval < end)
            {
                dict[currentInterval] = new Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>()
                {
                    { TransferDirection.Download, new Dictionary<TransferStates, TransferSummary>() },
                    { TransferDirection.Upload, new Dictionary<TransferStates, TransferSummary>() },
                };
                currentInterval = currentInterval.Add(interval);
            }

            var sql = @$"
                SELECT
                    datetime(strftime('%s', EndedAt) / CAST(@Interval AS INTEGER) * CAST(@Interval AS INTEGER), 'unixepoch') AS Interval,
                    Direction,
                    StateDescription,
                    SUM(Size) AS TotalBytes,
                    COUNT(*) AS Count,
                    COUNT(DISTINCT Username) AS Users,
                    AVG(AverageSpeed) AS AverageSpeed,
                    COALESCE(AVG(strftime('%s', StartedAt) - strftime('%s', EnqueuedAt)), 0.0) AS AverageWait,
                    COALESCE(AVG(strftime('%s', EndedAt) - strftime('%s', StartedAt)), 0.0) AS AverageDuration
                FROM Transfers
                WHERE EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                    AND State IN ({string.Join(", ", TransferStateCategories.Completed.Select(s => (int)s))})
                    {(direction is not null ? "AND Direction = @Direction" : string.Empty)}
                    {(username is not null ? "AND Username = @Username" : string.Empty)}
                GROUP BY Interval, Direction, StateDescription
                ORDER BY Interval, Direction, StateDescription;
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

            var param = new
            {
                Direction = direction?.ToString(),
                Username = username,
                Start = start,
                End = end,
                Interval = (int)interval.TotalSeconds,
            };

            var results = connection.Query<TransferSummaryRow>(sql, param);

            foreach (var result in results)
            {
                var record = new TransferSummary
                {
                    TotalBytes = result.TotalBytes,
                    Count = result.Count,
                    DistinctUsers = result.DistinctUsers,
                    AverageSpeed = result.AverageSpeed,
                    AverageWait = result.AverageWait,
                    AverageDuration = result.AverageDuration,
                };

                if (result.Interval.HasValue)
                {
                    // normalize the result interval to match the bucket interval
                    var bucketInterval = new DateTime(result.Interval.Value.Ticks / interval.Ticks * interval.Ticks, DateTimeKind.Utc);

                    if (dict.TryGetValue(bucketInterval, out var intervalDict))
                    {
                        intervalDict[result.Direction][result.StateDescription & ~TransferStates.Completed] = record;
                    }
                }
            }

            return dict;
        });
    }

    /// <summary>
    ///     Returns the top N users summaries by count, total bytes, or average speed. Only successful transfers are included in counts.
    /// </summary>
    /// <param name="direction">The direction (Upload or Download).</param>
    /// <param name="start">The optional start time of the summary window.</param>
    /// <param name="end">The optional end time of the summary window.</param>
    /// <param name="sortBy">The property by which to sort.</param>
    /// <param name="sortOrder">The sort order.</param>
    /// <param name="limit">The number of records to return (default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns>A dictionary keyed by username and containing summary information.</returns>
    /// <exception cref="ArgumentException">
    ///     Thrown if end time is not later than start time, or limit is not greater than zero.
    /// </exception>
    public List<TransferSummary> GetTransferLeaderboard(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        LeaderboardSortBy sortBy = LeaderboardSortBy.Count,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:leaderboard:{Bucket(start.Value):O}:{Bucket(end.Value):O}:{direction}:{sortBy}:{sortOrder}:{limit}:{offset}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var sql = @$"
                SELECT
                    Username,
                    Direction,
                    State,
                    SUM(Size) AS TotalBytes,
                    COUNT(*) AS Count,
                    AVG(AverageSpeed) AS AverageSpeed,
                    AVG(strftime('%s', StartedAt) - strftime('%s', EnqueuedAt)) AS AverageWait,
                    AVG(strftime('%s', EndedAt) - strftime('%s', StartedAt)) AS AverageDuration
                FROM Transfers
                WHERE Direction = @Direction
                    AND State = 48
                    AND EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                GROUP BY Username, Direction, StateDescription
                ORDER BY {sortBy} {sortOrder}, Username DESC
                LIMIT @Limit
                OFFSET @Offset
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

            var param = new
            {
                Direction = direction.ToString(),
                Limit = limit,
                Offset = offset,
                Start = start,
                End = end,
            };

            var results = connection.Query<TransferSummaryRow>(sql, param);

            return results.Select(row => new TransferSummary
            {
                Username = row.Username,
                TotalBytes = row.TotalBytes,
                Count = row.Count,
                AverageSpeed = row.AverageSpeed,
                AverageWait = row.AverageWait,
                AverageDuration = row.AverageDuration,
            }).ToList();
        });
    }

    /// <summary>
    ///     Returns a list of transfer exceptions.
    /// </summary>
    /// <param name="direction">The direction (Upload or Download).</param>
    /// <param name="start">The optional start time of the summary window.</param>
    /// <param name="end">The optional end time of the summary window.</param>
    /// <param name="username">The optional username by which to filter results.</param>
    /// <param name="sortOrder">The sort order.</param>
    /// <param name="limit">The number of records to return (default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns>A list of exceptions.</returns>
    /// <exception cref="ArgumentException">
    ///     Thrown if end time is not later than start time, or limit is not greater than zero.
    /// </exception>
    public List<TransferExceptionDetail> GetTransferExceptions(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var sql = @$"
            SELECT
                Id,
                Username,
                Direction,
                Filename,
                Size,
                StartOffset,
                State,
                RequestedAt
                EnqueuedAt,
                StartedAt,
                EndedAt,
                BytesTransferred,
                AverageSpeed,
                CASE
                    WHEN INSTR(Exception, ' (') > 0 AND SUBSTR(TRIM(Exception), -1) = ')'
                    THEN TRIM(SUBSTR(Exception, 1, INSTR(Exception, ' (') - 1))
                    WHEN INSTR(Exception, ': ') > 0
                    THEN TRIM(SUBSTR(Exception, INSTR(Exception, ': ') + 2))
                    ELSE COALESCE(TRIM(Exception), 'Unknown')
                END as Exception
            FROM transfers
            WHERE state & ~48
                AND Direction = @Direction
                AND EndedAt BETWEEN @Start AND @End
                {(username is not null ? "AND Username = @Username" : string.Empty)}
            ORDER BY EndedAt {sortOrder}
            LIMIT @Limit
            OFFSET @Offset
        ";

        using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

        var param = new
        {
            Direction = direction.ToString(),
            Username = username,
            Start = start,
            End = end,
            Limit = limit,
            Offset = offset,
        };

        var results = connection.Query<TransferExceptionDetail>(sql, param);
        return results.ToList();
    }

    /// <summary>
    ///     Returns a summary of distinct transfer exceptions and the number of times they occurred.
    /// </summary>
    /// <param name="direction">The direction (Upload or Download) for the summary.</param>
    /// <param name="start">The optional start time of the summary window.</param>
    /// <param name="end">The optional end time of the summary window.</param>
    /// <param name="username">The optional username by which to filter results.</param>
    /// <param name="limit">The number of records to return (default: 25).</param>
    /// <param name="offset">The record offset (if paginating).</param>
    /// <returns>A dictionary keyed by direction and containing a list of exceptions and the number of times they occurred.</returns>
    /// <exception cref="ArgumentException">
    ///     Thrown if end time is not later than start time, or limit is not greater than zero.
    /// </exception>
    public List<TransferExceptionSummary> GetTransferExceptionsPareto(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:exceptions-pareto:{Bucket(start.Value):O}:{Bucket(end.Value):O}:{direction}:{username}:{limit}:{offset}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var sql = @$"
                SELECT
                    CASE
                        WHEN INSTR(Exception, ' to ') > 0 AND SUBSTR(TRIM(Exception), -1) = ')'
                        THEN TRIM(SUBSTR(Exception, 1, INSTR(Exception, ' to ') - 1))
                        WHEN INSTR(Exception, ': ') > 0
                        THEN TRIM(SUBSTR(Exception, INSTR(Exception, ': ') + 2))
                        ELSE COALESCE(TRIM(Exception), 'Unknown')
                    END as Exception,
                    COUNT(*) as Count,
                    COUNT(DISTINCT Username) as DistinctUsers
                FROM transfers
                WHERE state & ~48
                    AND Direction = @Direction
                    AND EndedAt BETWEEN @Start AND @End
                    {(username is not null ? "AND Username = @Username" : string.Empty)}
                GROUP BY Direction,
                CASE
                    WHEN INSTR(Exception, ' (') > 0 AND SUBSTR(TRIM(Exception), -1) = ')'
                    THEN TRIM(SUBSTR(Exception, 1, INSTR(Exception, ' (') - 1))
                    WHEN INSTR(Exception, ': ') > 0
                    THEN TRIM(SUBSTR(Exception, INSTR(Exception, ': ') + 2))
                    ELSE COALESCE(TRIM(Exception), 'Unknown')
                END
                ORDER BY Count DESC
                LIMIT @Limit
                OFFSET @Offset
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

            var param = new
            {
                Direction = direction.ToString(),
                Username = username,
                Start = start,
                End = end,
                Limit = limit,
                Offset = offset,
            };

            var results = connection.Query<TransferExceptionSummary>(sql, param);
            return results.ToList();
        });
    }

    /// <summary>
    ///     Returns a list of directories and the frequency at which they have been downloaded.
    /// </summary>
    /// <param name="start"></param>
    /// <param name="end"></param>
    /// <param name="username"></param>
    /// <param name="sortOrder"></param>
    /// <param name="limit"></param>
    /// <param name="offset"></param>
    /// <returns></returns>
    /// <exception cref="ArgumentException">
    ///     Thrown if end time is not later than start time, or limit is not greater than zero.
    /// </exception>
    public List<TransferDirectorySummary> GetTransferDirectoryFrequency(
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (end <= start)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:directories:{Bucket(start.Value):O}:{Bucket(end.Value):O}:{username}:{sortOrder}:{limit}:{offset}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var sql = @$"
                WITH directories AS (
                    SELECT
                        RTRIM(
                            RTRIM(filename, REPLACE(REPLACE(filename, '/', ''), '\', '')), '/\'
                        ) AS Directory,
                        Username
                    FROM transfers
                    WHERE Direction = 'Upload'
                    AND State = 48
                    AND EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                    {(username is not null ? "AND Username = @Username" : string.Empty)}
                )
                SELECT Directory, COUNT(*) AS Count, COUNT(DISTINCT Username) AS DistinctUsers
                FROM directories
                GROUP BY Directory
                ORDER BY DistinctUsers DESC, Count DESC
                LIMIT @Limit
                OFFSET @Offset
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

            var param = new
            {
                Start = start,
                End = end,
                Limit = limit,
                Offset = offset,
                Username = username,
            };

            var results = connection.Query<TransferDirectorySummary>(sql, param);
            return results.ToList();
        });
    }

    /// <summary>
    ///     Returns the top N most-downloaded files (uploaded from this server) within the given time window.
    /// </summary>
    /// <returns></returns>
    public List<TransferFileSummary> GetTopFiles(
        DateTime? start = null,
        DateTime? end = null,
        int limit = 10,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        var cacheKey = $"reports:files:{Bucket(start.Value):O}:{Bucket(end.Value):O}:{limit}:{offset}";
        return Cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);

            var sql = @"
                WITH files AS (
                    SELECT
                        SUBSTR(filename, LENGTH(RTRIM(filename, REPLACE(REPLACE(filename, '/', ''), '\', ''))) + 1) AS Filename,
                        Username,
                        Size
                    FROM transfers
                    WHERE Direction = 'Upload'
                    AND State = 48
                    AND EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                )
                SELECT Filename, COUNT(*) AS Count, COUNT(DISTINCT Username) AS DistinctUsers, SUM(Size) AS TotalBytes
                FROM files
                GROUP BY LOWER(Filename)
                ORDER BY Count DESC, DistinctUsers DESC
                LIMIT @Limit OFFSET @Offset
            ";

            using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);
            return connection.Query<TransferFileSummary>(sql, new { Start = start, End = end, Limit = limit, Offset = offset }).ToList();
        });
    }

    /// <summary>
    ///     Returns a paginated list of all users with aggregate transfer statistics.
    /// </summary>
    /// <returns></returns>
    public (List<UserReportSummary> Items, int Total) GetUserList(
        DateTime? start = null,
        DateTime? end = null,
        string search = null,
        UserReportSortBy sortBy = UserReportSortBy.LastSeen,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        var sortColumn = sortBy switch
        {
            UserReportSortBy.UploadCount => "UploadCount",
            UserReportSortBy.DownloadCount => "DownloadCount",
            UserReportSortBy.UploadBytes => "UploadBytes",
            UserReportSortBy.DownloadBytes => "DownloadBytes",
            UserReportSortBy.Errors => "UploadErrorCount + DownloadErrorCount",
            UserReportSortBy.LastSeen => "LastSeen",
            _ => "LastSeen",
        };

        var searchClause = search is not null
            ? @"AND (a.Username LIKE @Search
                  OR n.IpAddress LIKE @Search
                  OR n.Country LIKE @Search
                  OR n.City LIKE @Search)"
            : string.Empty;

        var sql = @$"
            WITH aggregated AS (
                SELECT
                    Username,
                    SUM(CASE WHEN Direction = 'Upload' AND State = 48 THEN 1 ELSE 0 END) AS UploadCount,
                    SUM(CASE WHEN Direction = 'Download' AND State = 48 THEN 1 ELSE 0 END) AS DownloadCount,
                    SUM(CASE WHEN Direction = 'Upload' AND State = 48 THEN Size ELSE 0 END) AS UploadBytes,
                    SUM(CASE WHEN Direction = 'Download' AND State = 48 THEN Size ELSE 0 END) AS DownloadBytes,
                    SUM(CASE WHEN Direction = 'Upload' AND (State & ~48) != 0 THEN 1 ELSE 0 END) AS UploadErrorCount,
                    SUM(CASE WHEN Direction = 'Download' AND (State & ~48) != 0 THEN 1 ELSE 0 END) AS DownloadErrorCount,
                    AVG(CASE WHEN Direction = 'Upload' AND State = 48 THEN AverageSpeed ELSE NULL END) AS UploadAverageSpeed,
                    AVG(CASE WHEN Direction = 'Download' AND State = 48 THEN AverageSpeed ELSE NULL END) AS DownloadAverageSpeed,
                    MAX(EndedAt) AS LastSeen
                FROM Transfers
                WHERE EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                GROUP BY Username
            )
            SELECT a.*, n.IpAddress, n.Country, n.City, n.IsVpn, n.Lat, n.Lon, COUNT(*) OVER() AS TotalCount
            FROM aggregated a
            LEFT JOIN TransferNetworkInfo n ON n.Username = a.Username
            WHERE 1=1 {searchClause}
            ORDER BY {sortColumn} {sortOrder}
            LIMIT @Limit
            OFFSET @Offset
        ";

        using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

        var param = new
        {
            Start = start,
            End = end,
            Search = search is not null ? "%" + search + "%" : null,
            Limit = limit,
            Offset = offset,
        };

        var rows = connection.Query<UserReportRow>(sql, param).ToList();
        var total = rows.FirstOrDefault()?.TotalCount ?? 0;
        var items = rows.Cast<UserReportSummary>().ToList();
        return (items, total);
    }

    /// <summary>
    ///     Returns paginated individual transfer records for the specified user.
    /// </summary>
    /// <returns></returns>
    public (List<UserTransferRecord> Items, int Total) GetUserTransfers(
        string username,
        TransferDirection? direction = null,
        DateTime? start = null,
        DateTime? end = null,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        var directionClause = direction is not null ? "AND Direction = @Direction" : string.Empty;

        var sql = @$"
            SELECT
                Id,
                Username,
                Direction,
                Filename,
                Size,
                StateDescription,
                CASE
                    WHEN INSTR(Exception, ' (') > 0 AND SUBSTR(TRIM(Exception), -1) = ')'
                    THEN TRIM(SUBSTR(Exception, 1, INSTR(Exception, ' (') - 1))
                    WHEN INSTR(Exception, ': ') > 0
                    THEN TRIM(SUBSTR(Exception, INSTR(Exception, ': ') + 2))
                    ELSE COALESCE(TRIM(Exception), '')
                END AS Exception,
                RequestedAt,
                EnqueuedAt,
                StartedAt,
                EndedAt,
                BytesTransferred,
                AverageSpeed
            FROM Transfers
            WHERE Username = @Username
                AND EndedAt IS NOT NULL
                AND EndedAt BETWEEN @Start AND @End
                {directionClause}
            ORDER BY EndedAt {sortOrder}
            LIMIT @Limit
            OFFSET @Offset
        ";

        var countSql = @$"
            SELECT COUNT(*)
            FROM Transfers
            WHERE Username = @Username
                AND EndedAt IS NOT NULL
                AND EndedAt BETWEEN @Start AND @End
                {directionClause}
        ";

        using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);

        var param = new
        {
            Username = username,
            Direction = direction?.ToString(),
            Start = start,
            End = end,
            Limit = limit,
            Offset = offset,
        };

        var items = connection.Query<UserTransferRecord>(sql, param).ToList();
        var total = connection.QuerySingle<int>(countSql, param);
        return (items, total);
    }

    /// <summary>
    ///     Returns paginated browse event timestamps for the specified user from the events database.
    /// </summary>
    /// <returns></returns>
    public (List<DateTime> Timestamps, int Total) GetUserBrowseEvents(
        string username,
        DateTime? start = null,
        DateTime? end = null,
        int limit = 50,
        int offset = 0)
    {
        start ??= DateTime.MinValue;
        end ??= DateTime.MaxValue;

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        var sql = @"
            SELECT Timestamp
            FROM Events
            WHERE Type = 'Browsed'
                AND json_extract(Data, '$.username') = @Username
                AND Timestamp BETWEEN @Start AND @End
            ORDER BY Timestamp DESC
            LIMIT @Limit
            OFFSET @Offset
        ";

        var countSql = @"
            SELECT COUNT(*)
            FROM Events
            WHERE Type = 'Browsed'
                AND json_extract(Data, '$.username') = @Username
                AND Timestamp BETWEEN @Start AND @End
        ";

        using var connection = new SqliteConnection(ConnectionStrings[Database.Events]);

        var param = new { Username = username, Start = start, End = end, Limit = limit, Offset = offset };

        var timestamps = connection.Query<DateTime>(sql, param).ToList();
        var total = connection.QuerySingle<int>(countSql, param);
        return (timestamps, total);
    }

    public UserNetworkInfo GetUserNetworkInfo(string username)
    {
        var sql = @"
            SELECT IpAddress, Country, City, IsVpn, LastSeen AS EndedAt
            FROM TransferNetworkInfo
            WHERE Username = @Username
        ";

        using var connection = new SqliteConnection(ConnectionStrings[Database.Transfers]);
        return connection.QueryFirstOrDefault<UserNetworkInfo>(sql, new { Username = username });
    }

    public Dictionary<string, UserEventCounts> GetUserEventCounts(IEnumerable<string> usernames, DateTime since)
    {
        var list = usernames.ToList();
        if (list.Count == 0)
        {
            return new();
        }

        var inClause = string.Join(",", list.Select((_, i) => $"@u{i}"));
        var sql = $@"
            SELECT
                json_extract(data, '$.username') AS Username,
                SUM(CASE WHEN type = 'Browsed'                THEN 1 ELSE 0 END) AS BrowseCount,
                SUM(CASE WHEN type = 'PrivateMessageReceived' THEN 1 ELSE 0 END) AS ChatCount
            FROM Events
            WHERE type IN ('Browsed', 'PrivateMessageReceived')
                AND timestamp >= @Since
                AND json_extract(data, '$.username') IN ({inClause})
            GROUP BY json_extract(data, '$.username')
        ";

        var param = new DynamicParameters();
        param.Add("Since", since.ToString("o"));
        for (var i = 0; i < list.Count; i++)
        {
            param.Add($"u{i}", list[i]);
        }

        using var connection = new SqliteConnection(ConnectionStrings[Database.Events]);
        return connection
            .Query<UserEventCountRow>(sql, param)
            .ToDictionary(r => r.Username, r => new UserEventCounts(r.BrowseCount, r.ChatCount));
    }

    private record UserEventCountRow
    {
        public string Username { get; init; }
        public int BrowseCount { get; init; }
        public int ChatCount { get; init; }
    }

    private record UserReportRow : UserReportSummary
    {
        public int TotalCount { get; init; }
    }

    private record TransferSummaryRow
    {
        public DateTime? Interval { get; init; }
        public string Username { get; init; }
        public TransferDirection Direction { get; init; }
        public TransferStates StateDescription { get; init; }
        public long TotalBytes { get; init; }
        public long Count { get; init; }
        public long DistinctUsers { get; init; }
        public double AverageSpeed { get; init; }
        public double AverageWait { get; init; }
        public double AverageDuration { get; init; }
    }
}