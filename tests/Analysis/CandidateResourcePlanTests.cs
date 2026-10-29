namespace Resonance.Tests.Analysis;

using global::resonance.Analysis.Candidates;

public class CandidateResourcePlanTests
{
    private static CandidateAnalysisOptions Options(
        int jobs = 0,
        int threads = 0,
        long memoryPerJob = 5L << 30) =>
        new(string.Empty, string.Empty, string.Empty, string.Empty, MaxParallelJobs: jobs, ThreadsPerJob: threads, MemoryPerJobBytes: memoryPerJob);

    [Theory]
    [InlineData(8, 30, 4, 2)]
    [InlineData(8, 16, 2, 4)]
    [InlineData(4, 64, 4, 1)]
    [InlineData(2, 4, 1, 2)]
    public void AutomaticPlanUsesGrantedCpuWithoutExceedingMemory(int processors, int memoryGiB, int jobs, int threads)
    {
        var plan = Options().ResolveResources(processors, memoryGiB * (1L << 30));
        Assert.Equal(jobs, plan.ParallelJobs);
        Assert.Equal(threads, plan.ThreadsPerJob);
        Assert.Equal(processors, plan.ParallelJobs * plan.ThreadsPerJob);
    }

    [Fact]
    public void ExplicitJobLimitStillAllocatesAllProcessorsAcrossThoseJobs()
    {
        var plan = Options(jobs: 2).ResolveResources(8, 32L << 30);
        Assert.Equal(2, plan.ParallelJobs);
        Assert.Equal(4, plan.ThreadsPerJob);
    }

    [Fact]
    public void ExplicitThreadAllocationDerivesACompatibleJobCount()
    {
        var plan = Options(threads: 2).ResolveResources(8, 32L << 30);
        Assert.Equal(4, plan.ParallelJobs);
        Assert.Equal(2, plan.ThreadsPerJob);
    }

    [Fact]
    public void ExplicitSettingsAreClampedToAvailableProcessors()
    {
        var plan = Options(jobs: 64, threads: 64).ResolveResources(4, 32L << 30);
        Assert.Equal(4, plan.ParallelJobs);
        Assert.Equal(4, plan.ThreadsPerJob);
    }
}
