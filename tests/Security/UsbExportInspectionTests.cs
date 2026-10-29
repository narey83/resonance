namespace Resonance.Tests.Security;

using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using global::resonance.Analysis.API;
using global::resonance.Analysis.UsbExport;

[Collection("Helper update configuration")]
public class UsbExportInspectionTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "usb-inspection-" + Guid.NewGuid());
    private readonly string? previous = Environment.GetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT");
    public UsbExportInspectionTests()
    {
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", root);
    }

    [Fact]
    public void Saved_Exports_And_Their_Inspection_Survive_A_Service_Restart()
    {
        var id = Guid.NewGuid().ToString("N");
        Save(id);
        using var exports = new UsbExportService(null!, null!);
        Assert.Equal(id, Assert.Single(exports.History()).JobId);
        Assert.Equal("Test album", exports.Inspect(id).GetProperty("playlistName").GetString());
        var controller = new UsbExportController(exports);
        Assert.IsType<OkObjectResult>(controller.Inspect(id));
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("not-an-export-id")]
    public void Inspection_Rejects_Invalid_Export_Ids(string id)
    {
        using var exports = new UsbExportService(null!, null!);
        Assert.Throws<FileNotFoundException>(() => exports.Inspect(id));
        Assert.IsType<NotFoundResult>(new UsbExportController(exports).Inspect(id));
    }

    [Fact]
    public void Missing_Inspection_Is_Reported_Without_Hiding_History()
    {
        var id = Guid.NewGuid().ToString("N");
        Save(id);
        File.Delete(Path.Combine(root, id, "inspection.json"));
        using var exports = new UsbExportService(null!, null!);
        Assert.Single(exports.History());
        Assert.IsType<ConflictObjectResult>(new UsbExportController(exports).Inspect(id));
    }

    [Fact]
    public void Damaged_Exports_Do_Not_Hide_Valid_Saved_Exports()
    {
        Save(Guid.NewGuid().ToString("N"));
        var damaged = Guid.NewGuid().ToString("N");
        Save(damaged);
        File.WriteAllText(Path.Combine(root, damaged, "export", "export-manifest.json"), "{}");
        using var exports = new UsbExportService(null!, null!);
        Assert.Single(exports.History());
    }

    [Fact]
    public void History_Is_Bounded_And_Inspection_Failures_Are_Safe()
    {
        for (var i = 0; i < 55; i++) Save(Guid.NewGuid().ToString("N"));
        using var exports = new UsbExportService(null!, null!);
        Assert.Equal(50, exports.History().Length);
        var id = exports.History()[0].JobId;
        File.WriteAllText(Path.Combine(root, id, "inspection.json"), "invalid JSON");
        var result = Assert.IsType<ObjectResult>(new UsbExportController(exports).Inspect(id));
        Assert.Equal(503, result.StatusCode);
    }

    private void Save(string id)
    {
        var directory = Path.Combine(root, id);
        Directory.CreateDirectory(Path.Combine(directory, "export"));
        File.WriteAllBytes(Path.Combine(directory, "resonance-usb.zip"), Array.Empty<byte>());
        File.WriteAllText(Path.Combine(directory, "export", "export-manifest.json"),
            JsonSerializer.Serialize(new { trackCount = 15, profile = "dual", playlistName = "Test album" }));
        File.WriteAllText(Path.Combine(directory, "inspection.json"),
            JsonSerializer.Serialize(new { schemaVersion = 1, playlistName = "Test album" }));
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("RESONANCE_USB_EXPORT_ROOT", previous);
        Directory.Delete(root, true);
    }
}
