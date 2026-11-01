using System.Text.Json;
using resonance.Analysis.Candidates;

public class CrateAnalysisSummaryTests
{
    [Fact]
    public void PartialFullTrackGenreIsUsableWithoutMarkingAnalysisComplete()
    {
        using var data = JsonDocument.Parse("""{"scope":{"fullTrack":true},"featureAvailability":{"genre":"available","vocalPresence":"failed"},"features":{"genre":{"result":{"scores":[{"label":"Techno","cosine":0.9}]}}}}""");
        using var result = JsonDocument.Parse(CrateAnalysisSummary.Create(data.RootElement,"partial")!);
        Assert.Equal("Techno", result.RootElement.GetProperty("genre").GetString());
        Assert.Equal(JsonValueKind.Null, result.RootElement.GetProperty("vocals").ValueKind);
        Assert.False(result.RootElement.GetProperty("complete").GetBoolean());
        Assert.False(result.RootElement.GetProperty("exportReady").GetBoolean());
    }

    [Fact]
    public void PreviewScopeCannotPopulateFullTrackCollections()
    {
        using var data = JsonDocument.Parse("""{"scope":{"fullTrack":false},"features":{},"featureAvailability":{}}""");
        Assert.Null(CrateAnalysisSummary.Create(data.RootElement,"preview"));
    }

    [Fact]
    public void CoverageDistinguishesEmptyVocalsFromFailedAndUnavailableFeatures()
    {
        using var data = JsonDocument.Parse("""{"scope":{"fullTrack":true},"featureAvailability":{"beats":"available","vocalPresence":"available","stems":"failed","cues":"available","loops":"unavailable"},"features":{"beats":{"result":{"bpm_median_interval":128,"beats_seconds":[0,0.5],"downbeats_seconds":[]}},"vocalPresence":{"result":{"segments":[]}},"stems":{"result":{}},"cues":{"result":{"cueProposals":[]}},"loops":{"result":{}}}}""");
        using var document = JsonDocument.Parse(CrateAnalysisSummary.Create(data.RootElement, "coverage")!);
        var root = document.RootElement;
        Assert.False(root.GetProperty("vocals").GetBoolean());
        Assert.Equal(1, root.GetProperty("coverageVersion").GetInt32());
        var coverage = root.GetProperty("coverage");
        Assert.True(coverage.GetProperty("beats").GetBoolean());
        Assert.True(coverage.GetProperty("vocals").GetBoolean());
        Assert.True(coverage.GetProperty("cues").GetBoolean());
        Assert.False(coverage.GetProperty("downbeats").GetBoolean());
        Assert.False(coverage.GetProperty("stems").GetBoolean());
        Assert.False(coverage.GetProperty("loops").GetBoolean());
    }

    [Fact]
    public void FullTrackStemOnlyResultCanPopulateFeatureCoverage()
    {
        using var data = JsonDocument.Parse("""{"scope":{"fullTrack":true},"featureAvailability":{"stems":"available"},"features":{"stems":{"result":{}}}}""");
        using var document = JsonDocument.Parse(CrateAnalysisSummary.Create(data.RootElement, "stems")!);
        Assert.True(document.RootElement.GetProperty("coverage").GetProperty("stems").GetBoolean());
        Assert.False(document.RootElement.GetProperty("complete").GetBoolean());
    }
}
