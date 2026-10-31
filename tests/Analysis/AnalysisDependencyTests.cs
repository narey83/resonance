namespace Resonance.Tests.Analysis;

using global::resonance.Analysis;

public sealed class AnalysisDependencyTests
{
    [Fact]
    public async Task CpuWorkersBoundDecoderAndDetectorThreadPools()
    {
        if (OperatingSystem.IsWindows()) return;
        var directory = Path.Combine(Path.GetTempPath(), "resonance-worker-budget-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var decoder = Path.Combine(directory, "decoder");
        var python = Path.Combine(directory, "python");
        await File.WriteAllBytesAsync(decoder + ".raw", new byte[44100 * sizeof(float)]);
        await File.WriteAllTextAsync(decoder, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$0.args\"\ncat \"$0.raw\"\n");
        await File.WriteAllTextAsync(python, """
            #!/bin/sh
            [ "$OMP_NUM_THREADS" = 1 ] && [ "$OPENBLAS_NUM_THREADS" = 1 ] && [ "$MKL_NUM_THREADS" = 1 ] && [ "$NUMEXPR_NUM_THREADS" = 1 ] || exit 72
            case "$2" in *RESONANCE_ESSENTIA_READY*) echo RESONANCE_ESSENTIA_READY; exit 0;; esac
            cat >/dev/null
            printf 'RESONANCE_JSON:{"bpm":128,"key":"Am"}\n'
            """);
        File.SetUnixFileMode(decoder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        File.SetUnixFileMode(python, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            var analyzer = new AudioAnalyzer();
            var options = new global::resonance.Options.AnalysisOptions { EssentiaPython = python };
            await analyzer.CheckEssentiaAsync(options, default);
            var result = await analyzer.AnalyseAsync("unused.wav", decoder, AnalysisMetrics.Bpm | AnalysisMetrics.Key, options, default);
            Assert.Equal((uint)128, result.Bpm);
            Assert.Equal("Am", result.Key);
            var arguments = await File.ReadAllTextAsync(decoder + ".args");
            Assert.Contains("-threads\n1\n", arguments);
            Assert.Contains("-filter_threads\n1\n", arguments);
            Assert.Contains("-filter_complex_threads\n1\n", arguments);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public async Task MissingInterpreterFailsWithActionablePackageError()
    {
        var options = new global::resonance.Options.AnalysisOptions
        {
            EssentiaPython = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "python"),
        };
        var error = await Assert.ThrowsAsync<AnalysisDependencyException>(() => new AudioAnalyzer().CheckEssentiaAsync(options, default));
        Assert.Contains("BPM/key", error.Message);
        Assert.Contains("analysis.essentia_python", error.Message);
    }

    [Theory]
    [InlineData("printf 'RESONANCE_ESSENTIA_READY\\n'", true)]
    [InlineData("echo 'ModuleNotFoundError: numpy' >&2; exit 1", false)]
    [InlineData("echo import-only", false)]
    public async Task PackageLoadFailureCannotPassTheDependencyGate(string command, bool healthy)
    {
        if (OperatingSystem.IsWindows()) return;
        var path = Path.Combine(Path.GetTempPath(), "resonance-python-" + Guid.NewGuid().ToString("N"));
        await File.WriteAllTextAsync(path, "#!/bin/sh\n" + command + "\n");
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            var check = new AudioAnalyzer().CheckEssentiaAsync(new() { EssentiaPython = path }, default);
            if (healthy) await check;
            else
            {
                var error = await Assert.ThrowsAsync<AnalysisDependencyException>(() => check);
                Assert.Contains("Essentia and NumPy", error.Message);
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void WaveformAndLoudnessDoNotCountAsSuccessfulBasicAnalysis()
    {
        var partial = new AnalysisResult(Waveform: new([1], [1], [1], [1], 1), Loudness: new(-7.5, -1, 2));
        Assert.Equal(AnalysisMetrics.Bpm | AnalysisMetrics.Key, partial.MissingMetrics(AnalysisMetrics.All));
        Assert.Equal(AnalysisMetrics.None, partial.MissingMetrics(AnalysisMetrics.Waveform | AnalysisMetrics.Loudness));
        Assert.Equal(AnalysisMetrics.None, (partial with { Bpm = 140, Key = "G#" }).MissingMetrics(AnalysisMetrics.All));
        Assert.Equal(AnalysisMetrics.Bpm | AnalysisMetrics.Key, (partial with { Bpm = 0, Key = " " }).MissingMetrics(AnalysisMetrics.All));
        Assert.False(new TrackAnalysisInfo("x", "x", "", "x", "mp3", 140, " ", true, -7.5, "", "", "").HasKey);
    }

    [Fact]
    public async Task DetectorDisappearingDuringDecodeThrowsInsteadOfReturningPartialSuccess()
    {
        if (OperatingSystem.IsWindows()) return;
        var directory = Path.Combine(Path.GetTempPath(), "resonance-detector-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var decoder = Path.Combine(directory, "decoder");
        var python = Path.Combine(directory, "python");
        await File.WriteAllBytesAsync(decoder + ".raw", new byte[44100 * sizeof(float)]);
        await File.WriteAllTextAsync(decoder, "#!/bin/sh\ncat \"$0.raw\"\n");
        await File.WriteAllTextAsync(python, "#!/bin/sh\necho 'ModuleNotFoundError: essentia' >&2\nexit 1\n");
        File.SetUnixFileMode(decoder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        File.SetUnixFileMode(python, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        try
        {
            await Assert.ThrowsAsync<AnalysisDependencyException>(() => new AudioAnalyzer().AnalyseAsync(
                "unused.wav", decoder, AnalysisMetrics.All, new() { EssentiaPython = python }, default));
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
