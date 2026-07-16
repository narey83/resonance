// <copyright file="ReportsService.cs" company="JP Dillingham">
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
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Threading.Tasks;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using resonance.Transfers;
using Serilog;
using Soulseek;

/// <summary>
///     Reports.
/// </summary>
public class ReportsService
{
    private static readonly ConcurrentDictionary<string, byte> RefreshesInFlight = new();

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
    private bool UsePostgres => ConnectionStrings.UsePostgres;
    private ILogger Log { get; } = Serilog.Log.ForContext("SourceContext", Logs.Telemetry);

    /// <summary>
    ///     Returns a summary of all transfer data grouped by direction and final transfer state. Includes only
    ///     completed transfers.
    /// </summary>
    /// <returns></returns>
    public Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>> GetTransferSummary(
        DateTime? start = null,
        DateTime? end = null,
        TransferDirection? direction = null,
        string username = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:summary:{WindowKey(s, e)}:{direction}:{username}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            var dict = new Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>()
            {
                { TransferDirection.Download, new Dictionary<TransferStates, TransferSummary>() },
                { TransferDirection.Upload, new Dictionary<TransferStates, TransferSummary>() },
            };

            var stateList = string.Join(", ", TransferStateCategories.Completed.Select(s => (int)s));

            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    SELECT ""Direction"", ""StateDescription"",
                        SUM(""Size"") AS TotalBytes,
                        COUNT(*) AS Count,
                        COUNT(DISTINCT ""Username"") AS DistinctUsers,
                        AVG(""AverageSpeed"") AS AverageSpeed,
                        AVG(EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt""))) AS AverageWait,
                        AVG(EXTRACT(EPOCH FROM (""EndedAt"" - ""StartedAt""))) AS AverageDuration
                    FROM transfers.""Transfers""
                    WHERE ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                        AND ""State"" IN ({stateList})
                        {(direction is not null ? "AND \"Direction\" = @Direction" : string.Empty)}
                        {(username is not null ? "AND \"Username\" = @Username" : string.Empty)}
                    GROUP BY ""Direction"", ""StateDescription""
                ";
            }
            else
            {
                sql = $@"
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
                        AND State IN ({stateList})
                        {(direction is not null ? "AND Direction = @Direction" : string.Empty)}
                        {(username is not null ? "AND Username = @Username" : string.Empty)}
                    GROUP BY Direction, StateDescription
                ";
            }

            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Direction = direction?.ToString(),
                Username = username,
                Start = s,
                End = e,
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
    /// <returns></returns>
    public Dictionary<DateTime, Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>> GetTransferHistogram(
        DateTime start,
        DateTime end,
        TimeSpan interval,
        TransferDirection? direction = null,
        string username = null)
    {
        var s = Utc(start);
        var e = Utc(end);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:histogram:{WindowKey(s, e)}:{(int)interval.TotalSeconds}:{direction}:{username}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            var dict = new Dictionary<DateTime, Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>>();

            // fill the dictionary with gapless intervals and empty dictionaries
            var currentInterval = new DateTime(s.Ticks / interval.Ticks * interval.Ticks, DateTimeKind.Utc);

            while (currentInterval < e)
            {
                dict[currentInterval] = new Dictionary<TransferDirection, Dictionary<TransferStates, TransferSummary>>()
                {
                    { TransferDirection.Download, new Dictionary<TransferStates, TransferSummary>() },
                    { TransferDirection.Upload, new Dictionary<TransferStates, TransferSummary>() },
                };
                currentInterval = currentInterval.Add(interval);
            }

            var stateList = string.Join(", ", TransferStateCategories.Completed.Select(s => (int)s));

            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    SELECT
                        TO_TIMESTAMP(EXTRACT(EPOCH FROM ""EndedAt"")::BIGINT / @Interval * @Interval) AS ""Interval"",
                        ""Direction"",
                        ""StateDescription"",
                        SUM(""Size"") AS TotalBytes,
                        COUNT(*) AS Count,
                        COUNT(DISTINCT ""Username"") AS Users,
                        AVG(""AverageSpeed"") AS AverageSpeed,
                        COALESCE(AVG(EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt""))), 0.0) AS AverageWait,
                        COALESCE(AVG(EXTRACT(EPOCH FROM (""EndedAt"" - ""StartedAt""))), 0.0) AS AverageDuration
                    FROM transfers.""Transfers""
                    WHERE ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                        AND ""State"" IN ({stateList})
                        {(direction is not null ? "AND \"Direction\" = @Direction" : string.Empty)}
                        {(username is not null ? "AND \"Username\" = @Username" : string.Empty)}
                    GROUP BY 1, ""Direction"", ""StateDescription""
                    ORDER BY 1, ""Direction"", ""StateDescription"";
                ";
            }
            else
            {
                sql = $@"
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
                        AND State IN ({stateList})
                        {(direction is not null ? "AND Direction = @Direction" : string.Empty)}
                        {(username is not null ? "AND Username = @Username" : string.Empty)}
                    GROUP BY Interval, Direction, StateDescription
                    ORDER BY Interval, Direction, StateDescription;
                ";
            }

            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Direction = direction?.ToString(),
                Username = username,
                Start = s,
                End = e,
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
    ///     Returns the top N users summaries by count, total bytes, or average speed.
    /// </summary>
    /// <returns></returns>
    public List<TransferSummary> GetTransferLeaderboard(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        LeaderboardSortBy sortBy = LeaderboardSortBy.Count,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:leaderboard:{WindowKey(s, e)}:{direction}:{sortBy}:{sortOrder}:{limit}:{offset}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    SELECT
                        ""Username"",
                        ""Direction"",
                        SUM(""Size"") AS TotalBytes,
                        COUNT(*) AS Count,
                        AVG(""AverageSpeed"") AS AverageSpeed,
                        AVG(EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt""))) AS AverageWait,
                        AVG(EXTRACT(EPOCH FROM (""EndedAt"" - ""StartedAt""))) AS AverageDuration
                    FROM transfers.""Transfers""
                    WHERE ""Direction"" = @Direction
                        AND ""State"" = 48
                        AND ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                    GROUP BY ""Username"", ""Direction""
                    ORDER BY {sortBy} {sortOrder}, ""Username"" DESC
                    LIMIT @Limit
                    OFFSET @Offset
                ";
            }
            else
            {
                sql = $@"
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
            }

            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Direction = direction.ToString(),
                Limit = limit,
                Offset = offset,
                Start = s,
                End = e,
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
    /// <returns></returns>
    public List<TransferExceptionDetail> GetTransferExceptions(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        string sql;
        if (UsePostgres)
        {
            sql = $@"
                SELECT
                    ""Id""::text AS ""Id"",
                    ""Username"",
                    ""Direction"",
                    ""Filename"",
                    ""Size"",
                    ""StartOffset"",
                    ""State"",
                    ""RequestedAt"",
                    ""EnqueuedAt"",
                    ""StartedAt"",
                    ""EndedAt"",
                    ""BytesTransferred"",
                    ""AverageSpeed"",
                    CASE
                        WHEN STRPOS(""Exception"", ' (') > 0 AND RIGHT(TRIM(""Exception""), 1) = ')'
                        THEN TRIM(SUBSTR(""Exception"", 1, STRPOS(""Exception"", ' (') - 1))
                        WHEN STRPOS(""Exception"", ': ') > 0
                        THEN TRIM(SUBSTR(""Exception"", STRPOS(""Exception"", ': ') + 2))
                        ELSE COALESCE(TRIM(""Exception""), 'Unknown')
                    END AS ""Exception""
                FROM transfers.""Transfers""
                WHERE ""State"" & ~48 != 0
                    AND ""Direction"" = @Direction
                    AND ""EndedAt"" BETWEEN @Start AND @End
                    {(username is not null ? "AND \"Username\" = @Username" : string.Empty)}
                ORDER BY ""EndedAt"" {sortOrder}
                LIMIT @Limit
                OFFSET @Offset
            ";
        }
        else
        {
            sql = $@"
                SELECT
                    Id,
                    Username,
                    Direction,
                    Filename,
                    Size,
                    StartOffset,
                    State,
                    RequestedAt,
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
        }

        using var connection = OpenConnection(Database.Transfers);

        var param = new
        {
            Direction = direction.ToString(),
            Username = username,
            Start = s,
            End = e,
            Limit = limit,
            Offset = offset,
        };

        var results = connection.Query<TransferExceptionDetail>(sql, param);
        return results.ToList();
    }

    /// <summary>
    ///     Returns a summary of distinct transfer exceptions and the number of times they occurred.
    /// </summary>
    /// <returns></returns>
    public List<TransferExceptionSummary> GetTransferExceptionsPareto(
        TransferDirection direction,
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        int limit = 25,
        int offset = 0)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:exceptions-pareto:{WindowKey(s, e)}:{direction}:{username}:{limit}:{offset}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    WITH categorized AS (
                        SELECT
                            CASE
                                WHEN STRPOS(""Exception"", ' (') > 0 AND RIGHT(TRIM(""Exception""), 1) = ')'
                                THEN TRIM(SUBSTR(""Exception"", 1, STRPOS(""Exception"", ' (') - 1))
                                WHEN STRPOS(""Exception"", ': ') > 0
                                THEN TRIM(SUBSTR(""Exception"", STRPOS(""Exception"", ': ') + 2))
                                ELSE COALESCE(TRIM(""Exception""), 'Unknown')
                            END AS Exception,
                            ""Username""
                        FROM transfers.""Transfers""
                        WHERE ""State"" & ~48 != 0
                            AND ""Direction"" = @Direction
                            AND ""EndedAt"" BETWEEN @Start AND @End
                            {(username is not null ? "AND \"Username\" = @Username" : string.Empty)}
                    )
                    SELECT Exception, COUNT(*) AS Count, COUNT(DISTINCT ""Username"") AS DistinctUsers
                    FROM categorized
                    GROUP BY Exception
                    ORDER BY Count DESC
                    LIMIT @Limit
                    OFFSET @Offset
                ";
            }
            else
            {
                sql = $@"
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
            }

            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Direction = direction.ToString(),
                Username = username,
                Start = s,
                End = e,
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
    /// <returns></returns>
    public List<TransferDirectorySummary> GetTransferDirectoryFrequency(
        DateTime? start = null,
        DateTime? end = null,
        string username = null,
        SortOrder sortOrder = SortOrder.DESC,
        int limit = 25,
        int offset = 0)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException("Limit must be greater than zero");
        }

        var cacheKey = $"reports:directories:{WindowKey(s, e)}:{username}:{sortOrder}:{limit}:{offset}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    WITH directories AS (
                        SELECT
                            RTRIM(
                                RTRIM(""Filename"", REPLACE(REPLACE(""Filename"", '/', ''), '\', '')), '/\'
                            ) AS Directory,
                            ""Username""
                        FROM transfers.""Transfers""
                        WHERE ""Direction"" = 'Upload'
                        AND ""State"" = 48
                        AND ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                        {(username is not null ? "AND \"Username\" = @Username" : string.Empty)}
                    )
                    SELECT Directory, COUNT(*) AS Count, COUNT(DISTINCT ""Username"") AS DistinctUsers
                    FROM directories
                    GROUP BY Directory
                    ORDER BY DistinctUsers DESC, Count DESC
                    LIMIT @Limit
                    OFFSET @Offset
                ";
            }
            else
            {
                sql = $@"
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
            }

            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Start = s,
                End = e,
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
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        var cacheKey = $"reports:files:{WindowKey(s, e)}:{limit}:{offset}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = @"
                    WITH files AS (
                        SELECT
                            SUBSTR(""Filename"", LENGTH(RTRIM(""Filename"", REPLACE(REPLACE(""Filename"", '/', ''), '\', ''))) + 1) AS Filename,
                            ""Username"",
                            ""Size""
                        FROM transfers.""Transfers""
                        WHERE ""Direction"" = 'Upload'
                        AND ""State"" = 48
                        AND ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                    )
                    SELECT Filename, COUNT(*) AS Count, COUNT(DISTINCT ""Username"") AS DistinctUsers, SUM(""Size"") AS TotalBytes
                    FROM files
                    GROUP BY Filename
                    ORDER BY Count DESC, DistinctUsers DESC
                    LIMIT @Limit OFFSET @Offset
                ";
            }
            else
            {
                sql = @"
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
            }

            using var connection = OpenConnection(Database.Transfers);
            return connection.Query<TransferFileSummary>(sql, new { Start = s, End = e, Limit = limit, Offset = offset }).ToList();
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
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

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

        string sql;
        if (UsePostgres)
        {
            var searchClause = search is not null
                ? @"AND (a.""Username"" LIKE @Search
                      OR n.""IpAddress"" LIKE @Search
                      OR n.""Country"" LIKE @Search
                      OR n.""City"" LIKE @Search)"
                : string.Empty;

            sql = $@"
                WITH aggregated AS (
                    SELECT
                        ""Username"",
                        SUM(CASE WHEN ""Direction"" = 'Upload'   AND ""State"" = 48 THEN 1 ELSE 0 END) AS UploadCount,
                        SUM(CASE WHEN ""Direction"" = 'Download' AND ""State"" = 48 THEN 1 ELSE 0 END) AS DownloadCount,
                        SUM(CASE WHEN ""Direction"" = 'Upload'   AND ""State"" = 48 THEN ""Size"" ELSE 0 END) AS UploadBytes,
                        SUM(CASE WHEN ""Direction"" = 'Download' AND ""State"" = 48 THEN ""Size"" ELSE 0 END) AS DownloadBytes,
                        SUM(CASE WHEN ""Direction"" = 'Upload'   AND (""State"" & ~48) != 0 THEN 1 ELSE 0 END) AS UploadErrorCount,
                        SUM(CASE WHEN ""Direction"" = 'Download' AND (""State"" & ~48) != 0 THEN 1 ELSE 0 END) AS DownloadErrorCount,
                        AVG(CASE WHEN ""Direction"" = 'Upload'   AND ""State"" = 48 THEN ""AverageSpeed"" ELSE NULL END) AS UploadAverageSpeed,
                        AVG(CASE WHEN ""Direction"" = 'Download' AND ""State"" = 48 THEN ""AverageSpeed"" ELSE NULL END) AS DownloadAverageSpeed,
                        MAX(""EndedAt"") AS LastSeen
                    FROM transfers.""Transfers""
                    WHERE ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                    GROUP BY ""Username""
                )
                SELECT a.*, n.""IpAddress"", n.""Country"", n.""City"", n.""IsVpn"", n.""Lat"", n.""Lon"", COUNT(*) OVER() AS TotalCount
                FROM aggregated a
                LEFT JOIN transfers.""TransferNetworkInfo"" n ON n.""Username"" = a.""Username""
                WHERE 1=1 {searchClause}
                ORDER BY {sortColumn} {sortOrder}, a.""Username"" DESC
                LIMIT @Limit
                OFFSET @Offset
            ";
        }
        else
        {
            var searchClause = search is not null
                ? @"AND (a.Username LIKE @Search
                      OR n.IpAddress LIKE @Search
                      OR n.Country LIKE @Search
                      OR n.City LIKE @Search)"
                : string.Empty;

            sql = $@"
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
                ORDER BY {sortColumn} {sortOrder}, a.Username DESC
                LIMIT @Limit
                OFFSET @Offset
            ";
        }

        var cacheKey = $"reports:users:{WindowKey(s, e)}:{search}:{sortBy}:{sortOrder}:{limit}:{offset}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            using var connection = OpenConnection(Database.Transfers);

            var param = new
            {
                Start = s,
                End = e,
                Search = search is not null ? "%" + search + "%" : null,
                Limit = limit,
                Offset = offset,
            };

            var rows = connection.Query<UserReportRow>(sql, param).ToList();
            var total = rows.FirstOrDefault()?.TotalCount ?? 0;
            var items = rows.Cast<UserReportSummary>().ToList();
            return (items, total);
        });
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
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        string sql, countSql;
        if (UsePostgres)
        {
            var dirClause = direction is not null ? "AND \"Direction\" = @Direction" : string.Empty;
            sql = $@"
                SELECT
                    ""Id""::text AS ""Id"",
                    ""Username"",
                    ""Direction"",
                    ""Filename"",
                    ""Size"",
                    ""StateDescription"",
                    CASE
                        WHEN STRPOS(""Exception"", ' (') > 0 AND RIGHT(TRIM(""Exception""), 1) = ')'
                        THEN TRIM(SUBSTR(""Exception"", 1, STRPOS(""Exception"", ' (') - 1))
                        WHEN STRPOS(""Exception"", ': ') > 0
                        THEN TRIM(SUBSTR(""Exception"", STRPOS(""Exception"", ': ') + 2))
                        ELSE COALESCE(TRIM(""Exception""), '')
                    END AS Exception,
                    ""RequestedAt"",
                    ""EnqueuedAt"",
                    ""StartedAt"",
                    ""EndedAt"",
                    ""BytesTransferred"",
                    ""AverageSpeed""
                FROM transfers.""Transfers""
                WHERE ""Username"" = @Username
                    AND ""EndedAt"" IS NOT NULL
                    AND ""EndedAt"" BETWEEN @Start AND @End
                    {dirClause}
                ORDER BY ""EndedAt"" {sortOrder}
                LIMIT @Limit
                OFFSET @Offset
            ";
            countSql = $@"
                SELECT COUNT(*)
                FROM transfers.""Transfers""
                WHERE ""Username"" = @Username
                    AND ""EndedAt"" IS NOT NULL
                    AND ""EndedAt"" BETWEEN @Start AND @End
                    {dirClause}
            ";
        }
        else
        {
            var dirClause = direction is not null ? "AND Direction = @Direction" : string.Empty;
            sql = $@"
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
                    {dirClause}
                ORDER BY EndedAt {sortOrder}
                LIMIT @Limit
                OFFSET @Offset
            ";
            countSql = $@"
                SELECT COUNT(*)
                FROM Transfers
                WHERE Username = @Username
                    AND EndedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                    {dirClause}
            ";
        }

        using var connection = OpenConnection(Database.Transfers);

        var param = new
        {
            Username = username,
            Direction = direction?.ToString(),
            Start = s,
            End = e,
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
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        string sql, countSql;
        if (UsePostgres)
        {
            sql = @"
                SELECT ""Timestamp""
                FROM events.""Events""
                WHERE ""Type"" = 'Browsed'
                    AND (""Data""::jsonb)->>'username' = @Username
                    AND ""Timestamp"" BETWEEN @Start AND @End
                ORDER BY ""Timestamp"" DESC
                LIMIT @Limit
                OFFSET @Offset
            ";
            countSql = @"
                SELECT COUNT(*)
                FROM events.""Events""
                WHERE ""Type"" = 'Browsed'
                    AND (""Data""::jsonb)->>'username' = @Username
                    AND ""Timestamp"" BETWEEN @Start AND @End
            ";
        }
        else
        {
            sql = @"
                SELECT Timestamp
                FROM Events
                WHERE Type = 'Browsed'
                    AND json_extract(Data, '$.username') = @Username
                    AND Timestamp BETWEEN @Start AND @End
                ORDER BY Timestamp DESC
                LIMIT @Limit
                OFFSET @Offset
            ";
            countSql = @"
                SELECT COUNT(*)
                FROM Events
                WHERE Type = 'Browsed'
                    AND json_extract(Data, '$.username') = @Username
                    AND Timestamp BETWEEN @Start AND @End
            ";
        }

        using var connection = OpenConnection(Database.Events);

        var param = new { Username = username, Start = s, End = e, Limit = limit, Offset = offset };

        var timestamps = connection.Query<DateTime>(sql, param).ToList();
        var total = connection.QuerySingle<int>(countSql, param);
        return (timestamps, total);
    }

    public UserNetworkInfo GetUserNetworkInfo(string username)
    {
        string sql;
        if (UsePostgres)
        {
            sql = @"
                SELECT ""IpAddress"", ""Country"", ""City"", ""IsVpn"", ""LastSeen"" AS EndedAt
                FROM transfers.""TransferNetworkInfo""
                WHERE ""Username"" = @Username
            ";
        }
        else
        {
            sql = @"
                SELECT IpAddress, Country, City, IsVpn, LastSeen AS EndedAt
                FROM TransferNetworkInfo
                WHERE Username = @Username
            ";
        }

        using var connection = OpenConnection(Database.Transfers);
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

        string sql;
        if (UsePostgres)
        {
            sql = $@"
                SELECT
                    (""Data""::jsonb)->>'username' AS Username,
                    SUM(CASE WHEN ""Type"" = 'Browsed'                THEN 1 ELSE 0 END) AS BrowseCount,
                    SUM(CASE WHEN ""Type"" = 'PrivateMessageReceived' THEN 1 ELSE 0 END) AS ChatCount
                FROM events.""Events""
                WHERE ""Type"" IN ('Browsed', 'PrivateMessageReceived')
                    AND ""Timestamp"" >= @Since
                    AND (""Data""::jsonb)->>'username' IN ({inClause})
                GROUP BY (""Data""::jsonb)->>'username'
            ";
        }
        else
        {
            sql = $@"
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
        }

        var param = new DynamicParameters();
        if (UsePostgres)
        {
            param.Add("Since", Utc(since));
        }
        else
        {
            param.Add("Since", since.ToString("o"));
        }

        for (var i = 0; i < list.Count; i++)
        {
            param.Add($"u{i}", list[i]);
        }

        using var connection = OpenConnection(Database.Events);
        return connection
            .Query<UserEventCountRow>(sql, param)
            .ToDictionary(r => r.Username, r => new UserEventCounts(r.BrowseCount, r.ChatCount));
    }

    /// <summary>
    ///     Returns a day-of-week (0=Sunday) by hour-of-day (UTC) heatmap of successful transfer activity.
    /// </summary>
    /// <returns></returns>
    public List<HeatmapCell> GetActivityHeatmap(
        DateTime? start = null,
        DateTime? end = null,
        TransferDirection? direction = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:heatmap:{WindowKey(s, e)}:{direction}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = $@"
                    SELECT
                        EXTRACT(DOW FROM ""EndedAt"")::int AS Dow,
                        EXTRACT(HOUR FROM ""EndedAt"")::int AS Hour,
                        SUM(""Size"") AS Bytes,
                        COUNT(*) AS Count
                    FROM transfers.""Transfers""
                    WHERE ""State"" = 48
                        AND ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                        {(direction is not null ? "AND \"Direction\" = @Direction" : string.Empty)}
                    GROUP BY 1, 2
                ";
            }
            else
            {
                sql = $@"
                    SELECT
                        CAST(strftime('%w', EndedAt) AS INTEGER) AS Dow,
                        CAST(strftime('%H', EndedAt) AS INTEGER) AS Hour,
                        SUM(Size) AS Bytes,
                        COUNT(*) AS Count
                    FROM Transfers
                    WHERE State = 48
                        AND EndedAt IS NOT NULL
                        AND EndedAt BETWEEN @Start AND @End
                        {(direction is not null ? "AND Direction = @Direction" : string.Empty)}
                    GROUP BY Dow, Hour
                ";
            }

            using var connection = OpenConnection(Database.Transfers);
            var param = new { Start = s, End = e, Direction = direction?.ToString() };
            return connection.Query<HeatmapCell>(sql, param).ToList();
        });
    }

    /// <summary>
    ///     Returns the distinct countries and cities observed from peer geo-lookups (populated by
    ///     the MaxMind database as peers connect), for populating the block-by-location dropdowns.
    ///     Cached for an hour; the set changes slowly.
    /// </summary>
    /// <returns>The known countries and, per country, the observed cities.</returns>
    public KnownLocations GetKnownLocations()
    {
        const string cacheKey = "reports:knownlocations";

        if (Cache.TryGetValue<KnownLocations>(cacheKey, out var cached))
        {
            return cached;
        }

        var table = UsePostgres ? "transfers.\"TransferNetworkInfo\"" : "TransferNetworkInfo";
        var countryCol = UsePostgres ? "\"Country\"" : "Country";
        var cityCol = UsePostgres ? "\"City\"" : "City";

        using var connection = OpenConnection(Database.Transfers);
        var rows = connection.Query<(string Country, string City)>(
            $"SELECT DISTINCT {countryCol} AS Country, {cityCol} AS City FROM {table} " +
            $"WHERE {countryCol} IS NOT NULL AND {countryCol} <> ''").ToList();

        var countries = rows.Select(r => r.Country).Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList();

        var citiesByCountry = rows
            .Where(r => !string.IsNullOrWhiteSpace(r.City))
            .GroupBy(r => r.Country, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<string>)g.Select(r => r.City).Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList(),
                StringComparer.OrdinalIgnoreCase);

        var result = new KnownLocations(countries, citiesByCountry);
        Cache.Set(cacheKey, result, TimeSpan.FromHours(1));
        return result;
    }

    /// <summary>
    ///     Returns the top countries by upload volume plus VPN usage among peers active in the window.
    /// </summary>
    /// <returns></returns>
    public GeographyReport GetGeography(
        DateTime? start = null,
        DateTime? end = null,
        int limit = 10)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        if (limit <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(limit), "Limit must be greater than zero");
        }

        var cacheKey = $"reports:geography:{WindowKey(s, e)}:{limit}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string countrySql, vpnSql;
            if (UsePostgres)
            {
                countrySql = @"
                    WITH up AS (
                        SELECT ""Username"", ""Size""
                        FROM transfers.""Transfers""
                        WHERE ""Direction"" = 'Upload' AND ""State"" = 48
                            AND ""EndedAt"" IS NOT NULL AND ""EndedAt"" BETWEEN @Start AND @End
                    )
                    SELECT COALESCE(n.""Country"", 'Unknown') AS Country,
                        SUM(up.""Size"") AS Bytes,
                        COUNT(*) AS Count,
                        COUNT(DISTINCT up.""Username"") AS Users
                    FROM up
                    LEFT JOIN transfers.""TransferNetworkInfo"" n ON n.""Username"" = up.""Username""
                    GROUP BY COALESCE(n.""Country"", 'Unknown')
                    ORDER BY Bytes DESC
                    LIMIT @Limit
                ";
                vpnSql = @"
                    WITH up AS (
                        SELECT DISTINCT ""Username""
                        FROM transfers.""Transfers""
                        WHERE ""Direction"" = 'Upload' AND ""State"" = 48
                            AND ""EndedAt"" IS NOT NULL AND ""EndedAt"" BETWEEN @Start AND @End
                    )
                    SELECT
                        COUNT(*) AS TotalUsers,
                        COUNT(*) FILTER (WHERE n.""IsVpn"" = 1) AS VpnUsers,
                        COUNT(*) FILTER (WHERE n.""Username"" IS NULL OR n.""Country"" IS NULL) AS UnknownUsers
                    FROM up
                    LEFT JOIN transfers.""TransferNetworkInfo"" n ON n.""Username"" = up.""Username""
                ";
            }
            else
            {
                countrySql = @"
                    WITH up AS (
                        SELECT Username, Size
                        FROM Transfers
                        WHERE Direction = 'Upload' AND State = 48
                            AND EndedAt IS NOT NULL AND EndedAt BETWEEN @Start AND @End
                    )
                    SELECT COALESCE(n.Country, 'Unknown') AS Country,
                        SUM(up.Size) AS Bytes,
                        COUNT(*) AS Count,
                        COUNT(DISTINCT up.Username) AS Users
                    FROM up
                    LEFT JOIN TransferNetworkInfo n ON n.Username = up.Username
                    GROUP BY COALESCE(n.Country, 'Unknown')
                    ORDER BY Bytes DESC
                    LIMIT @Limit
                ";
                vpnSql = @"
                    WITH up AS (
                        SELECT DISTINCT Username
                        FROM Transfers
                        WHERE Direction = 'Upload' AND State = 48
                            AND EndedAt IS NOT NULL AND EndedAt BETWEEN @Start AND @End
                    )
                    SELECT
                        COUNT(*) AS TotalUsers,
                        SUM(CASE WHEN n.IsVpn = 1 THEN 1 ELSE 0 END) AS VpnUsers,
                        SUM(CASE WHEN n.Username IS NULL OR n.Country IS NULL THEN 1 ELSE 0 END) AS UnknownUsers
                    FROM up
                    LEFT JOIN TransferNetworkInfo n ON n.Username = up.Username
                ";
            }

            using var connection = OpenConnection(Database.Transfers);
            var param = new { Start = s, End = e, Limit = limit };

            var countries = connection.Query<CountrySummary>(countrySql, param).ToList();
            var vpn = connection.QueryFirstOrDefault<VpnRow>(vpnSql, param) ?? new VpnRow();

            return new GeographyReport
            {
                Countries = countries,
                VpnUsers = vpn.VpnUsers,
                TotalUsers = vpn.TotalUsers,
                UnknownUsers = vpn.UnknownUsers,
            };
        });
    }

    /// <summary>
    ///     Returns the distribution of terminal download transfers by the number of attempts taken.
    /// </summary>
    /// <returns></returns>
    public List<RetryBucket> GetRetryFunnel(
        DateTime? start = null,
        DateTime? end = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:retries:{WindowKey(s, e)}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = @"
                    SELECT
                        LEAST(""Attempts"", 5) AS Attempts,
                        COUNT(*) AS Count,
                        COUNT(*) FILTER (WHERE ""State"" = 48) AS Succeeded
                    FROM transfers.""Transfers""
                    WHERE ""Direction"" = 'Download'
                        AND ""EndedAt"" IS NOT NULL
                        AND ""EndedAt"" BETWEEN @Start AND @End
                    GROUP BY LEAST(""Attempts"", 5)
                    ORDER BY Attempts
                ";
            }
            else
            {
                sql = @"
                    SELECT
                        MIN(Attempts, 5) AS Attempts,
                        COUNT(*) AS Count,
                        SUM(CASE WHEN State = 48 THEN 1 ELSE 0 END) AS Succeeded
                    FROM Transfers
                    WHERE Direction = 'Download'
                        AND EndedAt IS NOT NULL
                        AND EndedAt BETWEEN @Start AND @End
                    GROUP BY MIN(Attempts, 5)
                    ORDER BY Attempts
                ";
            }

            using var connection = OpenConnection(Database.Transfers);
            return connection.Query<RetryBucket>(sql, new { Start = s, End = e }).ToList();
        });
    }

    /// <summary>
    ///     Returns the distribution of upload queue wait times (seconds) over the window.
    /// </summary>
    /// <returns></returns>
    public QueueWaitStats GetQueueWaitStats(
        DateTime? start = null,
        DateTime? end = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:queue-wait:{WindowKey(s, e)}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            using var connection = OpenConnection(Database.Transfers);

            if (UsePostgres)
            {
                var sql = @"
                    WITH waits AS (
                        SELECT EXTRACT(EPOCH FROM (""StartedAt"" - ""EnqueuedAt"")) AS W
                        FROM transfers.""Transfers""
                        WHERE ""Direction"" = 'Upload' AND ""State"" = 48
                            AND ""StartedAt"" IS NOT NULL AND ""EnqueuedAt"" IS NOT NULL
                            AND ""EndedAt"" BETWEEN @Start AND @End
                    )
                    SELECT
                        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY W), 0) AS P50,
                        COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY W), 0) AS P90,
                        COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY W), 0) AS P99,
                        COALESCE(MAX(W), 0) AS Max,
                        COALESCE(AVG(W), 0) AS Avg,
                        COUNT(*) AS Count
                    FROM waits
                    WHERE W >= 0
                ";
                return connection.QueryFirstOrDefault<QueueWaitStats>(sql, new { Start = s, End = e }) ?? new QueueWaitStats();
            }

            // SQLite has no percentile aggregate; pull the ordered values and compute in-process (dev only).
            var listSql = @"
                SELECT (strftime('%s', StartedAt) - strftime('%s', EnqueuedAt)) AS W
                FROM Transfers
                WHERE Direction = 'Upload' AND State = 48
                    AND StartedAt IS NOT NULL AND EnqueuedAt IS NOT NULL
                    AND EndedAt BETWEEN @Start AND @End
                ORDER BY W
            ";
            var waits = connection.Query<double>(listSql, new { Start = s, End = e })
                .Where(w => w >= 0)
                .ToList();

            if (waits.Count == 0)
            {
                return new QueueWaitStats();
            }

            double Percentile(double p)
            {
                var idx = (int)Math.Ceiling(p * waits.Count) - 1;
                return waits[Math.Clamp(idx, 0, waits.Count - 1)];
            }

            return new QueueWaitStats
            {
                P50 = Percentile(0.5),
                P90 = Percentile(0.9),
                P99 = Percentile(0.99),
                Max = waits[^1],
                Avg = waits.Average(),
                Count = waits.Count,
            };
        });
    }

    /// <summary>
    ///     Returns the count of new versus returning peers active within the window, based on each peer's
    ///     first-ever transfer.
    /// </summary>
    /// <returns></returns>
    public PeerRetention GetPeerRetention(
        DateTime? start = null,
        DateTime? end = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:peers:{WindowKey(s, e)}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = @"
                    WITH firsts AS (
                        SELECT ""Username"", MIN(""EndedAt"") AS FirstSeen
                        FROM transfers.""Transfers""
                        WHERE ""EndedAt"" IS NOT NULL
                        GROUP BY ""Username""
                    ),
                    active AS (
                        SELECT DISTINCT ""Username""
                        FROM transfers.""Transfers""
                        WHERE ""EndedAt"" IS NOT NULL AND ""EndedAt"" BETWEEN @Start AND @End
                    )
                    SELECT
                        COUNT(*) FILTER (WHERE f.FirstSeen >= @Start) AS NewPeers,
                        COUNT(*) FILTER (WHERE f.FirstSeen < @Start) AS ReturningPeers
                    FROM active a
                    JOIN firsts f ON f.""Username"" = a.""Username""
                ";
            }
            else
            {
                sql = @"
                    WITH firsts AS (
                        SELECT Username, MIN(EndedAt) AS FirstSeen
                        FROM Transfers
                        WHERE EndedAt IS NOT NULL
                        GROUP BY Username
                    ),
                    active AS (
                        SELECT DISTINCT Username
                        FROM Transfers
                        WHERE EndedAt IS NOT NULL AND EndedAt BETWEEN @Start AND @End
                    )
                    SELECT
                        SUM(CASE WHEN f.FirstSeen >= @Start THEN 1 ELSE 0 END) AS NewPeers,
                        SUM(CASE WHEN f.FirstSeen < @Start THEN 1 ELSE 0 END) AS ReturningPeers
                    FROM active a
                    JOIN firsts f ON f.Username = a.Username
                ";
            }

            using var connection = OpenConnection(Database.Transfers);
            return connection.QueryFirstOrDefault<PeerRetention>(sql, new { Start = s, End = e }) ?? new PeerRetention();
        });
    }

    /// <summary>
    ///     Returns the number of distinct shared files that have ever been uploaded (catalog reach).
    /// </summary>
    /// <returns></returns>
    public CoverageReport GetCatalogCoverage()
    {
        return Cache.GetOrCreate("reports:coverage", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);

            string sql;
            if (UsePostgres)
            {
                sql = @"
                    SELECT COUNT(DISTINCT LOWER(SUBSTR(""Filename"", LENGTH(RTRIM(""Filename"", REPLACE(REPLACE(""Filename"", '/', ''), '\', ''))) + 1)))
                    FROM transfers.""Transfers""
                    WHERE ""Direction"" = 'Upload' AND ""State"" = 48
                ";
            }
            else
            {
                sql = @"
                    SELECT COUNT(DISTINCT LOWER(SUBSTR(Filename, LENGTH(RTRIM(Filename, REPLACE(REPLACE(Filename, '/', ''), '\', ''))) + 1)))
                    FROM Transfers
                    WHERE Direction = 'Upload' AND State = 48
                ";
            }

            using var connection = OpenConnection(Database.Transfers);
            var count = connection.ExecuteScalar<long>(sql);
            return new CoverageReport { UploadedFiles = count };
        });
    }

    /// <summary>
    ///     Returns counts of social / discovery events (browses, private messages, room messages, mentions)
    ///     within the window.
    /// </summary>
    /// <returns></returns>
    public SocialActivity GetSocialActivity(
        DateTime? start = null,
        DateTime? end = null)
    {
        var s = Utc(start ?? DateTime.MinValue);
        var e = Utc(end ?? DateTime.MaxValue);

        if (e <= s)
        {
            throw new ArgumentException("End time must be later than start time");
        }

        var cacheKey = $"reports:social:{WindowKey(s, e)}";
        return GetOrCreateReport(cacheKey, s, e, () =>
        {
            string sql;
            if (UsePostgres)
            {
                sql = @"
                    SELECT
                        COUNT(*) FILTER (WHERE ""Type"" = 'Browsed') AS Browsed,
                        COUNT(*) FILTER (WHERE ""Type"" = 'PrivateMessageReceived') AS PrivateMessages,
                        COUNT(*) FILTER (WHERE ""Type"" = 'RoomMessageReceived') AS RoomMessages,
                        COUNT(*) FILTER (WHERE ""Type"" = 'RoomMention') AS Mentions
                    FROM events.""Events""
                    WHERE ""Timestamp"" BETWEEN @Start AND @End
                ";
            }
            else
            {
                sql = @"
                    SELECT
                        SUM(CASE WHEN Type = 'Browsed' THEN 1 ELSE 0 END) AS Browsed,
                        SUM(CASE WHEN Type = 'PrivateMessageReceived' THEN 1 ELSE 0 END) AS PrivateMessages,
                        SUM(CASE WHEN Type = 'RoomMessageReceived' THEN 1 ELSE 0 END) AS RoomMessages,
                        SUM(CASE WHEN Type = 'RoomMention' THEN 1 ELSE 0 END) AS Mentions
                    FROM Events
                    WHERE Timestamp BETWEEN @Start AND @End
                ";
            }

            using var connection = OpenConnection(Database.Events);
            return connection.QueryFirstOrDefault<SocialActivity>(sql, new { Start = s, End = e }) ?? new SocialActivity();
        });
    }

    // Longer TTL for wider time windows — no point refreshing a 30-day summary every 30s.
    private static TimeSpan GetCacheTtl(DateTime start, DateTime end)
    {
        var range = end - start;

        if (range >= TimeSpan.FromDays(7))
        {
            return TimeSpan.FromMinutes(10);
        }

        if (range >= TimeSpan.FromDays(1))
        {
            return TimeSpan.FromMinutes(5);
        }

        return TimeSpan.FromMinutes(2);
    }

    // Identifies the requested window *relative to now*, quantized by the TTL, rather than by
    // absolute wall-clock minutes. The dashboard always requests windows anchored at "now", so
    // absolute keys changed on every visit and defeated the TTL entirely.
    private static string WindowKey(DateTime s, DateTime e)
    {
        var ttl = GetCacheTtl(s, e);
        var range = (long)Math.Round((e - s).TotalSeconds / ttl.TotalSeconds);
        var offset = (long)Math.Round((DateTime.UtcNow - e).TotalSeconds / ttl.TotalSeconds);
        return $"{range}r{offset}";
    }

    // Normalise DateTime values to UTC kind so Npgsql accepts them for timestamptz columns.
    // For SQLite the kind is ignored by Dapper so this is safe for both providers.
    private static DateTime Utc(DateTime dt) => DateTime.SpecifyKind(dt, DateTimeKind.Utc);

    // Serve-stale-while-revalidate: an entry past its TTL is returned immediately and refreshed on
    // a background thread, so requests only block on the database the very first time a window is
    // asked for (or after the entry has gone unused for several TTLs and been evicted).
    private T GetOrCreateReport<T>(string cacheKey, DateTime start, DateTime end, Func<T> factory)
    {
        var ttl = GetCacheTtl(start, end);

        if (Cache.TryGetValue<StaleWhileRevalidateEntry>(cacheKey, out var cached))
        {
            if (DateTime.UtcNow > cached.FreshUntil && RefreshesInFlight.TryAdd(cacheKey, 0))
            {
                _ = Task.Run(() =>
                {
                    try
                    {
                        Cache.Set(cacheKey, new StaleWhileRevalidateEntry(factory(), DateTime.UtcNow + ttl), ttl * 6);
                    }
                    catch (Exception ex)
                    {
                        Log.Warning("Background refresh of {CacheKey} failed: {Message}", cacheKey, ex.Message);
                    }
                    finally
                    {
                        RefreshesInFlight.TryRemove(cacheKey, out _);
                    }
                });
            }

            return (T)cached.Value;
        }

        var value = factory();
        Cache.Set(cacheKey, new StaleWhileRevalidateEntry(value, DateTime.UtcNow + ttl), ttl * 6);
        return value;
    }

    private DbConnection OpenConnection(Database database)
    {
        DbConnection conn = new NpgsqlConnection(ConnectionStrings[database]);
        conn.Open();
        return conn;
    }

    private sealed record StaleWhileRevalidateEntry(object Value, DateTime FreshUntil);

    private record VpnRow
    {
        public long VpnUsers { get; init; }
        public long TotalUsers { get; init; }
        public long UnknownUsers { get; init; }
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
