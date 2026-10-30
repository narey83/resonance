namespace Resonance.Tests.MetadataLookup;

using System.Reflection;
using System.Text.Json;
using global::resonance;
using global::resonance.MetadataLookup;
using global::resonance.MetadataLookup.API;
using global::resonance.Shares;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Serilog;
using AppOptions = global::resonance.Options;

[Collection("Music path configuration")]
public sealed class MetadataActivityApiTests : IDisposable
{
    private readonly string previousRoot = global::resonance.Common.MusicPath.Root;
    private readonly string directory = Path.Combine(Path.GetTempPath(), "lookup-api-" + Guid.NewGuid());
    private readonly MetadataLookupService service;
    private readonly MetadataActivityStore store;

    public MetadataActivityApiTests()
    {
        Directory.CreateDirectory(directory);
        global::resonance.Common.MusicPath.Configure(directory);
        File.WriteAllText(Path.Combine(directory, "legacy.mp3"), "synthetic");
        var log = new LoggerConfiguration().CreateLogger();
        store = new MetadataActivityStore(Path.Combine(directory, "metadata-lookup-activity.jsonl"), log);
        store.Record("updated.mp3", Event("Updated", new Dictionary<string, string> { ["Album"] = "Discogs" }));
        store.Record("updated.mp3", Event("NoMatch"));
        store.Record("nomatch.mp3", Event("NoMatch"));
        store.Record("draft.flac", Event("Preview"));
        File.WriteAllText(Path.Combine(directory, "metadata-lookup-attempts.json"),
            JsonSerializer.Serialize(new Dictionary<string, object> { ["legacy.mp3"] = new { Identity = "x", AttemptedAt = 1, Outcome = "written" } }));
        var shares = DispatchProxy.Create<IShareService, ShareProxy>();
        ((ShareProxy)(object)shares).Call = (method, _) => method.Name switch
        {
            "GetTaggedFiles" => new[] { Tagged("updated.mp3"), Tagged("nomatch.mp3"), Tagged("legacy.mp3"), Tagged("new.mp3"), Tagged("ignore.jpg") },
            "GetUntaggedFiles" => new[] { new UntaggedFile("share\\draft.flac", "draft.flac", "share", "draft.flac", "flac") },
            _ => throw new InvalidOperationException(method.Name),
        };
        var options = DispatchProxy.Create<IOptionsMonitor<AppOptions>, ShareProxy>();
        ((ShareProxy)(object)options).Call = (_, _) => new AppOptions();
        service = new MetadataLookupService(shares, options, null!, null!, null!, null!, null!, null!, directory);
    }

    [Fact]
    public void ActualUpdatesLegacyAttemptsAndUnattemptedTracksStayDistinct()
    {
        var page = service.GetActivity(1, 50, "", "all");
        Assert.Equal(5, page.Total);
        Assert.Equal(1, page.Updated);
        Assert.Equal(2, page.NotUpdated);
        Assert.Equal(2, page.Unknown);
        var updated = Assert.Single(page.Items, item => item.Filename == "updated.mp3");
        Assert.Equal("NoMatch", updated.Status);
        Assert.Equal("Discogs", updated.LastUpdate!.Fields["Album"]);
        Assert.Equal("Unknown", Assert.Single(page.Items, item => item.Filename == "legacy.mp3").Status);
        Assert.Equal("NotChecked", Assert.Single(page.Items, item => item.Filename == "new.mp3").Status);
        Assert.All(page.Items, item => Assert.DoesNotContain(directory, JsonSerializer.Serialize(item)));
    }

    [Fact]
    public void FiltersPaginationAndSearchApplyBeforeReturningABoundedPage()
    {
        Assert.Single(service.GetActivity(1, 1, "", "updated").Items);
        Assert.Empty(service.GetActivity(2, 1, "", "updated").Items);
        Assert.Equal(2, service.GetActivity(1, 50, "", "notupdated").Filtered);
        Assert.Equal(2, service.GetActivity(1, 50, "", "unknown").Filtered);
        Assert.Equal("nomatch.mp3", Assert.Single(service.GetActivity(1, 50, "NOMATCH", "all").Items).Filename);
        Assert.Empty(service.GetActivity(1, 50, "not present", "all").Items);
    }

    [Theory]
    [InlineData(0, 50, "", "all")]
    [InlineData(1, 101, "", "all")]
    [InlineData(1, 0, "", "all")]
    [InlineData(1, 50, "", "garbage")]
    [InlineData(int.MaxValue, 50, "", "all")]
    public void InvalidPagingAndFiltersReturnBadRequest(int page, int size, string search, string filter)
        => Assert.IsType<BadRequestObjectResult>(new MetadataLookupController(service).GetActivity(page, size, search, filter));

    [Fact]
    public void OversizedSearchIsRejectedAndExpiredOrForgedPreviewCannotWrite()
    {
        Assert.IsType<BadRequestObjectResult>(new MetadataLookupController(service).GetActivity(search: new string('x', 251)));
        Assert.Throws<ArgumentException>(() => service.WriteLookupTags("share\\new.mp3", new(null!, null, null, "fake", 0, 0), "forged"));
    }

    private static TaggedFile Tagged(string name) => new("share\\" + name, name, "share", name, Path.GetExtension(name)[1..], null!);
    private static MetadataActivityEvent Event(string status, IReadOnlyDictionary<string, string>? fields = null)
        => new(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, status, "Automatic", "Synthetic test", fields ?? new Dictionary<string, string>());

    public void Dispose()
    {
        global::resonance.Common.MusicPath.Configure(previousRoot);
        Directory.Delete(directory, true);
    }

    public class ShareProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call { get; set; } = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
}
