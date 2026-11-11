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
        Assert.False(request.Enhanced);
        Assert.Null(request.EnhancedFeatures);
        Assert.False(request.WriteAutoCues);
        Assert.Null(request.CueUsername);
    }

    [Fact]
    public void Scan_Cue_Owner_Cannot_Be_Set_From_Json()
    {
        var request = System.Text.Json.JsonSerializer.Deserialize<AnalysisScanRequest>(
            """{"enhanced":true,"writeAutoCues":true,"cueUsername":"someone-else"}""",
            new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        Assert.NotNull(request);
        Assert.Null(request.CueUsername);
    }

    [Fact]
    public void Track_Request_Defaults_To_Preserving_Existing_Analysis()
    {
        var request = new AnalyzeTrackRequest();

        Assert.True(request.SkipAnalysed);
    }
}
