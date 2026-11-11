using System.Text.Json;
using resonance.Analysis.Candidates;

public class CandidateFeatureCoverageTests
{
    [Fact]
    public void AcceptsFullTrackWithAllRequestedFeatures()
    {
        using var result = JsonDocument.Parse("""
            {"scope":{"fullTrack":true},"featureAvailability":{"beats":"available","cues":"available","stems":"skipped"}}
            """);
        Assert.True(CandidateAnalysisService.HasSelectedFeatures(result.RootElement, ["beats", "cues"]));
        Assert.False(CandidateAnalysisService.HasSelectedFeatures(result.RootElement, ["beats", "stems"]));
    }

    [Theory]
    [InlineData("{\"scope\":{\"fullTrack\":false},\"featureAvailability\":{\"cues\":\"available\"}}")]
    [InlineData("{\"scope\":{\"fullTrack\":true},\"featureAvailability\":{\"cues\":\"failed\"}}")]
    [InlineData("{\"scope\":{\"fullTrack\":true},\"featureAvailability\":{}}")]
    public void RejectsIncompleteOrPartialResults(string json)
    {
        using var result = JsonDocument.Parse(json);
        Assert.False(CandidateAnalysisService.HasSelectedFeatures(result.RootElement, ["cues"]));
    }
}
