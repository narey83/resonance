namespace Resonance.Tests.Integrations;

using System.Text.Json;
using Resonance.Integrations.YtDlp;

public class YtDlpEntryUrlTests
{
    [Theory]
    [InlineData("{\"webpage_url\":\"https://www.youtube.com/watch?v=video-id\",\"url\":\"https://media.example/video.mp4\"}", "https://www.youtube.com/watch?v=video-id")]
    [InlineData("{\"url\":\"https://www.youtube.com/watch?v=video-id\"}", "https://www.youtube.com/watch?v=video-id")]
    [InlineData("{\"url\":\"video-id\"}", "https://www.youtube.com/watch?v=video-id")]
    [InlineData("{\"webpage_url\":null,\"url\":null}", "https://www.youtube.com/watch?v=video-id")]
    [InlineData("{\"webpage_url\":\"\",\"url\":\"https://example.com/watch/video-id\"}", "https://example.com/watch/video-id")]
    public void UsesPageMetadataForDownloadsInsteadOfTemporaryMediaUrl(string json, string expected)
    {
        using var entry = JsonDocument.Parse(json);
        Assert.Equal(expected, YtDlpService.GetEntryPageUrl(entry.RootElement, "video-id"));
    }

    [Fact]
    public void MissingUrlAndIdDoNotProduceAnInvalidWatchUrl()
    {
        using var entry = JsonDocument.Parse("{}");
        Assert.Empty(YtDlpService.GetEntryPageUrl(entry.RootElement, string.Empty));
    }
}
