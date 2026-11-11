using System.Text.Json;
using resonance.Analysis.Candidates;

public class CandidateInferenceDeviceTests
{
    [Theory]
    [InlineData("cuda", true, null, 900000000)]
    [InlineData("cpu", true, "OutOfMemoryError", 0)]
    [InlineData("cpu", false, null, 0)]
    public void ReadsDeviceAndFallbackForSystemLogging(string device, bool attempted, string? fallback, long peak)
    {
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            features = new { stems = new { result = new { device, gpuAttempted = attempted, gpuFallback = fallback, gpuPeakAllocatedBytes = peak } } },
        }));
        var summary = CandidateAnalysisService.ReadInferenceDevice(json.RootElement);
        Assert.NotNull(summary);
        Assert.Equal(device, summary.Device);
        Assert.Equal(attempted, summary.GpuAttempted);
        Assert.Equal(fallback, summary.Fallback);
        Assert.Equal(peak, summary.PeakBytes);
    }

    [Fact]
    public void IgnoresResultsWithoutAValidStemDevice()
    {
        using var missing = JsonDocument.Parse("{\"features\":{}}");
        Assert.Null(CandidateAnalysisService.ReadInferenceDevice(missing.RootElement));
        using var invalid = JsonDocument.Parse("{\"features\":{\"stems\":{\"result\":{\"device\":\"unknown\"}}}}");
        Assert.Null(CandidateAnalysisService.ReadInferenceDevice(invalid.RootElement));
    }
}
