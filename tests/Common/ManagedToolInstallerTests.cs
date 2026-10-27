namespace Resonance.Tests.Common;

using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using resonance.Common;
using Resonance.Integrations.YtDlp;
using System.Runtime.InteropServices;

[CollectionDefinition("Bundled tools environment", DisableParallelization = true)]
public class BundledToolsEnvironment { }

[Collection("Bundled tools environment")]
public class ManagedToolInstallerTests
{
    private sealed class Factory(Dictionary<string, byte[]> assets, bool corruptLast = false) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(assets, corruptLast));
    }
    private sealed class Handler(Dictionary<string, byte[]> assets, bool corruptLast) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.Host == "api.github.com")
            {
                var manifest = new { tag_name = "v2", assets = assets.Select((pair, index) => new { name = pair.Key, digest = "sha256:" + (corruptLast && index == assets.Count - 1 ? new string('0', 64) : Convert.ToHexString(SHA256.HashData(pair.Value)).ToLowerInvariant()), browser_download_url = "https://github.com/yt-dlp/yt-dlp/releases/download/v2/" + pair.Key }) };
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(manifest)) });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(assets[request.RequestUri.Segments.Last()]) });
        }
    }
    [Theory]
    [InlineData("macos", Architecture.Arm64, "yt-dlp_macos", "deno-aarch64-apple-darwin.zip")]
    [InlineData("windows", Architecture.X64, "yt-dlp.exe", "deno-x86_64-pc-windows-msvc.zip")]
    [InlineData("windows", Architecture.Arm64, "yt-dlp_arm64.exe", "deno-aarch64-pc-windows-msvc.zip")]
    [InlineData("linux", Architecture.X64, "yt-dlp_linux", "deno-x86_64-unknown-linux-gnu.zip")]
    [InlineData("linux", Architecture.Arm64, "yt-dlp_linux_aarch64", "deno-aarch64-unknown-linux-gnu.zip")]
    public void ChoosesNativeStandaloneAssets(string os, Architecture arch, string tool, string runtime) =>
        Assert.Equal((tool, runtime), YtDlpService.DependencyAssets(os, arch));

    [Fact]
    public async Task InstallsVerifiedAssetsButDoesNotReplaceAnyWorkingFileIfAnUpdateChecksumFails()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        try
        {
            var assets = new Dictionary<string, byte[]> { ["first"] = Encoding.UTF8.GetBytes("new first"), ["second"] = Encoding.UTF8.GetBytes("new second") };
            var files = new[] { new ManagedToolInstaller.Asset("first", "first"), new ManagedToolInstaller.Asset("second", "second") };
            Directory.CreateDirectory(root);
            File.WriteAllText(Path.Combine(root, "first"), "working first");
            File.WriteAllText(Path.Combine(root, "second"), "working second");
            await Assert.ThrowsAsync<InvalidOperationException>(() => new ManagedToolInstaller(new Factory(assets, true)).InstallAsync("yt-dlp/yt-dlp", root, files, CancellationToken.None));
            Assert.Equal("working first", File.ReadAllText(Path.Combine(root, "first")));
            Assert.Equal("working second", File.ReadAllText(Path.Combine(root, "second")));
            Assert.Empty(Directory.GetDirectories(root));
            await new ManagedToolInstaller(new Factory(assets)).InstallAsync("yt-dlp/yt-dlp", root, files, CancellationToken.None);
            Assert.Equal("new first", File.ReadAllText(Path.Combine(root, "first")));
            Assert.Equal("v2", File.ReadAllText(Path.Combine(root, "yt-dlp-release.txt")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task ExtractsOnlyTheNamedZipEntryAndNeverArchivePaths()
    {
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        try
        {
            using var data = new MemoryStream();
            using (var zip = new ZipArchive(data, ZipArchiveMode.Create, leaveOpen: true))
            {
                using (var writer = new StreamWriter(zip.CreateEntry("deno").Open())) writer.Write("runtime");
                using (var writer = new StreamWriter(zip.CreateEntry("../outside").Open())) writer.Write("bad");
            }
            var assets = new Dictionary<string, byte[]> { ["runtime.zip"] = data.ToArray() };
            await new ManagedToolInstaller(new Factory(assets)).InstallAsync("yt-dlp/yt-dlp", root, [new("runtime.zip", "deno", "deno")], CancellationToken.None);
            Assert.Equal("runtime", File.ReadAllText(Path.Combine(root, "deno")));
            Assert.False(File.Exists(Path.Combine(root, "outside")));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task ExecutableProbeDistinguishesSlowStartupTimeoutFailureAndCancellation()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        var executable = Path.Combine(root, "slow-tool");
        try
        {
            await File.WriteAllTextAsync(executable, "#!/bin/sh\nsleep 1\necho test-version\n");
            File.SetUnixFileMode(executable, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Assert.True(await ManagedToolInstaller.IsUsableAsync(executable, "--version", CancellationToken.None, TimeSpan.FromSeconds(30)));

            var error = await Assert.ThrowsAsync<TimeoutException>(() =>
                ManagedToolInstaller.IsUsableAsync(executable, "--version", CancellationToken.None, TimeSpan.FromMilliseconds(50)));
            Assert.Contains("platform compatibility has not been determined", error.Message);

            using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                ManagedToolInstaller.IsUsableAsync(executable, "--version", cancellation.Token));

            await File.WriteAllTextAsync(executable, "#!/bin/sh\nexit 1\n");
            Assert.False(await ManagedToolInstaller.IsUsableAsync(executable, "--version", CancellationToken.None));
            Assert.False(await ManagedToolInstaller.IsUsableAsync(Path.Combine(root, "missing-tool"), "--version", CancellationToken.None));
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    [Fact]
    public async Task SeedsImageToolsIntoWritableCacheAndCachedExecutableWorksWithoutBundleOrNetwork()
    {
        if (OperatingSystem.IsWindows()) return;
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var previous = Environment.GetEnvironmentVariable("RESONANCE_BUNDLED_TOOLS");
        try
        {
            var bundle = Path.Combine(root, "image");
            var cache = Path.Combine(root, "volume");
            Directory.CreateDirectory(bundle);
            var bytes = Encoding.UTF8.GetBytes("#!/bin/sh\necho test-version\n");
            File.WriteAllBytes(Path.Combine(bundle, "yt-dlp"), bytes);
            File.WriteAllText(Path.Combine(bundle, "manifest.json"), JsonSerializer.Serialize(new Dictionary<string, object> { ["yt-dlp"] = new { sha256 = Convert.ToHexString(SHA256.HashData(bytes)) } }));
            File.WriteAllText(Path.Combine(bundle, "yt-dlp-release.txt"), "test-version");
            Environment.SetEnvironmentVariable("RESONANCE_BUNDLED_TOOLS", bundle);
            Assert.True(await ManagedToolInstaller.SeedAsync("yt-dlp", cache, "--version", CancellationToken.None));
            Directory.Delete(bundle, true);
            Assert.True(await ManagedToolInstaller.IsUsableAsync(Path.Combine(cache, "yt-dlp"), "--version", CancellationToken.None));
            Assert.Equal("test-version", File.ReadAllText(Path.Combine(cache, "yt-dlp-release.txt")));
        }
        finally { Environment.SetEnvironmentVariable("RESONANCE_BUNDLED_TOOLS", previous); if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
