namespace Resonance.Tests.Security;

using System.Text.Json;
using Microsoft.AspNetCore.Http;
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

    [Fact]
    public void Deferred_Export_Can_Be_Reopened_And_Cancelled_From_Either_Client()
    {
        var id = Guid.NewGuid().ToString("N");
        Save(id);
        using var exports = new UsbExportService(null!, null!);
        var controller = new UsbExportController(exports)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        controller.Request.Scheme = "https";
        controller.Request.Host = new HostString("resonance.test");
        Assert.True(Assert.IsType<OkObjectResult>(controller.Defer(id)).Value is UsbExportJob { Deferred: true });
        Assert.True(exports.Read(id).Deferred);
        Assert.True(Assert.Single(exports.History()).Deferred);
        using (var reopened = new UsbExportService(null!, null!))
        {
            Assert.True(reopened.Read(id).Deferred);
        }
        Assert.IsType<UnauthorizedResult>(controller.TransferState(id));
        Assert.IsType<UnauthorizedResult>(controller.TransferDefer(id));
        Assert.IsType<UnauthorizedResult>(controller.TransferCancel(id));
        var handoff = Assert.IsType<FileContentResult>(controller.Transfer(id));
        using var ticket = JsonDocument.Parse(handoff.FileContents);
        controller.Request.Headers["X-Resonance-Link-Token"] = ticket.RootElement.GetProperty("token").GetString();
        Assert.False(exports.Read(id).Deferred);
        Assert.IsType<OkObjectResult>(controller.TransferDefer(id));
        Assert.True(exports.Read(id).Deferred);
        Assert.IsType<OkObjectResult>(controller.TransferState(id));
        Assert.IsType<OkObjectResult>(controller.TransferCancel(id));
        Assert.IsType<NotFoundResult>(controller.TransferState(id));
        Assert.Throws<FileNotFoundException>(() => exports.Read(id));
        Assert.Empty(exports.History());
    }

    [Fact]
    public void Direct_Transfer_Only_Serves_Manifested_Files_And_Zip_Is_On_Demand()
    {
        var id = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(root, id, "export");
        Directory.CreateDirectory(Path.Combine(directory, "Contents"));
        File.WriteAllText(Path.Combine(root, id, "export-complete"), string.Empty);
        File.WriteAllText(Path.Combine(directory, "Contents", "track.mp3"), "audio");
        File.WriteAllText(Path.Combine(directory, "private.txt"), "private");
        File.WriteAllText(Path.Combine(directory, "export-manifest.json"), JsonSerializer.Serialize(new
        {
            trackCount = 1, profile = "dual", playlistName = "Test", files = new[] { new { path = "Contents/track.mp3" } },
        }));
        using var exports = new UsbExportService(null!, null!);
        Assert.True(exports.Read(id).DownloadAvailable);
        Assert.False(File.Exists(Path.Combine(root, id, "resonance-usb.zip")));
        Assert.Equal(Path.Combine(directory, "Contents", "track.mp3"), exports.TransferFile(id, "Contents/track.mp3"));
        Assert.Throws<FileNotFoundException>(() => exports.TransferFile(id, "private.txt"));
        Assert.Throws<FileNotFoundException>(() => exports.TransferFile(id, "../private.txt"));
        var controller = new UsbExportController(exports)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        controller.Request.Scheme = "https";
        controller.Request.Host = new HostString("resonance.test");
        Assert.IsType<UnauthorizedResult>(controller.TransferManifest(id));
        var handoff = Assert.IsType<FileContentResult>(controller.Transfer(id));
        using var ticket = JsonDocument.Parse(handoff.FileContents);
        controller.Request.Headers["X-Resonance-Link-Token"] = ticket.RootElement.GetProperty("token").GetString();
        Assert.IsType<PhysicalFileResult>(controller.TransferManifest(id));
        Assert.IsType<PhysicalFileResult>(controller.TransferFile(id, "Contents/track.mp3"));
        Assert.IsType<NotFoundResult>(controller.TransferFile(id, "private.txt"));
        controller.Request.Headers["X-Resonance-Link-Token"] = new string('f', 64);
        Assert.IsType<UnauthorizedResult>(controller.TransferFile(id, "Contents/track.mp3"));
        Assert.True(File.Exists(exports.Download(id)));
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
