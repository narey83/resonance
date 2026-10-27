using Microsoft.AspNetCore.Mvc;
using resonance.Mixtapes.API;
using resonance.MusicLibrary;
using Xunit;

namespace Resonance.Tests.Security;

public class PlaylistArtworkTests
{
    [Fact]
    public void PrivateArtworkRejectsUnsignedExpiredAndCrossPlaylistCapabilities()
    {
        var signer = new StreamUrlSigner("test-only-secret", 60000);
        var controller = new MixtapesController(null, signer);
        Assert.IsType<UnauthorizedResult>(controller.GetArtwork("a", 192));
        var (exp, sig) = signer.Sign("playlist-artwork:a");
        Assert.IsType<UnauthorizedResult>(controller.GetArtwork("b", 192, exp, sig));
        Assert.IsType<UnauthorizedResult>(controller.GetArtwork("a", 192, 1, sig));
        var (trackExp, trackSig) = signer.Sign("a");
        Assert.IsType<UnauthorizedResult>(controller.GetArtwork("a", 192, trackExp, trackSig));
    }
}
