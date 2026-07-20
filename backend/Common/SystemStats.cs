// <copyright file="SystemStats.cs" company="John Narey">
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

namespace resonance.Common
{
    using System;
    using System.IO;
    using System.Linq;
    using System.Net.Http;
    using System.Net.Sockets;
    using System.Text.Json;
    using System.Threading.Tasks;

    /// <summary>
    ///     Host and per-container CPU/memory sampling for monitoring. Containers are read via the
    ///     Docker Engine API over /var/run/docker.sock; host figures come from /proc, which reflects
    ///     the host even inside a container. All reads fail open and return null on error.
    /// </summary>
    public static class SystemStats
    {
        private const string DockerSocketPath = "/var/run/docker.sock";

        private static readonly Serilog.ILogger Log = Serilog.Log.ForContext(typeof(SystemStats));

        private static readonly HttpClient Docker = new HttpClient(new SocketsHttpHandler
        {
            ConnectCallback = async (_, cancellationToken) =>
            {
                var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
                await socket.ConnectAsync(new UnixDomainSocketEndPoint(DockerSocketPath), cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            },
        })
        {
            BaseAddress = new Uri("http://localhost"),
            Timeout = TimeSpan.FromSeconds(10),
        };

        private static (long Total, long Idle)? previousHostCpu;

        /// <summary>
        ///     Gets host memory from /proc/meminfo. Returns null if it can't be read.
        /// </summary>
        /// <returns>The used and total host memory in bytes, or null if /proc/meminfo can't be read.</returns>
        public static (long UsedBytes, long TotalBytes)? GetHostMemory()
        {
            try
            {
                var lines = File.ReadAllLines("/proc/meminfo");
                long total = ParseMemInfoKilobytes(lines, "MemTotal:");
                long available = ParseMemInfoKilobytes(lines, "MemAvailable:");
                return ((total - available) * 1024, total * 1024);
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to read /proc/meminfo: {Message}", ex.Message);
                return null;
            }
        }

        /// <summary>
        ///     Gets the Resonance process uptime in seconds, measured from the process start time.
        ///     Returns null if the start time can't be read.
        /// </summary>
        /// <returns>The process uptime in seconds, or null if it can't be determined.</returns>
        public static double? GetProcessUptimeSeconds()
        {
            try
            {
                using var process = System.Diagnostics.Process.GetCurrentProcess();
                return (DateTime.Now - process.StartTime).TotalSeconds;
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to read process start time: {Message}", ex.Message);
                return null;
            }
        }

        /// <summary>
        ///     Gets host CPU utilization as a percentage, computed against the previous call's
        ///     /proc/stat sample. Returns null on the first call and on read failure.
        /// </summary>
        /// <returns>The host CPU utilization percentage, or null if it can't yet be computed.</returns>
        public static double? GetHostCpuPercent()
        {
            try
            {
                var fields = File.ReadLines("/proc/stat").First(l => l.StartsWith("cpu "))
                    .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Skip(1)
                    .Select(long.Parse)
                    .ToArray();

                var total = fields.Sum();
                var idle = fields[3] + (fields.Length > 4 ? fields[4] : 0); // idle + iowait

                var previous = previousHostCpu;
                previousHostCpu = (total, idle);

                if (previous is null || total <= previous.Value.Total)
                {
                    return null;
                }

                var totalDelta = total - previous.Value.Total;
                var idleDelta = idle - previous.Value.Idle;
                return (totalDelta - idleDelta) * 100d / totalDelta;
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to read /proc/stat: {Message}", ex.Message);
                previousHostCpu = null;
                return null;
            }
        }

        /// <summary>
        ///     Gets CPU and memory stats for the named container from the Docker Engine API.
        ///     Returns null on any failure (socket absent, container down, etc).
        /// </summary>
        /// <returns>The container's CPU percentage and memory usage/limit, or null on failure.</returns>
        public static async Task<(double CpuPercent, long MemoryUsageBytes, long MemoryLimitBytes)?> GetContainerStatsAsync(string name)
        {
            try
            {
                // stream=false makes the daemon sample twice ~1s apart and return a single document
                // with both cpu_stats and precpu_stats populated, so no state is kept here.
                var json = await Docker.GetStringAsync($"/containers/{Uri.EscapeDataString(name)}/stats?stream=false");
                return ComputeContainerStats(json);
            }
            catch (Exception ex)
            {
                Log.Warning("Failed to read docker stats for container {Name}: {Message}", name, ex.Message);
                return null;
            }
        }

        /// <summary>
        ///     Computes CPU % and memory usage from a Docker stats API document. Public for tests.
        /// </summary>
        /// <returns>The container's CPU percentage and memory usage/limit, or null if the document can't be parsed.</returns>
        public static (double CpuPercent, long MemoryUsageBytes, long MemoryLimitBytes)? ComputeContainerStats(string json)
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var cpu = root.GetProperty("cpu_stats");
            var precpu = root.GetProperty("precpu_stats");

            var cpuDelta = cpu.GetProperty("cpu_usage").GetProperty("total_usage").GetInt64()
                - precpu.GetProperty("cpu_usage").GetProperty("total_usage").GetInt64();
            var systemDelta = GetInt64OrZero(cpu, "system_cpu_usage") - GetInt64OrZero(precpu, "system_cpu_usage");

            // system_cpu_usage aggregates all cores, so this is the share of TOTAL host
            // capacity (0-100), matching the host figure — deliberately not docker stats'
            // per-core convention (100% = one core), which reads as >100% on multi-core.
            var cpuPercent = systemDelta > 0 && cpuDelta > 0
                ? cpuDelta * 100d / systemDelta
                : 0d;

            var memory = root.GetProperty("memory_stats");
            var usage = GetInt64OrZero(memory, "usage");
            var limit = GetInt64OrZero(memory, "limit");

            // subtract page cache: inactive_file on cgroup v2, total_inactive_file on v1
            if (memory.TryGetProperty("stats", out var memoryStats))
            {
                usage -= GetInt64OrZero(memoryStats, "inactive_file") is var v2 && v2 > 0
                    ? v2
                    : GetInt64OrZero(memoryStats, "total_inactive_file");
            }

            return (cpuPercent, Math.Max(usage, 0), limit);
        }

        private static long GetInt64OrZero(JsonElement element, string property)
            => element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetInt64() : 0;

        private static long ParseMemInfoKilobytes(string[] lines, string prefix)
            => long.Parse(lines.First(l => l.StartsWith(prefix)).Split(' ', StringSplitOptions.RemoveEmptyEntries)[1]);
    }
}
