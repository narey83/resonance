using System.Text.Json;
using resonance.Analysis.Candidates;

public class CandidateAutoCueTests
{
    [Fact]
    public void FiltersInvalidAndDuplicateCuePositions()
    {
        using var result = JsonDocument.Parse("""
            {"durationSeconds":120,"featureAvailability":{"cues":"available"},"features":{"cues":{"result":{"cueProposals":[{"seconds":10.0},{"seconds":10.04},{"seconds":42.5},{"seconds":130},{"seconds":-1},{}]}}}}
            """);
        Assert.Equal([10.0, 42.5], CandidateAnalysisService.CueSeconds(result.RootElement));
    }

    [Fact]
    public void RejectsMissingCueAnalysis()
    {
        using var result = JsonDocument.Parse("""{"durationSeconds":120,"featureAvailability":{"cues":"failed"}}""");
        Assert.Throws<InvalidOperationException>(() => CandidateAnalysisService.CueSeconds(result.RootElement));
    }
}
