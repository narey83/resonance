namespace Resonance.Tests.Common;

using System.Text.Json;
using Resonance.Integrations.YtDlp;

public class ThumbnailSelectionTests
{
    [Theory]
    [InlineData("{\"thumbnail\":\"original\",\"thumbnails\":[{\"width\":1280,\"url\":\"large\"},{\"width\":320,\"url\":\"small\"},{\"width\":120,\"url\":\"tiny\"}]}", "small")]
    [InlineData("{\"thumbnails\":[{\"width\":120,\"url\":\"tiny\"},{\"width\":240,\"url\":\"small\"}]}", "small")]
    [InlineData("{\"thumbnails\":[{\"width\":null,\"url\":\"unknown\"}]}", "unknown")]
    [InlineData("{\"thumbnail\":\"only-source\"}", "only-source")]
    public void External_Artwork_Prefers_A_List_Size_Over_The_Original(string json, string expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, YtDlpService.SelectThumbnail(doc.RootElement));
    }
}
