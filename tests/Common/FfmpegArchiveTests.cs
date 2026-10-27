using System;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Threading.Tasks;
using resonance.Common.Ffmpeg;
using Xunit;

namespace Resonance.Tests.Common;

public class FfmpegArchiveTests
{
    [Fact]
    public async Task ZipExtractionFlattensOnlyExpectedBinariesAndRejectsIncompleteArchives()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var archivePath = Path.Combine(root, "test.zip");
            using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create))
            {
                using (var writer = new StreamWriter(archive.CreateEntry("build/bin/ffmpeg.exe").Open())) writer.Write("ffmpeg");
                using (var writer = new StreamWriter(archive.CreateEntry("build/bin/ffprobe.exe").Open())) writer.Write("ffprobe");
                using (var writer = new StreamWriter(archive.CreateEntry("../outside.txt").Open())) writer.Write("unexpected");
            }
            await FfmpegService.ExtractZipBinariesAsync(archivePath, root, new[] { "ffmpeg.exe", "ffprobe.exe" }, CancellationToken.None);
            Assert.Equal("ffmpeg", File.ReadAllText(Path.Combine(root, "ffmpeg.exe")));
            Assert.Equal("ffprobe", File.ReadAllText(Path.Combine(root, "ffprobe.exe")));
            File.WriteAllText(Path.Combine(root, "ffmpeg.exe"), "original");
            await Assert.ThrowsAsync<InvalidOperationException>(() => FfmpegService.ExtractZipBinariesAsync(archivePath, root, new[] { "ffmpeg.exe", "missing.exe" }, CancellationToken.None));
            Assert.Equal("original", File.ReadAllText(Path.Combine(root, "ffmpeg.exe")));
            Assert.False(File.Exists(Path.Combine(root, "outside.txt")));
        }
        finally { Directory.Delete(root, true); }
    }
}
