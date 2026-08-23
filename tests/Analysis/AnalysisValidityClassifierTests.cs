namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;

public class AnalysisValidityClassifierTests
{
    [Fact]
    public void Missing_When_No_Waveform_Row_Exists()
    {
        Assert.Equal(AnalysisValidity.Missing, AnalysisValidityClassifier.Classify(null));
    }

    [Fact]
    public void LegacyValid_When_Version_Was_Never_Recorded()
    {
        var waveform = new WaveformData([1f], [1f], [1f], [1f], NumBars: 1, WaveformVersion: null);

        Assert.Equal(AnalysisValidity.LegacyValid, AnalysisValidityClassifier.Classify(waveform));
    }

    [Fact]
    public void Current_When_Version_Matches_The_Running_Algorithm()
    {
        var waveform = new WaveformData(
            [1f], [1f], [1f], [1f], NumBars: 1, WaveformVersion: AudioAnalyzer.CurrentWaveformVersion);

        Assert.Equal(AnalysisValidity.Current, AnalysisValidityClassifier.Classify(waveform));
    }

    [Fact]
    public void Stale_When_Version_Is_Older_Than_The_Running_Algorithm()
    {
        var waveform = new WaveformData(
            [1f], [1f], [1f], [1f], NumBars: 1, WaveformVersion: AudioAnalyzer.CurrentWaveformVersion - 1);

        Assert.Equal(AnalysisValidity.Stale, AnalysisValidityClassifier.Classify(waveform));
    }

    [Fact]
    public void Current_When_Version_Is_Newer_Than_The_Running_Algorithm()
    {
        // A row written by a build ahead of this one (e.g. mid-rollout) shouldn't read as Stale.
        var waveform = new WaveformData(
            [1f], [1f], [1f], [1f], NumBars: 1, WaveformVersion: AudioAnalyzer.CurrentWaveformVersion + 1);

        Assert.Equal(AnalysisValidity.Current, AnalysisValidityClassifier.Classify(waveform));
    }
}
