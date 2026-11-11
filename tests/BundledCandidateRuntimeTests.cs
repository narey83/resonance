using resonance.Analysis.Candidates;

public class BundledCandidateRuntimeTests
{
    [Fact]
    public void DiscoversOnlyACompleteInstalledRuntime()
    {
        var data = Path.Combine(Path.GetTempPath(), "resonance-bundle-" + Guid.NewGuid().ToString("N"));
        var root = Path.Combine(data, "enhanced-analysis", "current");
        try
        {
            Assert.Null(BundledCandidateRuntime.Resolve(data).Python);
            Directory.CreateDirectory(Path.Combine(root, "envs", "enhanced", "bin"));
            Directory.CreateDirectory(Path.Combine(root, "worker"));
            File.WriteAllText(Path.Combine(root, "envs", "enhanced", "bin", "python"), "");
            File.WriteAllText(Path.Combine(root, "worker", "analyze_track.py"), "");
            Assert.Null(BundledCandidateRuntime.Resolve(data).Python);
            File.WriteAllText(Path.Combine(root, "config.json"), "{}");
            var runtime = BundledCandidateRuntime.Resolve(data);
            Assert.Equal(Path.Combine(root, "envs", "enhanced", "bin", "python"), runtime.Python);
            Assert.Equal(Path.Combine(root, "worker", "analyze_track.py"), runtime.Worker);
            Assert.Equal(Path.Combine(root, "config.json"), runtime.Config);
        }
        finally
        {
            if (Directory.Exists(data)) Directory.Delete(data, recursive: true);
        }
    }
}
