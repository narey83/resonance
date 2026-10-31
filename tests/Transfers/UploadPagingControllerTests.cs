namespace Resonance.Tests.Transfers;

using global::resonance.Transfers;
using global::resonance.Transfers.API;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

public sealed partial class UploadEnqueueTests
{
    [Fact]
    public async Task Upload_Page_Reports_Whole_Queue_Count_And_Keeps_Legacy_Listing()
    {
        await using var service = CreateService([]);
        for (var i = 0; i < 13; i++) QueueTransfer("peer", $"album/{i}.mp3");
        TransfersController Controller() => new(new TransferService(service), null!, null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        var controller = Controller();
        var first = Assert.IsType<OkObjectResult>(await controller.GetUploads(page: 0, pageSize: 5));
        var files = Assert.IsAssignableFrom<IEnumerable<UserResponse>>(first.Value).SelectMany(u => u.Directories).SelectMany(d => d.Files).ToList();
        Assert.Equal(5, files.Count);
        Assert.Equal("13", controller.Response.Headers["X-Uploads-Total-Pending"]);
        var next = Controller();
        var second = Assert.IsType<OkObjectResult>(await next.GetUploads(page: 1, pageSize: 5));
        var secondFiles = Assert.IsAssignableFrom<IEnumerable<UserResponse>>(second.Value).SelectMany(u => u.Directories).SelectMany(d => d.Files).ToList();
        Assert.Equal(5, secondFiles.Count);
        Assert.Empty(files.Select(f => f.Id).Intersect(secondFiles.Select(f => f.Id)));
        var legacy = Controller();
        var all = Assert.IsType<OkObjectResult>(await legacy.GetUploads());
        Assert.Equal(13, Assert.IsAssignableFrom<IEnumerable<UserResponse>>(all.Value).SelectMany(u => u.Directories).Sum(d => d.Files.Count()));
        Assert.False(legacy.Response.Headers.ContainsKey("X-Uploads-Total-Pending"));
    }

    [Fact]
    public async Task Malformed_Page_Does_Not_Fall_Back_To_An_Unbounded_Query()
    {
        var controller = new TransfersController(null!, null!, null!, null!, null!);
        controller.ModelState.AddModelError("page", "Invalid integer");
        Assert.IsType<BadRequestObjectResult>(await controller.GetUploads());
    }

    [Fact]
    public async Task Status_Endpoint_Reports_Counts_Without_Returning_Queued_Files()
    {
        await using var uploads = CreateService([]);
        for (var i = 0; i < 12; i++) QueueTransfer("peer", $"album/{i}.mp3");
        var downloads = Stub<global::resonance.Transfers.Downloads.IDownloadService>((method, _) => method.Name == "GetStatus"
            ? new TransferListStatus(0, 7, []) : throw new InvalidOperationException(method.Name));
        var controller = new TransfersController(new TransferService(uploads, downloads), null!, null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        var result = Assert.IsType<OkObjectResult>(await controller.GetStatus());
        using var json = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(result.Value, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)));
        Assert.Equal(12, json.RootElement.GetProperty("uploads").GetProperty("queuedCount").GetInt32());
        Assert.Equal(7, json.RootElement.GetProperty("downloads").GetProperty("queuedCount").GetInt32());
        Assert.Equal(0, json.RootElement.GetProperty("uploads").GetProperty("transfers").GetArrayLength());
    }

    [Theory]
    [InlineData(-1, 250)]
    [InlineData(0, 0)]
    [InlineData(0, 501)]
    [InlineData(int.MaxValue, 500)]
    public async Task Upload_Page_Rejects_Invalid_Parameters_Before_Service_Access(int page, int pageSize)
    {
        var controller = new TransfersController(null!, null!, null!, null!, null!);
        Assert.IsType<BadRequestObjectResult>(await controller.GetUploads(page: page, pageSize: pageSize));
    }
}
