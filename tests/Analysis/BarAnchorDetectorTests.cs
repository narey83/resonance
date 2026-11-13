namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;

public class BarAnchorDetectorTests
{
    private const double Period = 0.43;

    [Fact]
    public void Recovers_Measured_Opening_Beat_But_Not_Silence()
    {
        var beats = Beats();
        var saved = beats.Skip(1).ToArray();
        var result = BarAnchorDetector.Analyze(saved, Waveform(beats));

        Assert.Equal(1, result.RecoveredOpeningBeats);
        Assert.InRange(result.DisplayShiftSeconds!.Value, 0.03, 0.05);
        Assert.Equal("measured-waveform-onset", result.DisplayShiftSource);
        Assert.Equal(beats[0] + result.DisplayShiftSeconds.Value, result.BasicGridBeats[0], 3);
        Assert.Equal(beats[1] + result.DisplayShiftSeconds.Value, result.BasicGridBeats[1], 3);
        Assert.Equal("saved-plus-measured-opening", result.BasicGridSource);

        var silent = BarAnchorDetector.Analyze(saved, Waveform(beats, silentOpening: true));
        Assert.Equal(0, silent.RecoveredOpeningBeats);
        Assert.Equal(beats[1] + (silent.DisplayShiftSeconds ?? 0), silent.BasicGridBeats[0], 3);

        var latePickup = BarAnchorDetector.Analyze(saved, Waveform(beats, offGridOpening: true));
        Assert.Equal(0, latePickup.RecoveredOpeningBeats);
        Assert.Equal(beats[1] + (latePickup.DisplayShiftSeconds ?? 0), latePickup.BasicGridBeats[0], 3);
    }

    [Fact]
    public void Stable_Later_Beats_Repair_Jittered_Startup_Only_With_Opening_Kick_Body()
    {
        var beats = Beats();
        var saved = beats.Skip(1).ToArray();
        saved[0] -= 0.09f;
        saved[1] -= 0.06f;
        saved[2] -= 0.024f;

        var recovered = BarAnchorDetector.Analyze(saved, Waveform(beats, softOpeningClick: true));
        Assert.Equal(1, recovered.RecoveredOpeningBeats);
        Assert.Equal("saved-plus-measured-opening", recovered.BasicGridSource);
        Assert.InRange(recovered.BasicGridBeats[0], beats[0] + 0.03f, beats[0] + 0.06f);
        for (var index = 1; index <= 3; index++)
        {
            Assert.InRange(recovered.BasicGridBeats[index], beats[index] + 0.03f, beats[index] + 0.06f);
        }

        Assert.True(recovered.BasicGridBeats.Zip(recovered.BasicGridBeats.Skip(1), (a, b) => a < b)
            .All(increasing => increasing));
        Assert.Equal(saved[9] + (recovered.DisplayShiftSeconds ?? 0), recovered.BasicGridBeats[10], 3);

        var silence = BarAnchorDetector.Analyze(saved, Waveform(beats, silentOpening: true));
        Assert.Equal(0, silence.RecoveredOpeningBeats);
        Assert.Equal("saved-beats", silence.BasicGridSource);

        var offGridPickup = BarAnchorDetector.Analyze(saved, Waveform(beats, offGridOpening: true));
        Assert.Equal(0, offGridPickup.RecoveredOpeningBeats);
        Assert.Equal("saved-beats", offGridPickup.BasicGridSource);

        var nearDuplicate = beats.Skip(1).ToArray();
        nearDuplicate[0] -= 0.14f;
        var duplicate = BarAnchorDetector.Analyze(nearDuplicate, Waveform(beats));
        Assert.Equal(0, duplicate.RecoveredOpeningBeats);
        Assert.Equal("saved-beats", duplicate.BasicGridSource);
    }

    [Fact]
    public void Pickup_And_Delayed_Bass_Do_Not_Set_The_Bar_Phase()
    {
        var pickupBeats = Beats(pickup: 1);
        var pickup = BarAnchorDetector.Analyze(pickupBeats, Waveform(pickupBeats, pickup: 1));
        Assert.Equal("supported", pickup.BarPhaseStatus);
        Assert.Equal(pickupBeats[1] + (pickup.DisplayShiftSeconds ?? 0), pickup.BarAnchorSeconds!.Value, 3);

        var beats = Beats();
        var lateBass = BarAnchorDetector.Analyze(beats, Waveform(beats, weakOpeningBass: true));
        Assert.Equal("supported", lateBass.BarPhaseStatus);
        Assert.Equal(beats[0] + (lateBass.DisplayShiftSeconds ?? 0), lateBass.BarAnchorSeconds!.Value, 3);
    }

