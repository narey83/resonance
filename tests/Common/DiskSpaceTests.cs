namespace Resonance.Tests.Common;

using System.Diagnostics;
using global::resonance.Common;

public class DiskSpaceTests
{
    [Fact]
    public void Linux_Volume_Capacity_Matches_Fundamental_Block_Units()
    {
        if (!OperatingSystem.IsLinux() || !Environment.Is64BitProcess) return;

        // Exercises the real filesystem, including VirtioFS where the preferred
        // I/O block size differs from the unit used for capacity block counts.
        var path = Directory.GetCurrentDirectory();
        using var process = new Process { StartInfo = new ProcessStartInfo("df") { RedirectStandardOutput = true, UseShellExecute = false } };
        process.StartInfo.ArgumentList.Add("-Pk");
        process.StartInfo.ArgumentList.Add(path);
        process.Start();
        var output = process.StandardOutput.ReadToEnd();
        Assert.True(process.WaitForExit(5000));
        Assert.Equal(0, process.ExitCode);
        var columns = output.Trim().Split('\n')[^1].Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var expectedTotal = long.Parse(columns[1]) * 1024;
        Assert.True(DiskSpace.TryGet(path, out var available, out var total));
        Assert.Equal(expectedTotal, total);
        Assert.InRange(available, 0, total);
    }
}
