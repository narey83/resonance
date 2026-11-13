namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;

public class BarAnchorDetectorTests
{
    [Fact]
    public void Chooses_First_Clear_Bass_Attack_Before_A_Later_Louder_Phase()
    {
        var beats = Enumerable.Range(0, 16).Select(index => (float)(0.4 + index * 0.43)).ToArray();
        var low = new float[1_600];
        for (var index = 0; index < beats.Length; index++)
        {
            AddPulse(low, beats[index], index % 2 == 0 ? (index == 0 ? 1.1f : 1.2f) : 0.75f);
        }

        var anchor = BarAnchorDetector.Estimate(beats, Waveform(low));
        Assert.Equal(0, anchor.BeatIndex);
        Assert.Equal(beats[0], anchor.Seconds, 3);
        Assert.Equal("bass-attack", anchor.Source);
    }

    [Fact]
    public void Skips_Weak_Lead_In_Beats_Until_First_Clear_Bass_Attack()
    {
        var beats = Enumerable.Range(0, 16).Select(index => (float)(0.4 + index * 0.43)).ToArray();
        var low = new float[1_600];
        for (var index = 0; index < beats.Length; index++)
        {
            AddPulse(low, beats[index], index < 2 ? 0.08f : 1f);
        }

        var anchor = BarAnchorDetector.Estimate(beats, Waveform(low));
        Assert.Equal(2, anchor.BeatIndex);
        Assert.Equal(beats[2], anchor.Seconds, 3);
    }

    [Fact]
    public void Names_Fallback_When_No_Clear_Bass_Attack_Exists()
    {
        var beats = new[] { 0.4f, 0.8f, 1.2f };
        var anchor = BarAnchorDetector.Estimate(beats, Waveform(new float[400]));
        Assert.Equal(0, anchor.BeatIndex);
        Assert.Equal("first-detected-beat", anchor.Source);
        Assert.Null(BarAnchorDetector.Estimate(null, Waveform(new float[400])));
        Assert.Null(BarAnchorDetector.Estimate(new[] { 0.4f, 0.3f }, Waveform(new float[400])));
    }

    [Fact]
    public void Counts_Sixteen_And_Thirty_Two_Bar_Markers_From_Backend_Anchor()
    {
        var beats = Enumerable.Range(0, 131).Select(index => (float)(0.4 + index * 0.43)).ToArray();
        var anchor = new BarAnchorDetector.Result(beats[2], 2, "bass-attack");
        Assert.Equal(
            new[]
            {
                new BarMarker(beats[2], 2),
                new BarMarker(beats[66], 1),
                new BarMarker(beats[130], 2),
            },
            BarAnchorDetector.Markers(beats, anchor));
        Assert.Empty(BarAnchorDetector.Markers(null, anchor));
    }

    private static WaveformData Waveform(float[] low) =>
        new(Array.Empty<float>(), low, Array.Empty<float>(), Array.Empty<float>(), low.Length, low.Length / 200.0);

    private static void AddPulse(float[] low, float time, float amplitude)
    {
        var first = (int)Math.Round(time * 200);
        for (var index = first; index < first + 12; index++)
        {
            low[index] = amplitude;
        }
    }
}