    [Fact]
    public void Repeated_Sustained_Boundaries_Determine_Phrase_Phase()
    {
        var beats = Beats();
        var result = BarAnchorDetector.Analyze(beats, Waveform(beats));

        Assert.Equal("supported", result.BarPhaseStatus);
        Assert.Equal("supported", result.SixteenBarPhaseStatus);
        Assert.Equal("supported", result.ThirtyTwoBarPhaseStatus);
        AssertMarker(result, beats[32 * 4], 2);
        AssertMarker(result, beats[64 * 4], 2);
        AssertMarker(result, beats[16 * 4], 1);
    }

    [Fact]
    public void Irregular_Sections_Do_Not_Restart_Thirty_Two_Bar_Count()
    {
        var beats = Beats();
        var result = BarAnchorDetector.Analyze(beats, Waveform(beats, irregular: true));

        Assert.Equal("supported", result.ThirtyTwoBarPhaseStatus);
        AssertMarker(result, beats[64 * 4], 2);
        Assert.DoesNotContain(result.Markers, marker => Math.Abs(marker.Seconds - beats[8 * 4]) < 0.01);
        Assert.DoesNotContain(result.Markers, marker => Math.Abs(marker.Seconds - beats[12 * 4]) < 0.01);
        Assert.DoesNotContain(result.Markers, marker => Math.Abs(marker.Seconds - beats[24 * 4]) < 0.01);
    }

    [Fact]
    public void Anticipatory_Last_Beat_Is_Not_Mistaken_For_The_Next_Bar()
    {
        var beats = Beats();
        var supported = BarAnchorDetector.Analyze(beats,
            Waveform(beats, anticipateChanges: true, downbeatAccent: true));
        if (supported.BarPhaseStatus == "supported")
        {
            Assert.Equal(beats[0] + supported.DisplayShiftSeconds!.Value, supported.BarAnchorSeconds!.Value, 3);
            AssertMarker(supported, beats[32 * 4], 2);
        }
        else
        {
            Assert.Empty(supported.Markers);
        }

        var ambiguous = BarAnchorDetector.Analyze(beats,
            Waveform(beats, anticipateChanges: true));
        Assert.Equal("unresolved", ambiguous.BarPhaseStatus);
        Assert.Empty(ambiguous.Markers);
    }

    [Fact]
    public void Backbeat_Accent_Cannot_Move_A_Structurally_Aligned_Bar()
    {
        var beats = Beats();
        var result = BarAnchorDetector.Analyze(beats, Waveform(beats, backbeatAccent: true));
        Assert.NotEqual(beats[1], result.BarAnchorSeconds);
        if (result.BarPhaseStatus == "supported")
        {
            Assert.Equal(beats[0] + (result.DisplayShiftSeconds ?? 0), result.BarAnchorSeconds!.Value, 3);
        }
        else
        {
            Assert.Empty(result.Markers);
        }
    }

    [Fact]
    public void Internal_Skips_Preserve_Phase_And_Do_Not_Invent_Timestamps()
    {
        var beats = Beats();
        var saved = beats.Where((_, index) => index != 7 && index != 32 * 4).ToArray();
        var result = BarAnchorDetector.Analyze(saved, Waveform(beats));

        Assert.Equal(2, result.SkippedInternalBeats);
        Assert.DoesNotContain(result.BasicGridBeats, time => Math.Abs(time - beats[7]) < 0.001);
        Assert.DoesNotContain(result.Markers, marker => Math.Abs(marker.Seconds - beats[32 * 4]) < 0.01);
        AssertMarker(result, beats[64 * 4], 2);
    }

    [Fact]
    public void Uniform_Groove_And_Unreliable_Grid_Remain_Unresolved()
    {
        var beats = Beats();
        var uniform = BarAnchorDetector.Analyze(beats, Waveform(beats, uniform: true));
        Assert.Null(uniform.BarAnchorSeconds);
        Assert.Equal("unresolved", uniform.BarPhaseStatus);
        Assert.Empty(uniform.Markers);

        var gapped = beats.ToArray();
        for (var index = 24; index < gapped.Length; index++)
        {
            gapped[index] += 2;
        }

        var unreliable = BarAnchorDetector.Analyze(gapped, Waveform(beats));
        Assert.Null(unreliable.BarAnchorSeconds);
        Assert.Empty(unreliable.Markers);
        Assert.Equal("unavailable", BarAnchorDetector.Analyze(null, Waveform(beats)).BarPhaseStatus);
    }

