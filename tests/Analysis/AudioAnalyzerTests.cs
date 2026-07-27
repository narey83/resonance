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

    // The chunked hand-off to Essentia must be byte-identical to the samples it replaces;
    // a slicing bug here would silently corrupt every BPM and key result rather than fail.
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(16_383)]   // just under one chunk (64KB / 4 bytes)
    [InlineData(16_384)]   // exactly one chunk
    [InlineData(16_385)]   // one chunk plus a remainder
    [InlineData(100_000)]  // several chunks
    public async Task Writes_Pcm_Byte_Identically_In_Chunks(int sampleCount)
    {
        var pcm = new float[sampleCount + 5_000]; // trailing samples must not be written
        for (var i = 0; i < pcm.Length; i++)
        {
            pcm[i] = (float)Math.Sin(i * 0.01);
        }

        using var stream = new MemoryStream();
        await AudioAnalyzer.WritePcmAsync(stream, pcm, sampleCount);

        var expected = new byte[sampleCount * 4];
        Buffer.BlockCopy(pcm, 0, expected, 0, expected.Length);

        Assert.Equal(expected, stream.ToArray());
    }

    // ebur128's summary repeats "LRA" on three lines and "Threshold" on two; the parser has to
    // pick the right ones or loudness silently lands on a threshold value.
    [Fact]
    public void Parses_The_Ebur128_Summary()
    {
        const string Summary = """
            [Parsed_ebur128_1 @ 0x708568001b80] Summary:

              Integrated loudness:
                I:          -6.9 LUFS
                Threshold: -16.9 LUFS

              Loudness range:
                LRA:         1.4 LU
                Threshold: -26.9 LUFS
                LRA low:    -7.4 LUFS
                LRA high:   -6.0 LUFS

              True peak:
                Peak:        2.0 dBFS
            """;

        var result = AudioAnalyzer.ParseLoudness(Summary);

        Assert.NotNull(result);
        Assert.Equal(-6.9, result.IntegratedLufs, 3);
        Assert.Equal(1.4, result.LoudnessRange, 3);
        Assert.Equal(2.0, result.TruePeak, 3);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("ffmpeg version 7.0\nno summary here")]
    public void Returns_Null_When_The_Summary_Is_Missing(string stderr)
    {
        Assert.Null(AudioAnalyzer.ParseLoudness(stderr));
    }
}
