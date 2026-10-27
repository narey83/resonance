namespace Resonance.Tests.Security;

using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using global::resonance.Analysis;
using global::resonance.Common.Ffmpeg;
using global::resonance.MusicLibrary;
using global::resonance.MusicLibrary.API;

public class TranscodeBudgetTests
{
    [Fact]
    public async Task A_Full_Transcode_Budget_Returns_429_Without_Launching_Another_Process()
    {
        var path = Path.GetTempFileName();
        var slots = (SemaphoreSlim)typeof(MusicLibraryController).GetField("TranscodeSlots", BindingFlags.Static | BindingFlags.NonPublic)!.GetValue(null)!;
        var held = 0;
        try
        {
            while (held < 4) { await slots.WaitAsync(); held++; }
            var library = Stub<IMusicLibraryService>((method, _) => method.Name == "IsLibraryPath" ? true : null);
            var analysis = Stub<IAnalysisService>((_, _) => null);
            var ffmpeg = Stub<IFfmpegService>((method, _) => method.Name == "get_FfmpegPath" ? "/unused-by-budget-rejection" : null);
            var signer = new StreamUrlSigner("synthetic-signing-key", 60000);
            var (exp, sig) = signer.Sign(path);
            var controller = new MusicLibraryController(library, analysis, null!, null!, null!, null!, null!, signer, ffmpeg)
            { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
            var result = Assert.IsType<ObjectResult>(await controller.StreamTrack(path, exp, sig, "low"));
            Assert.Equal(429, result.StatusCode);
            Assert.Equal("5", controller.Response.Headers["Retry-After"]);
        }
        finally { if (held > 0) slots.Release(held); File.Delete(path); }
    }

    private static T Stub<T>(Func<MethodInfo, object?[]?, object?> action) where T : class
    {
        var value = DispatchProxy.Create<T, Proxy>();
        ((Proxy)(object)value).Action = action;
        return value;
    }
    public class Proxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Action = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Action(method!, args);
    }
}
