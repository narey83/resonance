using System.Text.Json;
using resonance.MusicLibrary;

public class EnhancedCoverageTests
{
    private static string Summary(bool complete, params string[] available) => JsonSerializer.Serialize(new
    {
        complete, coverageVersion = 1,
        coverage = new[] { "beats", "downbeats", "vocals", "stems", "sections", "phrases", "genre", "energy", "cues", "loops", "similarity" }
            .ToDictionary(feature => feature, available.Contains),
    });

    [Fact]
    public void CountsPartialFeaturesWithoutTreatingThemAsCompleteTracks()
    {
        var result = EnhancedCoverage.Count([Summary(true, "beats", "vocals", "genre"), Summary(false, "genre", "energy")]);
        Assert.Equal(2, result.Saved);
        Assert.Equal(1, result.Complete);
        Assert.Equal(0, result.Unindexed);
        Assert.Equal(2, result.Features["genre"]);
        Assert.Equal(1, result.Features["vocals"]);
        Assert.Equal(0, result.Features["stems"]);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("[]")]
    [InlineData("{\"coverageVersion\":\"1\",\"coverage\":{}}")]
    [InlineData("{\"coverageVersion\":1,\"coverage\":{\"vocals\":\"available\"}}")]
    public void BadOrIncompleteCoverageIsUnknownInsteadOfZero(string summary)
    {
        var result = EnhancedCoverage.Count([summary]);
        Assert.Equal(1, result.Unindexed);
        Assert.All(result.Features.Values, value => Assert.Equal(0, value));
    }

    [Fact]
    public void LegacyCompleteResultsStayReadyWhileTheirCoverageIsIndexed()
    {
        var result = EnhancedCoverage.Count(["{\"complete\":true}"]);
        Assert.Equal(1, result.Complete);
        Assert.Equal(1, result.Unindexed);
        Assert.Equal(11, result.Features.Count);
    }

    [Fact]
    public void EmptyLibraryHasKnownZeroCoverage()
    {
        var result = EnhancedCoverage.Count([]);
        Assert.Equal(0, result.Saved);
        Assert.Equal(0, result.Unindexed);
        Assert.All(result.Features.Values, value => Assert.Equal(0, value));
    }
}
