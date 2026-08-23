namespace Resonance.Tests.Analysis;

using System.Linq;
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
    public void Returns_Null_When_The_Summary_Is_Missing(string? stderr)
    {
        Assert.Null(AudioAnalyzer.ParseLoudness(stderr));
    }

    // ── CompareBeatsToGrid ────────────────────────────────────────────────────

    private const double Bpm128 = 128;
    private const double Offset = 2.137;
    private static double SecondsPerBeat => 60.0 / Bpm128;

    private static float[] PerfectGrid(int count) =>
        Enumerable.Range(0, count).Select(i => (float)(Offset + (i * SecondsPerBeat))).ToArray();

    [Fact]
    public void Reports_Zero_Error_When_Beats_Sit_Exactly_On_The_Grid()
    {
        var summary = AudioAnalyzer.CompareBeatsToGrid(PerfectGrid(20), Bpm128, Offset);

        Assert.Equal(20, summary.Count);
        Assert.Equal(0, summary.MeanAbsErrorSeconds, 4);
        Assert.Equal(0, summary.MaxAbsErrorSeconds, 4);
        Assert.Equal(0, summary.SkippedBeats);
        Assert.Equal(0, summary.ExtraBeats);
        Assert.All(summary.Comparisons, c => Assert.Equal(1, c.IndexGap));
    }

    [Fact]
    public void Reports_Small_Nonzero_Error_When_Detection_Jitters_Around_The_Grid()
    {
        // Deterministic "jitter" rather than random, so the test is reproducible: alternating
        // +8ms/-8ms around the true grid position, as a real detector's small timing noise would.
        var beats = PerfectGrid(20);
        for (var i = 0; i < beats.Length; i++)
        {
            beats[i] += i % 2 == 0 ? 0.008f : -0.008f;
        }

        var summary = AudioAnalyzer.CompareBeatsToGrid(beats, Bpm128, Offset);

        Assert.Equal(0, summary.SkippedBeats);
        Assert.Equal(0, summary.ExtraBeats);
        Assert.InRange(summary.MeanAbsErrorSeconds, 0.007, 0.009);
        Assert.InRange(summary.MaxAbsErrorSeconds, 0.007, 0.009);
    }

    [Fact]
    public void Detects_A_Skipped_Beat_As_An_Index_Gap_Without_Corrupting_Later_Comparisons()
    {
        // A clean grid with beat index 5 missing entirely — a detector that failed to fire once.
        var beats = PerfectGrid(20).Where((_, i) => i != 5).ToArray();

        var summary = AudioAnalyzer.CompareBeatsToGrid(beats, Bpm128, Offset);

        Assert.Equal(19, summary.Count);
        Assert.Equal(1, summary.SkippedBeats);
        Assert.Equal(0, summary.ExtraBeats);
        // Re-syncs at the very next beat — every comparison stays near-zero error rather than
        // the gap cascading into a growing offset for the rest of the track.
        Assert.Equal(0, summary.MeanAbsErrorSeconds, 4);
        Assert.Equal(0, summary.MaxAbsErrorSeconds, 4);
    }

    [Fact]
    public void Detects_An_Extra_Inserted_Beat_As_A_Non_Positive_Index_Gap()
    {
        // A spurious extra detection halfway between two real grid beats.
        var beats = PerfectGrid(20).ToList();
        beats.Insert(5, (float)(Offset + (4.5 * SecondsPerBeat)));

        var summary = AudioAnalyzer.CompareBeatsToGrid(beats.ToArray(), Bpm128, Offset);

        Assert.Equal(21, summary.Count);
        Assert.Equal(0, summary.SkippedBeats);
        Assert.Equal(1, summary.ExtraBeats);
    }

    [Fact]
    public void Handles_A_Single_Beat_Without_Skip_Or_Extra_Counts()
    {
        var summary = AudioAnalyzer.CompareBeatsToGrid(PerfectGrid(1), Bpm128, Offset);

        Assert.Equal(1, summary.Count);
        Assert.Equal(0, summary.SkippedBeats);
        Assert.Equal(0, summary.ExtraBeats);
    }

    [Fact]
    public void Handles_No_Beats_Without_Throwing()
    {
        var summary = AudioAnalyzer.CompareBeatsToGrid([], Bpm128, Offset);

        Assert.Equal(0, summary.Count);
        Assert.Equal(0, summary.MeanAbsErrorSeconds);
        Assert.Equal(0, summary.MaxAbsErrorSeconds);
    }

    // Regression coverage for the waveform/audio sync bug: a legacy row has no stored
    // waveform_duration_seconds, so AnalysisStore.GetWaveform falls back to inverting num_bars.
    // 80,141 is the real bar count a since-fixed track ("Cordial", 17,671,047 samples / 44,100Hz =
    // 400.704014s of PCM) was analysed with; the inverse must land within a fraction of a bar of
    // the true duration, not the multi-second drift a browser's own duration estimate can
    // introduce.
    [Fact]
    public void EstimateDurationFromBars_Recovers_The_Original_Duration_To_Within_Half_A_Bar()
    {
        var estimated = AudioAnalyzer.EstimateDurationFromBars(80_141);

        Assert.NotNull(estimated);
        Assert.InRange(estimated!.Value, 400.704_014 - 0.0025, 400.704_014 + 0.0025);
    }

    [Theory]
    [InlineData(500)]      // exactly MinBars — could be a genuine short clip or a clamp
    [InlineData(200_000)]  // exactly MaxBars — same ambiguity at the top end
    public void EstimateDurationFromBars_Refuses_To_Guess_At_The_Clamp_Boundary(int numBars)
    {
        Assert.Null(AudioAnalyzer.EstimateDurationFromBars(numBars));
    }

    [Theory]
    [InlineData(501)]
    [InlineData(199_999)]
    public void EstimateDurationFromBars_Trusts_Values_Just_Inside_The_Clamp(int numBars)
    {
        Assert.NotNull(AudioAnalyzer.EstimateDurationFromBars(numBars));
    }
}
