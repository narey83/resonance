using System.Runtime.InteropServices;
using System.Text.Json;
using resonance.Common;
using SkiaSharp;

try
{
if (!OperatingSystem.IsLinux() || RuntimeInformation.ProcessArchitecture != Architecture.Arm64)
    throw new InvalidOperationException("This smoke check requires the Linux ARM64 production runtime.");
using var bitmap = new SKBitmap(640, 320);
bitmap.Erase(SKColors.SteelBlue);
using var image = SKImage.FromBitmap(bitmap);
var results = new List<object>();
foreach (var format in new[] { SKEncodedImageFormat.Png, SKEncodedImageFormat.Jpeg, SKEncodedImageFormat.Webp })
{
    using var encoded = image.Encode(format, 90);
    foreach (var square in new[] { false, true })
    {
        var bytes = ArtworkResizer.ResizeToJpeg(encoded.ToArray(), 128, square);
        using var decoded = SKBitmap.Decode(bytes);
        if (decoded.Width <= 0 || decoded.Height <= 0 || decoded.Width > 128 || decoded.Height > 128 || (square ? decoded.Width != decoded.Height : Math.Abs(decoded.Width - 2 * decoded.Height) > 1) || bytes[0] != 0xff || bytes[1] != 0xd8)
            throw new InvalidDataException("Production artwork resize returned invalid dimensions or format.");
        results.Add(new { input = format.ToString(), square, decoded.Width, decoded.Height, bytes = bytes.Length });
    }
}
try
{
    ArtworkResizer.ResizeToJpeg(new byte[] { 1, 2, 3 }, 128);
    throw new InvalidOperationException("Invalid artwork was accepted.");
}
catch (InvalidDataException) { }
Console.WriteLine(JsonSerializer.Serialize(new { platform = "linux-arm64", passed = results.Count + 1, results }));

return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine(exception);
    return 1;
}
