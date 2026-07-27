namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;

public class AudioAnalyzerTests
{
    private const double Min = 88;
    private const double Max = 176;

    [Theory]
    [InlineData(128, 128)]  // already inside the window
    [InlineData(88, 88)]    // lower bound is inclusive
    [InlineData(175.9, 175.9)]
    [InlineData(64, 128)]   // half-time doubles up
    [InlineData(70, 140)]
    [InlineData(200, 100)]  // double-time halves down
    [InlineData(352, 88)]   // two doublings out
    [InlineData(22, 88)]    // two halvings out
    public void Folds_Tempo_Into_The_Preferred_Octave(double input, double expected)
    {
        Assert.Equal(expected, AudioAnalyzer.FoldOctave(input, Min, Max), 3);
    }

    [Fact]
    public void Folded_Tempo_Always_Lands_In_The_Half_Open_Window()
    {
        for (var bpm = 20.0; bpm < 400; bpm += 0.5)
        {
            var folded = AudioAnalyzer.FoldOctave(bpm, Min, Max);
            Assert.InRange(folded, Min, Max);
            Assert.NotEqual(Max, folded); // upper bound is exclusive
        }
    }

    [Theory]
    [InlineData(0)]      // folding off
    [InlineData(-10)]
    public void Leaves_Tempo_Untouched_When_Folding_Is_Disabled(double min)
    {
        Assert.Equal(60, AudioAnalyzer.FoldOctave(60, min, Max));
    }

    [Fact]
    public void Leaves_Tempo_Untouched_When_The_Window_Is_Under_One_Octave()
    {
        // A window narrower than 2x cannot fold unambiguously, so it must not try.
        Assert.Equal(200, AudioAnalyzer.FoldOctave(200, 100, 150));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Ignores_Non_Positive_Tempi(double bpm)
    {
        Assert.Equal(bpm, AudioAnalyzer.FoldOctave(bpm, Min, Max));
    }
}
