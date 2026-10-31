namespace Resonance.Tests.Security;

using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using global::resonance;
using global::resonance.Analysis;
using global::resonance.Common;
using global::resonance.Common.Ffmpeg;
using global::resonance.MusicLibrary;
using global::resonance.MusicLibrary.API;

public sealed class MediaPathResolutionTests : IDisposable
{
    private readonly string temporary = Path.Combine(Path.GetTempPath(), "resonance-media-path-" + Guid.NewGuid().ToString("N"));
    private readonly StreamUrlSigner signer = new("synthetic-media-signing-key", 60000);
    private string Root => Path.Combine(temporary, "library");
    private string Outside => Path.Combine(temporary, "outside");
    private MusicLibraryService Library(params string[] roots) => new(new OptionsAtStartup { Shares = new() { Directories = roots } }, null!, null!, null!, null!);

    public MediaPathResolutionTests()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Outside);
        File.WriteAllText(Path.Combine(Root, "track.mp3"), "synthetic audio");
        File.WriteAllText(Path.Combine(Outside, "private.mp3"), "synthetic private audio");
    }

    private MusicLibraryController Controller(IMusicLibraryService library)
    {
        var analysis = DispatchProxy.Create<IAnalysisService, EmptyProxy>();
        var ffmpeg = DispatchProxy.Create<IFfmpegService, EmptyProxy>();
        return new MusicLibraryController(library, analysis, null!, null!, null!, null!, null!, signer, ffmpeg)
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
    }

    [Fact]
    public async Task StreamReturnsTheCanonicalFileAndRetainsRangeSupport()
    {
        var file = Path.Combine(Root, "track.mp3");
        var link = Path.Combine(Root, "alias.mp3");
        File.CreateSymbolicLink(link, file);
        var controller = Controller(Library(Root));
        var (exp, sig) = signer.Sign(link);
        var result = Assert.IsType<PhysicalFileResult>(await controller.StreamTrack(link, exp, sig));
        Assert.Equal(LibraryPathSecurity.Resolve(file), result.FileName);
        Assert.Equal("audio/mpeg", result.ContentType);
        Assert.True(result.EnableRangeProcessing);
        Assert.IsType<UnauthorizedResult>(await controller.StreamTrack(link, exp, "wrong-signature"));
    }

    [Fact]
    public async Task SignedMediaRequestsStillRejectParentSymlinkEscapes()
    {
        var link = Path.Combine(Root, "escape");
        Directory.CreateSymbolicLink(link, Outside);
        var path = Path.Combine(link, "private.mp3");
        var (exp, sig) = signer.Sign(path);
        var controller = Controller(Library(Root));
        Assert.Equal(403, Assert.IsType<StatusCodeResult>(await controller.StreamTrack(path, exp, sig)).StatusCode);
        Assert.Equal(403, Assert.IsType<StatusCodeResult>(controller.GetArtwork(path, 128, exp, sig)).StatusCode);
    }

    [Fact]
    public void EveryRequestRechecksRetargetedLinksRatherThanCachingAuthorization()
    {
        var link = Path.Combine(Root, "alias.mp3");
        File.CreateSymbolicLink(link, Path.Combine(Root, "track.mp3"));
        var library = Library(Root);
        Assert.NotNull(library.ResolveLibraryPath(link));
        File.Delete(link);
        File.CreateSymbolicLink(link, Path.Combine(Outside, "private.mp3"));
        Assert.Null(library.ResolveLibraryPath(link));
        Assert.False(library.IsLibraryPath(link));
    }

    [Fact]
    public void ConfiguredRootLinksRemainSupportedAndUnavailableRootsDoNotAuthorize()
    {
        var aliasRoot = Path.Combine(temporary, "root-alias");
        Directory.CreateSymbolicLink(aliasRoot, Root);
        var library = Library(Path.Combine(temporary, "unavailable"), aliasRoot);
        Assert.Equal(LibraryPathSecurity.Resolve(Path.Combine(Root, "track.mp3")), library.ResolveLibraryPath(Path.Combine(aliasRoot, "track.mp3")));
        Assert.Null(library.ResolveLibraryPath(Path.Combine(Root, "..", "outside", "private.mp3")));
        Assert.Null(library.ResolveLibraryPath(Path.Combine(Root, "missing.mp3")));
        Assert.Null(library.ResolveLibraryPath(Root));
        Assert.Null(library.ResolveLibraryPath(null!));
    }

    public void Dispose() => Directory.Delete(temporary, true);

    public class EmptyProxy : DispatchProxy
    {
        protected override object? Invoke(MethodInfo? method, object?[]? args) => null;
    }
}
