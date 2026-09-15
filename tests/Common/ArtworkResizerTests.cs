namespace Resonance.Tests.Common;

using global::resonance.Common;
using global::resonance.Mixtapes;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

public class ArtworkResizerTests
{
    private static byte[] Png(int width, int height)
    {
        using var image = new Image<Rgba32>(width, height);
        using var ms = new MemoryStream();
        image.SaveAsPng(ms);
        return ms.ToArray();
    }

    [Fact]
    public void Shrinks_To_Fit_The_Requested_Square_Keeping_Aspect_Ratio()
    {
        var resized = ArtworkResizer.ResizeToJpeg(Png(2000, 1000), 256);

        var info = Image.Identify(resized);
        Assert.Equal(256, info.Width);
        Assert.Equal(128, info.Height);
        Assert.Equal("JPEG", info.Metadata.DecodedImageFormat?.Name);
    }

    [Theory]
    [InlineData(1, 32)]
    [InlineData(100, 100)]
    [InlineData(99_999, 2048)]
    public void Clamps_Requested_Sizes_Into_Range(int requested, int expected)
    {
        Assert.Equal(expected, ArtworkResizer.Clamp(requested));
    }

    [Theory]
    [InlineData(1, 64)]
    [InlineData(64, 64)]
    [InlineData(88, 128)]
    [InlineData(192, 256)]
    [InlineData(320, 512)]
    [InlineData(512, 512)]
    [InlineData(99_999, 2048)]
    public void Mixtape_Thumbnails_Round_Up_To_A_Power_Of_Two(int requested, int expected)
    {
        Assert.Equal(expected, MixtapeService.ThumbnailBucket(requested));
    }
}
