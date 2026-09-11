namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;
using global::resonance.MusicLibrary.API;

public class AnalysisRequestTests
{
    [Fact]
    public void Scan_Defaults_To_All_Missing_Metrics()
    {
        var request = new AnalysisScanRequest();

        Assert.Equal(AnalysisMetrics.All, request.Metrics);
        Assert.True(request.SkipAnalysed);
        Assert.False(request.ResetAll);
    }

    [Fact]
    public void Track_Request_Defaults_To_Preserving_Existing_Analysis()
    {
        var request = new AnalyzeTrackRequest();

        Assert.True(request.SkipAnalysed);
    }
}
