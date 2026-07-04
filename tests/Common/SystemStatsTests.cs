namespace Resonance.Tests.Common;

using global::resonance.Common;

public class SystemStatsTests
{
    private static string StatsJson(
        long cpuTotal = 400_000_000,
        long precpuTotal = 100_000_000,
        long systemTotal = 2_000_000_000,
        long precpuSystem = 1_000_000_000,
        int onlineCpus = 4,
        long memUsage = 500_000_000,
        long memLimit = 3_000_000_000,
        string memStats = @"""inactive_file"": 100000000")
        => $@"{{
            ""cpu_stats"": {{
                ""cpu_usage"": {{ ""total_usage"": {cpuTotal} }},
                ""system_cpu_usage"": {systemTotal},
                ""online_cpus"": {onlineCpus}
            }},
            ""precpu_stats"": {{
                ""cpu_usage"": {{ ""total_usage"": {precpuTotal} }},
                ""system_cpu_usage"": {precpuSystem}
            }},
            ""memory_stats"": {{
                ""usage"": {memUsage},
                ""limit"": {memLimit},
                ""stats"": {{ {memStats} }}
            }}
        }}";

    [Fact]
    public void Computes_Cpu_Percent_Of_Total_Host_Capacity()
    {
        var stats = SystemStats.ComputeContainerStats(StatsJson());

        // 300M of the 1000M consumed across all cores = 30% of the whole host
        Assert.Equal(30d, stats.Value.CpuPercent, precision: 5);
    }

    [Fact]
    public void Subtracts_Inactive_File_From_Memory_Usage()
    {
        var stats = SystemStats.ComputeContainerStats(StatsJson());

        Assert.Equal(400_000_000, stats.Value.MemoryUsageBytes);
        Assert.Equal(3_000_000_000, stats.Value.MemoryLimitBytes);
    }

    [Fact]
    public void Falls_Back_To_Total_Inactive_File_For_Cgroup_V1()
    {
        var stats = SystemStats.ComputeContainerStats(StatsJson(memStats: @"""total_inactive_file"": 200000000"));

        Assert.Equal(300_000_000, stats.Value.MemoryUsageBytes);
    }

    [Fact]
    public void Cpu_Is_Zero_When_System_Delta_Is_Zero()
    {
        var stats = SystemStats.ComputeContainerStats(StatsJson(systemTotal: 1_000_000_000, precpuSystem: 1_000_000_000));

        Assert.Equal(0d, stats.Value.CpuPercent);
    }

    [Fact]
    public void Memory_Usage_Never_Negative()
    {
        var stats = SystemStats.ComputeContainerStats(StatsJson(memUsage: 50, memStats: @"""inactive_file"": 100"));

        Assert.Equal(0, stats.Value.MemoryUsageBytes);
    }
}
