namespace Resonance.Tests.Files;

using global::resonance.Files;
using Microsoft.Extensions.Options;
using AppOptions = global::resonance.Options;

public class FileServiceTests
{
    // FileService's only dependency is IOptionsMonitor<Options>; a default Options is
    // sufficient for MoveFile (Permissions.File.Mode is null, so no chmod is attempted).
    private sealed class StubOptionsMonitor : IOptionsMonitor<AppOptions>
    {
        private readonly AppOptions value = new();

        public AppOptions CurrentValue => value;

        public AppOptions Get(string? name) => value;

        public IDisposable? OnChange(Action<AppOptions, string?> listener) => null;
    }

    private static FileService NewService() => new(new StubOptionsMonitor());

    [Fact]
    public void MoveFile_DoesNotAppendANumericTicksSuffix_OnNameCollision()
    {
        var root = Directory.CreateTempSubdirectory("resonance-movefile");

        try
        {
            var src = Path.Combine(root.FullName, "in", "track.mp3");
            var destDir = Path.Combine(root.FullName, "out");
            Directory.CreateDirectory(Path.GetDirectoryName(src)!);
            Directory.CreateDirectory(destDir);

            // a genuinely different file (different size) already occupies the destination name
            File.WriteAllText(src, "freshly-downloaded-bytes-of-a-different-size");
            File.WriteAllText(Path.Combine(destDir, "track.mp3"), "old");

            var result = NewService().MoveFile(src, destDir, overwrite: false);

            // both are kept, but disambiguated with a human-readable " (1)" suffix —
            // never the legacy "_<DateTime.Ticks>" form that produced the duplicate clutter.
            Assert.Equal(Path.Combine(destDir, "track (1).mp3"), result);
            Assert.DoesNotMatch(@"_\d{12,}", Path.GetFileName(result));
            Assert.True(File.Exists(Path.Combine(destDir, "track.mp3")));
            Assert.True(File.Exists(result));
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }

    [Fact]
    public void MoveFile_DiscardsRedundantDownload_WhenAnIdenticalSizedCopyExists()
    {
        var root = Directory.CreateTempSubdirectory("resonance-movefile");

        try
        {
            var src = Path.Combine(root.FullName, "in", "track.mp3");
            var destDir = Path.Combine(root.FullName, "out");
            Directory.CreateDirectory(Path.GetDirectoryName(src)!);
            Directory.CreateDirectory(destDir);

            // an existing copy of the same size is treated as the same track
            File.WriteAllText(src, "AAAA");
            File.WriteAllText(Path.Combine(destDir, "track.mp3"), "BBBB");

            var result = NewService().MoveFile(src, destDir, overwrite: false);

            Assert.Equal(Path.Combine(destDir, "track.mp3"), result); // kept the existing copy
            Assert.False(File.Exists(src));                           // redundant download discarded
            Assert.Single(Directory.GetFiles(destDir));               // no second file created
        }
        finally
        {
            root.Delete(recursive: true);
        }
    }
}
