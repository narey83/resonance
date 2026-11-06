namespace Resonance.Tests.Security;

using System.Collections;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using global::resonance.Analysis.UsbExport;
using global::resonance.Core.API;

[CollectionDefinition("Helper update configuration", DisableParallelization = true)]
public class BridgeUpdateConfigurationCollection { }

[Collection("Helper update configuration")]
public class BridgeUpdateTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "helper-release-tests-" + Guid.NewGuid());
    private readonly string? previousRoot;
    private readonly string? previousPairingFile;
    private readonly IDictionary pairings;
    private readonly List<string> inserted = new();

    public BridgeUpdateTests()
    {
        previousPairingFile = Environment.GetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE");
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE", Path.Combine(root, "pairings.json"));
        previousRoot = Environment.GetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT");
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT", root);
        pairings = (IDictionary)typeof(BridgeController).GetField("Pairings", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
    }

    [Theory]
    [InlineData(0)]
    [InlineData(59400)]
    public void Status_Uses_The_Background_Snapshot_Without_Loading_Track_Metadata(int indexedTracks)
    {
        // A null analysis service makes any attempt to enumerate tracks fail.
        using var exports = new UsbExportService(null!, null!);
        using var batches = new BridgeLibraryBatchService(null!, null!, exports);
        var snapshot = new BridgeLibraryView(3, "revision", indexedTracks, 15,
            "ready", "Tracks ready", Array.Empty<BridgeBatch>());
        typeof(BridgeLibraryBatchService).GetField("view", BindingFlags.NonPublic | BindingFlags.Instance)!
            .SetValue(batches, snapshot);

        var result = Assert.IsType<OkObjectResult>(new BridgeController(exports, batches).Status());
        var status = JsonSerializer.SerializeToElement(result.Value);

        Assert.Equal(indexedTracks, status.GetProperty("trackCount").GetInt32());
        Assert.Equal(15, status.GetProperty("readyTrackCount").GetInt32());
        Assert.True(status.TryGetProperty("connectedBridges", out _));
    }

    [Fact]
    public void Update_Endpoints_Require_A_Current_Pairing()
    {
        foreach (var expiration in new DateTimeOffset?[] { null, DateTimeOffset.UtcNow.AddMinutes(-1) })
        {
            var controller = Controller(expiration);
            Assert.IsType<UnauthorizedResult>(controller.BridgeUpdate("linux", "amd64"));
            Assert.IsType<UnauthorizedResult>(controller.BridgeUpdateBinary("linux", "amd64", new string('a', 64)));
        }
    }

    [Fact]
    public void Update_Uses_The_Active_Application_Directory_When_No_Release_Root_Is_Configured()
    {
        var appDirectory = Path.Combine(root, "app");
        var releaseDirectory = Path.Combine(appDirectory, "bridge-releases");
        Directory.CreateDirectory(releaseDirectory);
        var manifest = Path.Combine(releaseDirectory, "darwin-arm64.json");
        File.WriteAllText(manifest, "{}");

        var appDirectoryProperty = typeof(global::resonance.Program).GetProperty("AppDirectory", BindingFlags.Public | BindingFlags.Static)!;
        var previousAppDirectory = appDirectoryProperty.GetValue(null);
        var previousExplicitRoot = Environment.GetEnvironmentVariable("RESONANCE_BRIDGE_RELEASE_ROOT");
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_RELEASE_ROOT", null);
        Environment.SetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT", null);
        appDirectoryProperty.SetValue(null, appDirectory);
        try
        {
            var result = Assert.IsType<PhysicalFileResult>(Controller(DateTimeOffset.UtcNow.AddHours(1)).BridgeUpdate("darwin", "arm64"));
            Assert.Equal(manifest, result.FileName);
        }
        finally
        {
            appDirectoryProperty.SetValue(null, previousAppDirectory);
            Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_RELEASE_ROOT", previousExplicitRoot);
            Environment.SetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT", root);
        }
    }

    [Fact]
    public void A_Single_Bridge_Pairing_Can_Be_Revoked_By_Its_Public_Id()
    {
        var controller = Controller(DateTimeOffset.UtcNow.AddHours(1));
        var hash = inserted.Last();
        var id = hash[..12].ToLowerInvariant();

        var result = Assert.IsType<OkObjectResult>(controller.RevokeConnection(id));

        Assert.DoesNotContain(hash, pairings.Keys.Cast<string>());
        Assert.Contains("\"revoked\":true", JsonSerializer.Serialize(result.Value));
    }

    [Fact]
    public void Valid_Pairing_Can_Download_Only_Current_Published_Release()
    {
        var hash = new string('b', 64);
        Publish(hash);
        var controller = Controller(DateTimeOffset.UtcNow.AddHours(1));
        var manifest = Assert.IsType<PhysicalFileResult>(controller.BridgeUpdate("linux", "amd64"));
        Assert.Equal(Path.Combine(root, "linux-amd64.json"), manifest.FileName);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
        var binary = Assert.IsType<PhysicalFileResult>(controller.BridgeUpdateBinary("linux", "amd64", hash));
        Assert.Equal(Path.Combine(root, hash + ".bin"), binary.FileName);
        Assert.IsType<NotFoundObjectResult>(controller.BridgeUpdateBinary("linux", "amd64", new string('c', 64)));
    }

    [Theory]
    [InlineData("../private", "amd64")]
    [InlineData("linux", "../../private")]
    [InlineData("unsupported", "amd64")]
    [InlineData("linux", "x86")]
    public void Release_Paths_Are_An_Allowlist(string os, string arch)
    {
        var controller = Controller(DateTimeOffset.UtcNow.AddHours(1));
        Assert.IsType<NotFoundObjectResult>(controller.BridgeUpdate(os, arch));
    }

    [Theory]
    [InlineData("../../private")]
    [InlineData("")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public void Binary_Requests_Reject_Invalid_Hashes(string hash)
    {
        Assert.IsType<BadRequestObjectResult>(Controller(DateTimeOffset.UtcNow.AddHours(1)).BridgeUpdateBinary("linux", "amd64", hash));
    }

    [Fact]
    public void Corrupt_Release_Metadata_Returns_Unavailable()
    {
        File.WriteAllText(Path.Combine(root, "linux-amd64.json"), "invalid-json");
        var result = Assert.IsType<ObjectResult>(Controller(DateTimeOffset.UtcNow.AddHours(1)).BridgeUpdateBinary("linux", "amd64", new string('a', 64)));
        Assert.Equal(503, result.StatusCode);
    }

    [Fact]
    public void Revocation_Immediately_Prevents_Update_Access()
    {
        Publish(new string('b', 64));
        var controller = Controller(DateTimeOffset.UtcNow.AddHours(1));
        Assert.IsType<PhysicalFileResult>(controller.BridgeUpdate("linux", "amd64"));
        pairings.Remove(inserted.Last());
        Assert.IsType<UnauthorizedResult>(controller.BridgeUpdate("linux", "amd64"));
    }

    [Fact]
    public void Pairing_Works_Without_An_Export_Worker_And_Persists_Only_A_Token_Hash()
    {
        var result = Assert.IsType<FileContentResult>(Controller(null).Connection());
        Assert.Equal("resonance-bridge-pairing.resonance", result.FileDownloadName);
        using var document = JsonDocument.Parse(result.FileContents);
        var token = document.RootElement.GetProperty("token").GetString()!;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        inserted.Add(hash);
        var path = Path.Combine(root, "pairings.json");
        Assert.True(File.Exists(path));
        Assert.DoesNotContain(token, File.ReadAllText(path));
        Assert.Contains(hash, File.ReadAllText(path));
        var controller = Controller(null);
        controller.Request.Headers["X-Resonance-Link-Token"] = token;
        Publish(new string('b', 64));
        Assert.IsType<PhysicalFileResult>(controller.BridgeUpdate("linux", "amd64"));
        Assert.Equal(503, Assert.IsType<ObjectResult>(controller.Sync()).StatusCode);
        var reload = typeof(BridgeController).GetMethod("LoadPairings", BindingFlags.NonPublic | BindingFlags.Static)!;
        var reloaded = (IDictionary)reload.Invoke(null, null)!;
        Assert.True(reloaded.Contains(hash));
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
    }

    [Fact]
    public void Failed_Connection_Persistence_Does_Not_Grant_A_Token()
    {
        var before = pairings.Count;
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE", root);
        var result = Assert.IsType<ObjectResult>(Controller(null).Connection());
        Assert.Equal(503, result.StatusCode);
        Assert.Equal(before, pairings.Count);
    }

    [Fact]
    public void Failed_Revocation_Persistence_Keeps_Existing_Connection_Valid()
    {
        Publish(new string('b', 64));
        var paired = Controller(DateTimeOffset.UtcNow.AddHours(1));
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE", root);
        Assert.Equal(503, Assert.IsType<ObjectResult>(paired.RevokeConnections()).StatusCode);
        Assert.IsType<PhysicalFileResult>(paired.BridgeUpdate("linux", "amd64"));
    }

    [Fact]
    public void Successful_Revocation_Is_Durable_And_Rejects_The_Previous_Token()
    {
        var paired = Controller(DateTimeOffset.UtcNow.AddHours(1));
        Assert.IsType<OkObjectResult>(paired.RevokeConnections());
        Assert.IsType<UnauthorizedResult>(paired.BridgeUpdate("linux", "amd64"));
        using var saved = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "pairings.json")));
        Assert.Empty(saved.RootElement.EnumerateObject());
    }

    [Fact]
    public void Concurrent_Pairing_Requests_Cannot_Exceed_The_Connection_Limit()
    {
        var results = Enumerable.Range(0, 16).AsParallel().WithDegreeOfParallelism(4)
            .Select(_ => Controller(null).Connection()).ToArray();
        var files = results.OfType<FileContentResult>().ToArray();
        foreach (var file in files)
        {
            using var document = JsonDocument.Parse(file.FileContents);
            inserted.Add(Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(document.RootElement.GetProperty("token").GetString()!))));
        }

        Assert.Equal(8, files.Length);
        Assert.Equal(8, results.OfType<ConflictObjectResult>().Count());
    }

    [Fact]
    public void Durable_Revocation_Does_Not_Reload_A_Stale_Legacy_Store()
    {
        var previous = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
        var legacy = Path.Combine(root, "legacy");
        Directory.CreateDirectory(legacy);
        Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", legacy);
        try
        {
            File.WriteAllText(Path.Combine(legacy, "network-link-pairings.json"),
                JsonSerializer.Serialize(new Dictionary<string, object> { [new string('b', 64)] = new { Expires = DateTimeOffset.UtcNow.AddHours(1) } }));
            File.WriteAllText(Path.Combine(root, "pairings.json"), "{}");
            var load = typeof(BridgeController).GetMethod("LoadPairings", BindingFlags.NonPublic | BindingFlags.Static)!;
            Assert.Empty((IDictionary)load.Invoke(null, null)!);
        }
        finally
        {
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", previous);
        }
    }

    [Fact]
    public void Legacy_Pairings_Migrate_Into_Persistent_Storage_Without_Deleting_The_Source()
    {
        var previous = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
        var legacy = Path.Combine(root, "legacy");
        Directory.CreateDirectory(legacy);
        Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", legacy);
        try
        {
            var legacyPath = Path.Combine(legacy, "network-link-pairings.json");
            var hash = new string('c', 64);
            File.WriteAllText(legacyPath, JsonSerializer.Serialize(new Dictionary<string, object> { [hash] = new { Expires = DateTimeOffset.UtcNow.AddHours(1) } }));
            var load = typeof(BridgeController).GetMethod("LoadPairings", BindingFlags.NonPublic | BindingFlags.Static)!;
            Assert.True(((IDictionary)load.Invoke(null, null)!).Contains(hash));
            Assert.True(File.Exists(Path.Combine(root, "pairings.json")));
            Assert.True(File.Exists(legacyPath));
        }
        finally
        {
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", previous);
        }
    }

    [Fact]
    public void Relative_Storage_Configuration_Fails_Without_Granting_A_Connection()
    {
        var before = pairings.Count;
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE", "bridge-relative-test.json");
        Assert.Equal(503, Assert.IsType<ObjectResult>(Controller(null).Connection()).StatusCode);
        Assert.Equal(before, pairings.Count);
    }

    public void Dispose()
    {
        foreach (var hash in inserted) pairings.Remove(hash);
        Environment.SetEnvironmentVariable("RESONANCE_HELPER_RELEASE_ROOT", previousRoot);
        Environment.SetEnvironmentVariable("RESONANCE_BRIDGE_PAIRINGS_FILE", previousPairingFile);
        Directory.Delete(root, true);
    }

    [Fact]
    public void Appearance_Requires_Pairing_And_Exposes_Only_Theme()
    {
        Assert.IsType<UnauthorizedResult>(Controller(null).Appearance(null!));
        Assert.IsType<UnauthorizedResult>(Controller(DateTimeOffset.UtcNow.AddMinutes(-1)).Appearance(null!));
        var preferences = new global::resonance.Core.Preferences.PreferencesService(
            new global::resonance.ConnectionStringDictionary(new Dictionary<global::resonance.Database, global::resonance.ConnectionString>
            {
                [global::resonance.Database.Preferences] = "Data Source=" + Path.Combine(root, "appearance.db") + ";Pooling=False",
            }, usePostgres: false));
        preferences.Patch(new Dictionary<string, JsonElement>
        {
            ["resonance-theme"] = JsonSerializer.SerializeToElement("violet"),
            ["private-preference"] = JsonSerializer.SerializeToElement("must-not-leak"),
        });
        var controller = Controller(DateTimeOffset.UtcNow.AddHours(1));
        var result = Assert.IsType<OkObjectResult>(controller.Appearance(preferences));
        Assert.Equal("{\"theme\":\"violet\"}", JsonSerializer.Serialize(result.Value));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
        Assert.Null(preferences.Get("missing' OR 1=1 --"));
        foreach (var invalid in new object[] { 123, "url(evil)", "unknown" })
        {
            preferences.Patch(new Dictionary<string, JsonElement> { ["resonance-theme"] = JsonSerializer.SerializeToElement(invalid) });
            Assert.Equal("{\"theme\":\"system\"}", JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(controller.Appearance(preferences)).Value));
        }
        pairings.Remove(inserted.Last());
        Assert.IsType<UnauthorizedResult>(controller.Appearance(preferences));
    }

    private BridgeController Controller(DateTimeOffset? expires)
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "https";
        context.Request.Host = new HostString("resonance.test");
        if (expires.HasValue)
        {
            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
            var pairingType = typeof(BridgeController).GetNestedType("Pairing", BindingFlags.NonPublic)!;
            pairings.Add(hash, Activator.CreateInstance(pairingType, expires.Value)!);
            inserted.Add(hash);
            context.Request.Headers["X-Resonance-Link-Token"] = token;
        }
        return new BridgeController(null!) { ControllerContext = new ControllerContext { HttpContext = context } };
    }

    private void Publish(string hash)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(new { sha256 = hash });
        File.WriteAllText(Path.Combine(root, "linux-amd64.json"), JsonSerializer.Serialize(new { payload = Convert.ToBase64String(payload), signature = "verified by the helper" }));
        File.WriteAllText(Path.Combine(root, hash + ".bin"), "test engine");
    }
}
