namespace Resonance.Tests.Common;

using global::resonance.Common;
using global::resonance.Mixtapes;
using SkiaSharp;

public class ArtworkResizerTests
{
    private static byte[] Png(int width, int height)
    {
        using var image = new SKBitmap(width, height);
        image.Erase(SKColors.Red);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    [Fact]
    public void Shrinks_To_Fit_The_Requested_Square_Keeping_Aspect_Ratio()
    {
        var resized = ArtworkResizer.ResizeToJpeg(Png(2000, 1000), 256);

        using var info = SKCodec.Create(new SKMemoryStream(resized));
        Assert.Equal(256, info.Info.Width);
        Assert.Equal(128, info.Info.Height);
        Assert.Equal(SKEncodedImageFormat.Jpeg, info.EncodedFormat);
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

    [Fact]
    public void Small_Images_Are_Not_Upscaled()
    {
        using var info = SKCodec.Create(new SKMemoryStream(ArtworkResizer.ResizeToJpeg(Png(40, 20), 512)));
        Assert.Equal(40, info.Info.Width);
        Assert.Equal(20, info.Info.Height);
    }

    [Theory]
    [InlineData(null, 256)]
    [InlineData(0, 256)]
    [InlineData(-1, 256)]
    [InlineData(189, 192)]
    [InlineData(192, 192)]
    [InlineData(320, 384)]
    [InlineData(640, 768)]
    [InlineData(99_999, 2048)]
    public void Delivery_Uses_Bounded_Reusable_Size_Buckets(int? requested, int expected)
    {
        Assert.Equal(expected, ArtworkResizer.Bucket(requested));
    }

    [Fact]
    public void High_Resolution_Photos_Are_Dramatically_Smaller_As_Thumbnails()
    {
        using var image = new SKBitmap(1600, 1600);
        var random = new Random(1234);
        var pixels = new SKColor[1600 * 1600];
        for (var i = 0; i < pixels.Length; i++) pixels[i] = new SKColor((byte)random.Next(256), (byte)random.Next(256), (byte)random.Next(256));
        image.Pixels = pixels;
        using var source = new MemoryStream(image.Encode(SKEncodedImageFormat.Png, 100).ToArray());
        var thumbnail = ArtworkResizer.ResizeToJpeg(source.ToArray(), 192);
        using var decoded = SKBitmap.Decode(thumbnail);
        Assert.Equal(192, decoded.Width);
        Assert.True(thumbnail.Length < source.Length / 10, $"Source: {source.Length} bytes; thumbnail: {thumbnail.Length} bytes");
    }
    [Theory]
    [InlineData(1, 40, 20)]
    [InlineData(2, 40, 20)]
    [InlineData(3, 40, 20)]
    [InlineData(4, 40, 20)]
    [InlineData(5, 20, 40)]
    [InlineData(6, 20, 40)]
    [InlineData(7, 20, 40)]
    [InlineData(8, 20, 40)]
    public void Exif_Orientation_Is_Applied_And_Not_Carried_Into_Output(int orientation, int width, int height)
    {
        using var bitmap = new SKBitmap(40, 20);
        bitmap.Erase(SKColors.Red);
        var jpeg = bitmap.Encode(SKEncodedImageFormat.Jpeg, 90).ToArray();
        var exif = new byte[] { 69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,(byte)orientation,0,0,0,0,0,0,0 };
        using var input = new MemoryStream();
        input.Write(jpeg, 0, 2);
        input.Write(new byte[] { 255,225,0,(byte)(exif.Length + 2) });
        input.Write(exif); input.Write(jpeg, 2, jpeg.Length - 2);
        using var output = SKCodec.Create(new SKMemoryStream(ArtworkResizer.ResizeToJpeg(input.ToArray(), 512)));
        Assert.Equal(width, output.Info.Width); Assert.Equal(height, output.Info.Height);
        Assert.Equal(SKEncodedOrigin.TopLeft, output.EncodedOrigin);
    }

    [Fact]
    public void Invalid_Images_Are_Rejected_And_Square_Thumbnails_Stay_Bounded()
    {
        Assert.Throws<InvalidDataException>(() => ArtworkResizer.ResizeToJpeg(new byte[] { 1, 2, 3 }, 256));
        using var square = SKBitmap.Decode(ArtworkResizer.ResizeToJpeg(Png(1000, 500), 192, square: true));
        Assert.Equal(192, square.Width); Assert.Equal(192, square.Height);
    }

}
