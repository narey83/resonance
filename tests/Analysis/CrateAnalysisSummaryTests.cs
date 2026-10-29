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
}
