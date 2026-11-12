namespace Resonance.Tests.Security;

using System.IO.Compression;
using System.Text.Json;
using global::resonance.Analysis.UsbExport;

[Collection("Helper update configuration")]
public class UsbExportMergeTests
{
    [Fact]
    public async Task Merge_Uses_Only_Existing_Player_Databases_And_Returns_Both_Merged_Files()
    {
        var fixture = Environment.GetEnvironmentVariable("RESONANCE_TEST_MERGE_FIXTURE");
        var python = Environment.GetEnvironmentVariable("RESONANCE_TEST_MERGE_PYTHON");
        var worker = Environment.GetEnvironmentVariable("RESONANCE_TEST_MERGE_WORKER");
        if (fixture == null || python == null || worker == null)
        {
            return;
        }

        var previousRoot = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
        var previousPython = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_PYTHON");
        var previousWorker = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_WORKER");
        var root = Path.Combine(Path.GetTempPath(), "usb-merge-" + Guid.NewGuid().ToString("N"));
        var id = Guid.NewGuid().ToString("N");
        try
        {
            var export = Path.Combine(root, id, "export");
            var databases = Path.Combine(export, "PIONEER", "rekordbox");
            Directory.CreateDirectory(databases);
            foreach (var name in new[] { "export.pdb", "exportLibrary.db" })
            {
                File.Copy(Path.Combine(fixture, "prepared", "PIONEER", "rekordbox", name), Path.Combine(databases, name));
            }

            File.WriteAllText(Path.Combine(export, "export-manifest.json"), JsonSerializer.Serialize(new { schemaVersion = 1, jobId = id, profile = "dual", trackCount = 1, playlistName = "Added set" }));
            File.WriteAllText(Path.Combine(root, id, "export-complete"), string.Empty);
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", root);
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_PYTHON", python);
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_WORKER", worker);
            using var service = new UsbExportService(null!, null!);
            await using var classic = File.OpenRead(Path.Combine(fixture, "existing", "PIONEER", "rekordbox", "export.pdb"));
            await using var modern = File.OpenRead(Path.Combine(fixture, "existing", "PIONEER", "rekordbox", "exportLibrary.db"));
            var archive = await service.MergePlayerDatabases(id, classic, classic.Length, modern, modern.Length, CancellationToken.None);
            using var zip = ZipFile.OpenRead(archive);
            Assert.Equal(new[] { "export.pdb", "exportLibrary.db" }, zip.Entries.Select(entry => entry.FullName).ToArray());
            Assert.All(zip.Entries, entry => Assert.True(entry.Length > 1024));
            Assert.True(File.Exists(Path.Combine(fixture, "existing", "Contents", "UnknownArtist", "UnknownAlbum", "NOISE.wav")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", previousRoot);
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_PYTHON", previousPython);
            Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_WORKER", previousWorker);
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }
    }
}
