namespace Resonance.Tests.Analysis;

using System.Linq;
using global::resonance.Analysis;

public class WaveformResamplerTests
{
    [Fact]
    public void Shorter_Or_Equal_Input_Passes_Through()
    {
        var peaks = new[] { 0.1f, 0.5f, 0.9f };

        Assert.Same(peaks, WaveformResampler.Resample(peaks, 3));
        Assert.Same(peaks, WaveformResampler.Resample(peaks, 10));
        Assert.Null(WaveformResampler.Resample(null!, 10));
    }

    [Fact]
    public void Narrow_Spans_Keep_The_Peak()
    {
        // 6 -> 3 is two stored peaks per bar, below the RMS threshold, so each bar is the max.
        var result = WaveformResampler.Resample(new[] { 0.1f, 0.4f, 0.9f, 0.2f, 0.3f, 0.3f }, 3);

        Assert.Equal(new[] { 0.4f, 0.9f, 0.3f }, result);
    }

    [Fact]
    public void Wide_Spans_Use_Rms()
    {
        // 8 -> 2 is four per bar: at the threshold, so RMS rather than the peak.
        var result = WaveformResampler.Resample(new[] { 0f, 0f, 0f, 1f, 0.5f, 0.5f, 0.5f, 0.5f }, 2);

        Assert.Equal(2, result.Length);
        Assert.Equal(0.5f, result[0], 5);
        Assert.Equal(0.5f, result[1], 5);
    }

    [Fact]
    public void Output_Has_The_Requested_Length_And_Stays_In_Range()
    {
        var peaks = Enumerable.Range(0, 75_000).Select(i => (float)((i % 100) / 100.0)).ToArray();

        var result = WaveformResampler.Resample(peaks, 1024);

        Assert.Equal(1024, result.Length);
        Assert.All(result, v => Assert.InRange(v, 0f, 1f));
    }
}