    [Fact]
    public void Measured_Shift_Does_Not_Return_A_Beat_Past_The_Audio_End()
    {
        var beats = Beats();
        var waveform = Waveform(beats, endPadding: 0.01);
        var result = BarAnchorDetector.Analyze(beats, waveform);

        Assert.InRange(result.DisplayShiftSeconds!.Value, 0.03, 0.05);
        Assert.All(result.BasicGridBeats, time => Assert.InRange((double)time, 0, waveform.DurationSeconds!.Value));
        Assert.DoesNotContain(result.BasicGridBeats, time => time >= waveform.DurationSeconds!.Value);
        Assert.All(result.Markers, marker => Assert.InRange(marker.Seconds, 0, waveform.DurationSeconds!.Value));
    }

    private static float[] Beats(int pickup = 0) =>
        Enumerable.Range(0, (160 * 4) + pickup)
            .Select(index => (float)(0.02 + (index * Period))).ToArray();

    private static void AssertMarker(BarAnchorDetector.Result result, float rawTime, int level) =>
        Assert.Contains(result.Markers, marker =>
            marker.Level == level && Math.Abs(marker.Seconds - rawTime - (result.DisplayShiftSeconds ?? 0)) < 0.001);

    private static (float Low, float Mid, float High) Section(int beat, int pickup, bool irregular, bool uniform)
    {
        if (uniform)
        {
            return (0.5f, 0.5f, 0.5f);
        }

        var bar = Math.Max(0, (beat - pickup) / 4);
        var levels = bar / 32 % 2 == 0
            ? (Low: 0.15f, Mid: 0.18f, High: 0.2f)
            : (Low: 0.9f, Mid: 0.8f, High: 0.75f);
        if (irregular && (bar is >= 8 and < 12 or >= 24 and < 28))
        {
            return (levels.Low * 0.55f, levels.Mid * 0.65f, levels.High * 0.65f);
        }

        return levels;
    }

    private static WaveformData Waveform(
        float[] beats, int pickup = 0, bool irregular = false,
        bool uniform = false, bool silentOpening = false, bool offGridOpening = false,
        bool weakOpeningBass = false, bool anticipateChanges = false,
        bool downbeatAccent = false, bool backbeatAccent = false, bool softOpeningClick = false,
        double? endPadding = null)
    {
        var duration = beats[^1] + (endPadding ?? Period + 0.2);
        var size = (int)Math.Ceiling(duration * 200);
        var overall = new float[size];
        var low = new float[size];
        var mid = new float[size];
        var high = new float[size];
        for (var beat = 0; beat < beats.Length; beat++)
        {
            if (silentOpening && beat == 0)
            {
                continue;
            }

            var level = Section(beat, pickup, irregular, uniform);
            if (anticipateChanges && beat >= pickup && (beat + 1 - pickup) % (32 * 4) == 0)
            {
                var next = Section(beat + 1, pickup, irregular, uniform);
                level = ((level.Low * 0.3f) + (next.Low * 0.7f),
                    (level.Mid * 0.3f) + (next.Mid * 0.7f),
                    (level.High * 0.3f) + (next.High * 0.7f));
            }

            var first = (int)Math.Floor(beats[beat] * 200);
            var last = Math.Min(size, (int)Math.Ceiling((beats[beat] + Period) * 200));
            for (var index = first; index < last; index++)
            {
                if (offGridOpening && beat == 0 && index < first + 20)
                {
                    continue;
                }

                var kickStart = offGridOpening && beat == 0 ? first + 20 : first + 8;
                var kick = index >= kickStart && index < kickStart + 12 ? 0.8f : 0;
                var accent = index >= first + 8 && index < first + 20
                    && ((downbeatAccent && (beat - pickup) % 4 == 0)
                        || (backbeatAccent && (beat - pickup) % 4 == 1))
                    ? 0.6f : 0;
                low[index] = level.Low + ((weakOpeningBass && beat < 2) ? 0 : kick);
                mid[index] = level.Mid + ((softOpeningClick && beat == 0 ? 0.1f : 0.6f) * kick) + accent;
                high[index] = level.High + ((softOpeningClick && beat == 0 ? 0 : 0.4f) * kick) + accent;
                overall[index] = Math.Max(low[index], Math.Max(mid[index], high[index]));
            }
        }

        return new WaveformData(overall, low, mid, high, size, duration);
    }
}
