using resonance.Analysis.Candidates;

public class CandidateStemAudioTests
{
    [Theory]
    [InlineData("vocals", "vocals.wav")]
    [InlineData("drums", "drums.wav")]
    [InlineData("bass", "bass.wav")]
    [InlineData("other", "other.wav")]
    public void AcceptsOnlyKnownStemNames(string stem, string file)
    {
        Assert.Equal(file, CandidateAnalysisService.StemFileName(stem));
    }

    [Theory]
    [InlineData("../vocals")]
    [InlineData("Vocals")]
    [InlineData("vocals.wav")]
    [InlineData("")]
    public void RejectsUnexpectedStemNames(string stem)
    {
        Assert.Throws<ArgumentException>(() => CandidateAnalysisService.StemFileName(stem));
    }
}
